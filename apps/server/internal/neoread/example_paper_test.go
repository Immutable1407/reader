package neoread

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNewLibraryExample(t *testing.T) {
	root := t.TempDir()
	s, err := OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	var paper bundledPaper
	raw, _ := examplePaper.ReadFile("example-paper/paper.json")
	if err = json.Unmarshal(raw, &paper); err != nil {
		t.Fatal(err)
	}
	doc, err := s.Document(paper.ID)
	if err != nil || doc.Title != "Attention Is All You Need" {
		t.Fatalf("document: %v %v", doc, err)
	}
	server := NewServer(s, "test", "")
	layout, err := server.readLayout(paper.ID)
	if err != nil || layout.Pages != 15 {
		t.Fatalf("layout: %v", err)
	}
	translations, err := server.translations(paper.ID, layout)
	if err != nil || len(translations) != 122 {
		t.Fatalf("translations: %d %v", len(translations), err)
	}
	for _, tr := range translations {
		if tr.Status != "complete" {
			t.Fatalf("unfinished translation: %s", tr.BlockID)
		}
	}
	for _, block := range layout.Blocks {
		if block.Image != "" {
			if _, err = os.Stat(filepath.Join(server.analysisDir(paper.ID), block.Image)); err != nil {
				t.Fatal(err)
			}
		}
	}
	p, err := s.processing(paper.ID)
	if err != nil || p.Phase != "ready" || p.Status != "complete" {
		t.Fatalf("processing: %+v %v", p, err)
	}
	var prefs string
	if err = s.DB.QueryRow("SELECT value FROM settings WHERE key='preferences:guide'").Scan(&prefs); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains([]byte(prefs), []byte(paper.ID)) {
		t.Fatal("missing onboarding example")
	}
	if _, err = os.Stat(filepath.Join(root, examplePending)); !os.IsNotExist(err) {
		t.Fatal("pending marker retained")
	}
	// Restart, then permanently delete; neither operation restores the example.
	s.DB.Close()
	s, err = OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
	if count != 1 {
		t.Fatalf("duplicate documents: %d", count)
	}
	if _, err = s.DB.Exec("DELETE FROM documents"); err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
	if count != 0 {
		t.Fatal("deleted sample restored")
	}
}

func TestExistingLibraryDoesNotSeedExample(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "legacy"}[legacy], func(t *testing.T) {
			root := t.TempDir()
			s, err := OpenStore(root)
			if err != nil {
				t.Fatal(err)
			}
			s.DB.Close()
			if legacy {
				if err = os.Rename(filepath.Join(root, "neoread.sqlite"), filepath.Join(root, "reader.sqlite")); err != nil {
					t.Fatal(err)
				}
			}
			s, err = OpenLibrary(root)
			if err != nil {
				t.Fatal(err)
			}
			defer s.DB.Close()
			var count int
			s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
			if count != 0 {
				t.Fatal("seeded existing empty library")
			}
		})
	}
}

func TestExampleInitializationRecovery(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, examplePending), []byte("v1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := OpenStore(root)
	if err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	s, err = OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	s.DB.Close()
	// Recover a crash after commit but before marker removal, even after deletion.
	if err = os.WriteFile(filepath.Join(root, examplePending), []byte("v1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	s, err = OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var count int
	s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
	if count != 1 {
		t.Fatal("recovery duplicated example")
	}
}

func TestExamplePreservesOrphanedLibraryFiles(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "papers", "user.pdf")
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte("user content"), 0600)
	s, err := OpenLibrary(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var count int
	s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
	if count != 0 {
		t.Fatal("seeded a library with existing files")
	}
	data, _ := os.ReadFile(path)
	if string(data) != "user content" {
		t.Fatal("modified user content")
	}
}

func TestExampleRecoveryPreservesConflictingFile(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, examplePending), []byte("v1\n"), 0600)
	var paper bundledPaper
	raw, _ := examplePaper.ReadFile("example-paper/paper.json")
	json.Unmarshal(raw, &paper)
	path := filepath.Join(root, "papers", paper.ID+".pdf")
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte("preserve this file"), 0600)
	if s, err := OpenLibrary(root); err == nil {
		s.DB.Close()
		t.Fatal("overwrote conflicting file")
	}
	raw, _ = os.ReadFile(path)
	if string(raw) != "preserve this file" {
		t.Fatal("user file changed")
	}
	s, err := OpenStore(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	var count int
	s.DB.QueryRow("SELECT count(*) FROM documents").Scan(&count)
	if count != 0 {
		t.Fatal("partial example published")
	}
	if _, err = os.Stat(filepath.Join(root, examplePending)); err != nil {
		t.Fatal("recovery marker lost")
	}
}
