package neoread

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

// Book PDFs are parsed in the background from import on, independent of
// translation: one batch per run, bounded by the outline chapter and
// bookLayoutPages, starting at the chapter being read. Progress lives in
// book_layout_jobs, never in document_processing, so parsing neither starts
// nor pauses translation.

type bookLayoutProgress struct {
	Status     string `json:"status"`
	PagesDone  int    `json:"pagesDone"`
	PagesTotal int    `json:"pagesTotal"`
}

type bookLayoutState struct {
	mu      sync.Mutex
	locks   map[string]*sync.Mutex
	runs    map[string]context.CancelFunc
	outline map[string][]int
}

// bookLayoutLock serializes the pages parsed into one book's manifest, shared
// by background batches and requested chapters.
func (s *Server) bookLayoutLock(id string) *sync.Mutex {
	s.bookLayout.mu.Lock()
	defer s.bookLayout.mu.Unlock()
	if s.bookLayout.locks == nil {
		s.bookLayout.locks = map[string]*sync.Mutex{}
	}
	if s.bookLayout.locks[id] == nil {
		s.bookLayout.locks[id] = &sync.Mutex{}
	}
	return s.bookLayout.locks[id]
}

// interruptBookLayout stops a background batch so a requested chapter parses
// first. The batch stays queued and resumes after the chapter.
func (s *Server) interruptBookLayout(id string) {
	s.bookLayout.mu.Lock()
	defer s.bookLayout.mu.Unlock()
	if cancel := s.bookLayout.runs[id]; cancel != nil {
		cancel()
	}
}

