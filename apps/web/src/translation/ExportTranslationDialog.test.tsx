// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@reader/api";
import { downloadBlob } from "../download";
import { ExportTranslationDialog } from "./ExportTranslationDialog";

vi.mock("@reader/api", () => ({ api: { exportTranslation: vi.fn() } }));
vi.mock("../download", () => ({
  downloadBlob: vi.fn(),
  fileTitle: (title: string) => title,
}));
let root: Root, host: HTMLDivElement;
const close = vi.fn();
const button = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ExportTranslationDialog
        document={{ id: "doc", title: "示例" }}
        onClose={close}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("keeps a failed export open and retries with images", async () => {
  vi.mocked(api.exportTranslation).mockRejectedValueOnce(
    new Error("还没有可导出的已完成译文"),
  );
  await act(async () => button("导出").click());
  expect(api.exportTranslation).toHaveBeenLastCalledWith(
    "doc",
    "markdown",
    expect.any(AbortSignal),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "还没有可导出的已完成译文",
  );
  expect(close).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
  const blob = new Blob(["ZIP"], { type: "application/zip" });
  vi.mocked(api.exportTranslation).mockResolvedValueOnce(blob);
  await act(async () =>
    document.querySelector<HTMLElement>('[role="checkbox"]')!.click(),
  );
  await act(async () => button("导出").click());
  expect(api.exportTranslation).toHaveBeenLastCalledWith(
    "doc",
    "zip",
    expect.any(AbortSignal),
  );
  expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, "示例-译文.zip");
  expect(close).toHaveBeenCalledOnce();
});

it("cancels an in-flight export and ignores a late response", async () => {
  let resolve!: (blob: Blob) => void;
  vi.mocked(api.exportTranslation).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => button("导出").click());
  expect(button("正在导出…").disabled).toBe(true);
  const signal = vi.mocked(api.exportTranslation).mock.calls[0][2]!;
  await act(async () => button("取消").click());
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(new Blob(["late content"])));
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it("downloads Markdown with the document title", async () => {
  const blob = new Blob(["# 译文"], { type: "text/markdown" });
  vi.mocked(api.exportTranslation).mockResolvedValueOnce(blob);
  await act(async () => button("导出").click());
  expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, "示例-译文.md");
});
