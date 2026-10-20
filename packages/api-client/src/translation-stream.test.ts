import { expect, it } from "vitest";
import type { TranslationBlock } from "@reader/core";
import {
  consumeTranslationStream,
  type TranslationEvent,
} from "./translation-stream";

it.each(["snapshot", "translation"] as const)(
  "accepts idle book paragraphs in a %s event",
  async (event) => {
    const idle: TranslationBlock = {
      blockId: "p1-b1",
      sourceHash: "hash",
      status: "idle",
      sentences: [],
    };
    const complete: TranslationBlock = {
      ...idle,
      blockId: "p1-b2",
      status: "complete",
      sentences: [{ source: "Source.", target: "译文。" }],
    };
    const data = event === "snapshot" ? [idle, complete] : idle;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      },
    });
    const abort = new AbortController();
    const events: TranslationEvent[] = [];
    await expect(
      consumeTranslationStream(body, abort.signal, (value) => {
        events.push(value);
        abort.abort();
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual([{ event, data }]);
  },
);

it("rejects an unknown status even when the remaining fields are valid", async () => {
  const block = {
    blockId: "p1-b1",
    sourceHash: "hash",
    status: "toString",
    sentences: [],
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `event: translation\ndata: ${JSON.stringify(block)}\n\n`,
        ),
      );
    },
  });
  await expect(
    consumeTranslationStream(body, new AbortController().signal, () => {}),
  ).rejects.toThrow("译文事件格式无效");
});

it("delivers completed paragraphs before EOF across fragmented UTF-8 and multiple frames", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      source = c;
    },
  });
  const abort = new AbortController(),
    events: TranslationEvent[] = [];
  const running = consumeTranslationStream(body, abort.signal, (e) =>
    events.push(e),
  );
  const block = {
    blockId: "p1-b2",
    sourceHash: "hash",
    status: "complete",
    sentences: [{ source: "Source.", target: "译文。" }],
  };
  const bytes = new TextEncoder().encode(
    `event: snapshot\ndata: []\n\n: keepalive\n\nevent: translation\ndata: ${JSON.stringify(block)}\n\n`,
  );
  for (const byte of bytes) source.enqueue(new Uint8Array([byte]));
  // Let the reader consume the queued fragments without closing the connection.
  for (let i = 0; i < bytes.length + 5; i++) await Promise.resolve();
  expect(events).toEqual([
    { event: "snapshot", data: [] },
    { event: "translation", data: block },
  ]);
  source.enqueue(
    new TextEncoder().encode(
      `event: translation\ndata: ${JSON.stringify({ ...block, blockId: "p1-b1" })}\n\nevent: translation\ndata: {"blockId":`,
    ),
  );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(events).toHaveLength(3);
  expect(events[2]).toMatchObject({ data: { blockId: "p1-b1" } });
  abort.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
});
it("rejects malformed events and releases the stream", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          'event: translation\ndata: {"blockId":"wrong"}\n\n',
        ),
      );
    },
    cancel() {
      canceled = true;
    },
  });
  await expect(
    consumeTranslationStream(body, new AbortController().signal, () => {}),
  ).rejects.toThrow("格式无效");
  expect(canceled).toBe(true);
});