// queueBookLayout adds every book PDF without a job, covering import, moves
// from the paper library and books imported before background parsing.
func (s *Store) queueBookLayout() error {
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO book_layout_jobs(document_id,status)
 SELECT id,'queued' FROM documents WHERE type='pdf' AND library='books' AND deleted_at=''`)
	return err
}

// prioritizeBookLayout moves an opened book ahead of the others and retries a
// failed parse.
func (s *Store) prioritizeBookLayout(id string) error {
	_, err := s.DB.Exec("UPDATE book_layout_jobs SET priority=?,status=CASE WHEN status='failed' THEN 'queued' ELSE status END WHERE document_id=? AND status!='complete'", now(), id)
	return err
}

func (s *Store) bookLayoutJobs() (map[string]bookLayoutProgress, error) {
	rows, err := s.DB.Query("SELECT document_id,status,pages_done,pages_total FROM book_layout_jobs WHERE status!='complete'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bookLayoutProgress{}
	for rows.Next() {
		var id string
		var p bookLayoutProgress
		if err = rows.Scan(&id, &p.Status, &p.PagesDone, &p.PagesTotal); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

func (s *Server) bookLayoutWorker(ctx context.Context) {
	if _, err := s.Store.DB.Exec("UPDATE book_layout_jobs SET status='queued' WHERE status IN ('running','failed')"); err != nil {
		s.diagnosticEvent(slog.LevelWarn, "book.layout.recover_failed", "errorCode", errorKind(err))
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		if err := s.Store.queueBookLayout(); err != nil {
			continue
		}
		var documentID string
		// A requested chapter owns the layout lane until its pages are parsed.
		err := s.Store.DB.QueryRowContext(ctx, `SELECT j.document_id FROM book_layout_jobs j
 JOIN documents d ON d.id=j.document_id LEFT JOIN document_processing p ON p.document_id=d.id
 WHERE j.status IN ('queued','running') AND d.type='pdf' AND d.library='books' AND d.deleted_at='' AND NOT
 (COALESCE(p.phase,'')='learning' AND p.status IN ('queued','running'))
 ORDER BY j.priority DESC, j.rowid LIMIT 1`).Scan(&documentID)
		if err != nil {
			continue
		}
		work, finish, err := s.beginDocumentTask(ctx, documentID)
		if err != nil {
			continue
		}
		s.runBookLayoutBatch(work, documentID)
		finish()
	}
}

func (s *Server) runBookLayoutBatch(ctx context.Context, documentID string) {
	run, cancel := context.WithCancel(ctx)
	s.bookLayout.mu.Lock()
	if s.bookLayout.runs == nil {
		s.bookLayout.runs = map[string]context.CancelFunc{}
	}
	s.bookLayout.runs[documentID] = cancel
	s.bookLayout.mu.Unlock()
	defer func() {
		s.bookLayout.mu.Lock()
		delete(s.bookLayout.runs, documentID)
		s.bookLayout.mu.Unlock()
		cancel()
	}()
	_, _ = s.Store.DB.Exec("UPDATE book_layout_jobs SET status='running' WHERE document_id=?", documentID)
	progress, err := s.parseBookBatch(run, documentID)
	status := "queued"
	switch {
	case err == nil && progress.PagesDone >= progress.PagesTotal && progress.PagesTotal > 0:
		status = "complete"
		// Search already extracts unparsed pages; refresh it once with the
		// parsed geometry rather than after every batch.
		_ = s.Store.queueDocumentCorpus(documentID)
	case err != nil && run.Err() == nil:
		status = "failed"
		s.diagnosticEvent(slog.LevelWarn, "book.layout.failed", "documentId", documentID, "errorCode", errorKind(err))
	}
	_, _ = s.Store.DB.Exec("UPDATE book_layout_jobs SET status=?,pages_done=?,pages_total=? WHERE document_id=?",
		status, progress.PagesDone, progress.PagesTotal, documentID)
}

// parseBookBatch parses the next unparsed run of pages and reports how many
// pages of the book are parsed afterwards.
func (s *Server) parseBookBatch(ctx context.Context, documentID string) (bookLayoutProgress, error) {
	lock := s.bookLayoutLock(documentID)
	lock.Lock()
	defer lock.Unlock()
	progress := bookLayoutProgress{}
	d, err := s.Store.Document(documentID)
	if err != nil {
		return progress, err
	}
	var known *layoutManifest
	if m, err := s.readLayout(d.ID); err == nil {
		known = &m
	}
	total := 0
	if known != nil {
		total = known.Pages
	} else if total, err = pdfPageCount(s.Store.File(d)); err != nil {
		total = 0
	}
	starts := s.bookChapterStarts(ctx, d)
	from, to, ok := nextBookBatch(known, total, starts, readingPage(d))
	if ok {
		work := filepath.Join(s.Store.Root, "cache", d.ID, "analysis-book-work")
		if err = s.runLayout(ctx, d, work, from, to, nil); err != nil {
			return progress, err
		}
		if err = s.mergeLayout(d.ID, work); err != nil {
			return progress, err
		}
		m, err := s.readLayout(d.ID)
		if err != nil {
			return progress, err
		}
		if !parsedPage(&m, from) {
			return progress, errors.New("后台解析未返回请求的页面")
		}
		known = &m
	}
	if known == nil {
		return progress, errors.New("无法读取 PDF 页数")
	}
	progress.PagesTotal = known.Pages
	for page := 1; page <= known.Pages; page++ {
		if parsedPage(known, page) {
			progress.PagesDone++
		}
	}
	return progress, nil
}

// nextBookBatch picks the first unparsed page at or after the chapter being
// read, wrapping to the start of the book. A batch holds whole chapters up to
// bookLayoutPages, so short chapters share one worker start, and splits only a
// longer chapter; it stops before parsed pages. An unknown page count parses a
// first batch; the layout worker clamps it to the document.
func nextBookBatch(m *layoutManifest, total int, starts []int, reading int) (from, to int, ok bool) {
	if total < 1 {
		if m != nil {
			return 0, 0, false
		}
		return 1, bookLayoutPages, true
	}
	origin := 1
	for _, start := range starts {
		if start <= reading && start <= total {
			origin = start
		}
	}
	for i := range total {
		page := (origin-1+i)%total + 1
		if parsedPage(m, page) {
			continue
		}
		end := min(total, page+bookLayoutPages-1)
		if limit := end; end < total {
			// starts is sorted: end at the last chapter boundary that fits.
			for _, start := range starts {
				if start > page && start-1 <= limit {
					end = start - 1
				}
			}
		}
		for next := page + 1; next <= end; next++ {
			if parsedPage(m, next) {
				end = next - 1
				break
			}
		}
		return page, end, true
	}
	return 0, 0, false
}

func readingPage(d Document) int {
	var progress struct {
		Page int `json:"page"`
	}
	if len(d.Progress) > 0 && json.Unmarshal(d.Progress, &progress) == nil && progress.Page > 0 {
		return progress.Page
	}
	return 1
}

func corpusProcessor() string {
	if worker := os.Getenv("NEOREAD_CORPUS_PROCESSOR"); worker != "" {
		return worker
	}
	if layout := os.Getenv("NEOREAD_PROCESSOR"); layout != "" {
		return filepath.Join(filepath.Dir(layout), "corpus.mjs")
	}
	return ""
}

// bookChapterStarts reads the PDF outline once per run of the app. Chapters
// are the top-level entries, or the children of a single title entry, as in
// the reader's "translate chapter". A missing or unreadable outline leaves
// only the page bound.
func (s *Server) bookChapterStarts(ctx context.Context, d Document) []int {
	s.bookLayout.mu.Lock()
	starts, cached := s.bookLayout.outline[d.ID]
	s.bookLayout.mu.Unlock()
	if cached {
		return starts
	}
	starts = []int{}
	worker, node := corpusProcessor(), os.Getenv("NEOREAD_NODE")
	if worker == "" || node == "" {
		return starts
	}
	work, err := os.MkdirTemp(filepath.Join(s.Store.Root, "ai-work"), "outline-")
	if err != nil {
		return starts
	}
	defer os.RemoveAll(work)
	out := filepath.Join(work, "outline.json")
	child, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(child, node, worker, "--input", s.Store.File(d), "--output", out, "--outline")
	cmd.Dir = work
	cmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1")
	cmd.WaitDelay = 3 * time.Second
	if cmd.Run() != nil {
		// Retry after a cancellation; a broken outline stays unbounded.
		if ctx.Err() != nil {
			return starts
		}
	} else if data, err := os.ReadFile(out); err == nil {
		var extracted struct {
			Outline []struct {
				Page  int `json:"page"`
				Depth int `json:"depth"`
			} `json:"outline"`
		}
		if json.Unmarshal(data, &extracted) == nil && len(extracted.Outline) > 0 {
			// A title bookmark without a destination is dropped, leaving its
			// children as the shallowest entries.
			depth := extracted.Outline[0].Depth
			for _, o := range extracted.Outline {
				depth = min(depth, o.Depth)
			}
			roots := 0
			for _, o := range extracted.Outline {
				if o.Depth == depth {
					roots++
				}
			}
			if roots == 1 {
				depth++
			}
			for _, o := range extracted.Outline {
				if o.Depth == depth && o.Page > 0 && !slices.Contains(starts, o.Page) {
					starts = append(starts, o.Page)
				}
			}
			slices.Sort(starts)
		}
	}
	s.bookLayout.mu.Lock()
	if s.bookLayout.outline == nil {
		s.bookLayout.outline = map[string][]int{}
	}
	s.bookLayout.outline[d.ID] = starts
	s.bookLayout.mu.Unlock()
	return starts
}
