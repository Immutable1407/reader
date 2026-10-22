package reader

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func runWebEventsProcess() {
	web := "disabled"
	isolated := false
	for _, arg := range os.Args {
		if arg == `web_search="live"` {
			web = "live"
		}
		if arg == "mcp_servers.unrelated.enabled=false" {
			isolated = true
		}
	}
	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var r codexRPCMessage
		if json.Unmarshal(scanner.Bytes(), &r) != nil {
			os.Exit(2)
		}
		reply := func(v any) { encoder.Encode(map[string]any{"id": r.ID, "result": v}) }
		switch r.Method {
		case "initialize":
			reply(map[string]any{})
		case "config/read":
			reply(map[string]any{"config": map[string]any{"mcp_servers": map[string]any{"unrelated": map[string]any{"enabled": !isolated}}, "features": map[string]bool{}, "web_search": web}})
		case "model/list":
			reply(map[string]any{"data": []any{map[string]any{"model": "test", "isDefault": true}}})
		case "thread/start":
			if !isolated {
				os.Exit(3)
			}
			var p struct {
				Sandbox  string `json:"sandbox"`
				Approval string `json:"approvalPolicy"`
			}
			json.Unmarshal(r.Params, &p)
			if p.Sandbox != "read-only" || p.Approval != "never" {
				os.Exit(4)
			}
			reply(map[string]any{"thread": map[string]string{"id": "thread"}, "model": "test"})
		case "turn/start":
			reply(map[string]any{"turn": map[string]string{"id": "turn"}})
			emit := func(method string, item any) {
				encoder.Encode(map[string]any{"method": method, "params": map[string]any{"threadId": "thread", "turnId": "turn", "item": item}})
			}
			if web == "live" {
				emit("item/started", map[string]any{"id": "search", "type": "webSearch", "query": "official docs", "action": map[string]string{"type": "search", "query": "official docs"}})
				emit("item/completed", map[string]any{"id": "search", "type": "webSearch", "query": "official docs", "results": []any{map[string]string{"url": "https://example.com/docs", "title": "Official docs", "snippet": "A public source"}}})
				emit("item/started", map[string]any{"id": "read", "type": "webSearch", "query": "", "action": map[string]string{"type": "openPage", "url": "https://example.com/docs"}})
				emit("item/completed", map[string]any{"id": "read", "type": "webSearch", "query": "", "action": map[string]string{"type": "openPage", "url": "https://example.com/docs"}})
			}
			encoder.Encode(map[string]any{"method": "item/agentMessage/delta", "params": map[string]string{"threadId": "thread", "turnId": "turn", "itemId": "answer", "delta": "See [Official docs](https://example.com/docs)."}})
			encoder.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": "thread", "turn": map[string]string{"id": "turn", "status": "completed"}}})
		}
	}
}
func TestCodexWebSearchIPCToChatHistory(t *testing.T) {
	fakeAgent(t, "codex", "web-events")
	s := testServer(t)
	_, err := s.Store.DB.Exec("INSERT INTO documents(id,type,title,author,size,created_at,last_opened_at) VALUES('doc','pdf','test','',1,?,?)", now(), now())
	if err != nil {
		t.Fatal(err)
	}
	body := `{"provider":"codex","prompt":"Look up official docs","context":"","webSearch":true}`
	out := request(t, s, "POST", "/api/documents/doc/chat", strings.NewReader(body))
	if out.Code != 200 || !strings.Contains(out.Body.String(), "event: done") || !strings.Contains(out.Body.String(), "event: tool") || !strings.Contains(out.Body.String(), "读取网页") {
		t.Fatal(out.Code, out.Body.String())
	}
	history, err := s.Store.chatHistory("doc")
	if err != nil || len(history) != 2 || !history[0].WebSearch || len(history[1].Tools) != 2 || history[1].Tools[0].Status != "completed" || len(history[1].WebSources) != 1 {
		t.Fatal(history, err)
	}
}
func TestCodexOfflineIPCDoesNotExposeSearch(t *testing.T) {
	fakeAgent(t, "codex", "web-events")
	s := testServer(t)
	chat := &chatInput{WebSearch: false}
	_, err := invokeCLI(t.Context(), s.Store.Root, "codex", "test", AIInput{Prompt: "Answer without web", Chat: chat}, nil)
	if err != nil || len(chat.Tools) != 0 {
		t.Fatal(err, chat.Tools)
	}
}

// This probe initializes the installed CLI only; it never starts a model turn.
func TestCodexWebPreflightNative(t *testing.T) {
	if os.Getenv("READER_TEST_CODEX_WEB_PREFLIGHT") != "1" {
		t.Skip("opt-in native CLI configuration check")
	}
	for _, enabled := range []bool{false, true} {
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		session, err := isolatedDocumentCodex(ctx, t.TempDir(), "", "", "", enabled)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		servers, err := session.verifyDocumentConfig(ctx)
		for _, s := range servers {
			if s.Enabled == nil || *s.Enabled {
				t.Fatal("unrelated MCP remained enabled")
			}
		}
		session.close()
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
}
