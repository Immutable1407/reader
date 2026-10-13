package neoread

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Word and WPS citation plugins. A command from the word processor opens a
// transaction; the Reader window runs the citation session and sends document
// operations back through the same transaction, one at a time, until it
// completes it. The server only authenticates and relays: it never parses the
// operations or the field codes.

const (
	citeBodyLimit   = 32 << 20
	citeCallTimeout = 5 * time.Minute
)

var citeCommands = map[string]bool{
	"addEditCitation":     true,
	"addEditBibliography": true,
	"setDocPrefs":         true,
	"refresh":             true,
	"removeCodes":         true,
}
var citeClients = map[string]bool{"word-windows": true, "word-mac": true, "wps": true}

var errCiteClosed = errors.New("文字处理软件已断开")

type citeEvent struct {
	Type        string `json:"type"`
	Transaction string `json:"transaction,omitempty"`
	Command     string `json:"command,omitempty"`
	DocumentID  string `json:"documentId,omitempty"`
	Client      string `json:"client,omitempty"`
}

type citeResult struct {
	value json.RawMessage
	err   string
}

type citeTransaction struct {
	id      string
	ops     chan json.RawMessage
	results chan citeResult
	done    chan struct{}
	once    sync.Once
	callMu  sync.Mutex
}

func (t *citeTransaction) close() { t.once.Do(func() { close(t.done) }) }

type citeBroker struct {
	mu          sync.Mutex
	subscribers map[chan citeEvent]struct{}
	current     *citeTransaction
	secret      string
}

// SetCiteCredential writes a fresh credential for the word processor plugins.
// Only the process that owns the connector port calls it, so the plugins can
// always read the credential from the same fixed path.
func (s *Server) SetCiteCredential(path string) error {
	secret := randomHex(32)
	if secret == "" {
		return errors.New("cannot generate citation credential")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(secret), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	s.cite.mu.Lock()
	s.cite.secret = secret
	s.cite.mu.Unlock()
	return nil
}

func (s *Server) citeAuthorized(r *http.Request) bool {
	s.cite.mu.Lock()
	secret := s.cite.secret
	s.cite.mu.Unlock()
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return secret != "" && subtle.ConstantTimeCompare([]byte(secret), []byte(provided)) == 1
}

func (s *Server) publishCite(event citeEvent) {
	for ch := range s.cite.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// abortCite ends the transaction from either side and unblocks both.
func (s *Server) abortCite(t *citeTransaction) {
	s.cite.mu.Lock()
	if s.cite.current == t {
		s.cite.current = nil
		s.publishCite(citeEvent{Type: "aborted", Transaction: t.id})
	}
	s.cite.mu.Unlock()
	t.close()
}

func (s *Server) citeTransaction(id string) *citeTransaction {
	s.cite.mu.Lock()
	defer s.cite.mu.Unlock()
	if s.cite.current != nil && s.cite.current.id == id {
		return s.cite.current
	}
	return nil
}

func readCiteBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, citeBodyLimit))
	if err != nil {
		fail(w, 413, "内容过大")
		return nil, false
	}
	return body, true
}

// awaitCiteOperation answers the word processor with the next operation.
func (s *Server) awaitCiteOperation(w http.ResponseWriter, r *http.Request, t *citeTransaction) {
	select {
	case op := <-t.ops:
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(op)
		return
	case <-r.Context().Done():
		s.abortCite(t)
		return
	case <-t.done:
	}
	// Completion closes the transaction right after queuing its last operation.
	select {
	case op := <-t.ops:
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(op)
	default:
		respond(w, 200, map[string]any{"op": "Document.complete", "transaction": t.id, "error": "Reader 已取消本次操作"})
	}
}

