// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Message } from "@reader/core";
import { AssistantPanel } from "./AssistantPanel";
import {
  ChatSession,
  type ChatInput,
  type ChatTransport,
} from "./chat-session";

vi.mock("./MessageMarkdown", () => ({
  MessageMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));
let root: Root, host: HTMLDivElement, session: ChatSession;
const originalGetAnimations = Element.prototype.getAnimations;
beforeEach(() => {
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  session?.dispose();
  host.remove();
  vi.unstubAllGlobals();
  Element.prototype.getAnimations = originalGetAnimations;
});
const question: ChatInput = {
  provider: "codex",
  prompt: "question",
  context: "",
  references: [],
  attachments: [],
};
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );

it("shows regeneration for failures, disables it during model saving, and replaces the old row", async () => {
  let history: Message[] = [];
  const providers: string[] = [];
  const stream: ChatTransport["stream"] = async (_, input, _signal, emit) => {
    providers.push(input.provider);
    history = [
      {
        id: input.userMessageId!,
        documentId: "doc",
        role: "user",
        content: "question",
        createdAt: "2026-10-15",
      },
    ];
    if (providers.length === 1) {
      emit({ event: "delta", data: { text: "old partial" } });
      emit({ event: "error", data: { error: "failed" } });
    } else {
      history.push({
        id: "answer",
        documentId: "doc",
        role: "assistant",
        content: "replacement answer",
        createdAt: "2026-10-15",
      });
      emit({ event: "done", data: { ok: true } });
    }
  };
  session = new ChatSession("doc", { messages: async () => history, stream });
  await session.load();
  await session.send(question);
  let selected = "codex";
  let completion: Promise<void> | undefined;
  const render = (saving: boolean) =>
    root.render(
      <AssistantPanel
        session={session}
        empty={null}
        extras={() => null}
        references={() => null}
        regenerateDisabled={saving}
        onRegenerate={() => {
          completion = session.regenerate(selected);
        }}
      />,
    );
  await act(async () => render(true));
  expect(button("重试同步")).toBeUndefined();
  expect(button("重新生成")?.disabled).toBe(true);
  act(() => button("重新生成")!.click());
  expect(providers).toEqual(["codex"]);
  selected = "api";
  await act(async () => render(false));
  await act(async () => {
    button("重新生成")!.click();
    await completion;
  });
  expect(providers).toEqual(["codex", "api"]);
  expect(host.textContent).not.toContain("old partial");
  expect(host.textContent).toContain("replacement answer");
  expect(host.querySelectorAll(".chat-question")).toHaveLength(1);
  expect(button("重新生成")).toBeUndefined();
});

it("history load failure offers only synchronization and never calls regeneration", async () => {
  const messages = vi
    .fn<ChatTransport["messages"]>()
    .mockRejectedValueOnce(new Error("history offline"))
    .mockResolvedValue([]);
  const stream = vi.fn<ChatTransport["stream"]>();
  const regenerate = vi.fn();
  session = new ChatSession("doc", { messages, stream });
  await session.load();
  await act(async () =>
    root.render(
      <AssistantPanel
        session={session}
        empty={null}
        extras={() => null}
        references={() => null}
        onRegenerate={regenerate}
      />,
    ),
  );
  expect(button("重新生成")).toBeUndefined();
  await act(async () => button("重试同步")!.click());
  expect(session.getSnapshot().loaded).toBe(true);
  expect(stream).not.toHaveBeenCalled();
  expect(regenerate).not.toHaveBeenCalled();
});