func (s *Server) citeExecCommand(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Command    string `json:"command"`
		DocumentID string `json:"documentId"`
		Client     string `json:"client"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !citeCommands[v.Command] || !citeClients[v.Client] || v.DocumentID == "" || len(v.DocumentID) > 200 {
		fail(w, 400, "无效的引用命令")
		return
	}
	s.cite.mu.Lock()
	if s.cite.current != nil {
		s.publishCite(citeEvent{Type: "focus"})
		s.cite.mu.Unlock()
		fail(w, 409, "Reader 正在处理另一个引用操作")
		return
	}
	if len(s.cite.subscribers) == 0 {
		s.cite.mu.Unlock()
		fail(w, 503, "请先打开 Reader 窗口")
		return
	}
	t := &citeTransaction{id: id(), ops: make(chan json.RawMessage, 1), results: make(chan citeResult, 1), done: make(chan struct{})}
	s.cite.current = t
	s.publishCite(citeEvent{Type: "command", Transaction: t.id, Command: v.Command, DocumentID: v.DocumentID, Client: v.Client})
	s.cite.mu.Unlock()
	s.awaitCiteOperation(w, r, t)
}

func (s *Server) citeRespond(w http.ResponseWriter, r *http.Request) {
	body, ok := readCiteBody(w, r)
	if !ok {
		return
	}
	var v struct {
		Transaction string          `json:"transaction"`
		Result      json.RawMessage `json:"result"`
		Error       string          `json:"error"`
	}
	if json.Unmarshal(body, &v) != nil {
		fail(w, 400, "无效的请求内容")
		return
	}
	t := s.citeTransaction(v.Transaction)
	if t == nil {
		fail(w, 410, "引用操作已结束")
		return
	}
	if v.Result == nil {
		v.Result = json.RawMessage("null")
	}
	select {
	case t.results <- citeResult{value: v.Result, err: v.Error}:
	default:
		fail(w, 409, "Reader 没有等待这项结果")
		return
	}
	s.awaitCiteOperation(w, r, t)
}

// citeEvents tells the Reader window about commands from the word processors.
func (s *Server) citeEvents(w http.ResponseWriter, r *http.Request) {
	ch := make(chan citeEvent, 16)
	s.cite.mu.Lock()
	if s.cite.subscribers == nil {
		s.cite.subscribers = make(map[chan citeEvent]struct{})
	}
	s.cite.subscribers[ch] = struct{}{}
	s.cite.mu.Unlock()
	defer func() {
		s.cite.mu.Lock()
		delete(s.cite.subscribers, ch)
		orphan := len(s.cite.subscribers) == 0 && s.cite.current != nil
		t := s.cite.current
		s.cite.mu.Unlock()
		if orphan {
			s.abortCite(t)
		}
	}()
	controller := http.NewResponseController(w)
	defer controller.SetWriteDeadline(time.Time{})
	send := func(frame string) error {
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, frame); err != nil {
			return err
		}
		return controller.Flush()
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	if send(": ready\n\n") != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			data, _ := json.Marshal(event)
			if send(fmt.Sprintf("event: %s\ndata: %s\n\n", event.Type, data)) != nil {
				return
			}
		case <-heartbeat.C:
			if send(": keepalive\n\n") != nil {
				return
			}
		}
	}
}

// citeCall sends one operation to the word processor and returns its result.
func (s *Server) citeCall(w http.ResponseWriter, r *http.Request) {
	t := s.citeTransaction(r.PathValue("id"))
	if t == nil {
		fail(w, 410, "引用操作已结束")
		return
	}
	body, ok := readCiteBody(w, r)
	if !ok {
		return
	}
	if !json.Valid(body) || !bytes.HasPrefix(bytes.TrimSpace(body), []byte("{")) {
		fail(w, 400, "无效的文档操作")
		return
	}
	if !t.callMu.TryLock() {
		fail(w, 409, "上一项文档操作尚未完成")
		return
	}
	defer t.callMu.Unlock()
	select {
	case t.ops <- body:
	case <-t.done:
		fail(w, 410, errCiteClosed.Error())
		return
	}
	timer := time.NewTimer(citeCallTimeout)
	defer timer.Stop()
	select {
	case result := <-t.results:
		if result.err != "" {
			respond(w, 422, map[string]string{"error": result.err})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(result.value)
	case <-t.done:
		fail(w, 410, errCiteClosed.Error())
	case <-timer.C:
		s.abortCite(t)
		fail(w, 504, "文字处理软件长时间没有响应")
	case <-r.Context().Done():
		s.abortCite(t)
	}
}

// citeComplete sends the final operation and frees the transaction slot.
func (s *Server) citeComplete(w http.ResponseWriter, r *http.Request) {
	t := s.citeTransaction(r.PathValue("id"))
	if t == nil {
		fail(w, 410, "引用操作已结束")
		return
	}
	var v struct {
		Activate bool   `json:"activate"`
		Error    string `json:"error"`
	}
	if !decode(w, r, &v) {
		return
	}
	op, _ := json.Marshal(map[string]any{"op": "Document.complete", "transaction": t.id, "activate": v.Activate, "error": v.Error})
	select {
	case t.ops <- op:
	default:
	}
	s.cite.mu.Lock()
	if s.cite.current == t {
		s.cite.current = nil
	}
	s.cite.mu.Unlock()
	t.close()
	w.WriteHeader(204)
}
