// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { LinkPreview } from "@reader/core";
import { PDFLinkPreview } from "./pdf-link-preview";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function fixture() {
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
    function (this: HTMLCanvasElement) {
      return `pixels:${this.width}x${this.height}`;
    },
  );
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      convertToPdfPoint: (x: number, y: number) => [x, 800 - y],
      convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    }),
    render,
  };
  const pdf = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const host = document.createElement("div");
  const anchor = document.createElement("a");
  host.append(anchor);
  document.body.append(host);
  let shown: LinkPreview | null = null;
  const preview = new PDFLinkPreview(
    host,
    () => pdf,
    (next) => {
      shown = next;
    },
    vi.fn(),
  );
  return { preview, anchor, render, shown: () => shown! };
}

it("renders a right-column crop at the displayed width times the screen density", async () => {
  const { preview, anchor, shown } = fixture();
  await preview.previewLocation(
    { type: "pdf", page: 7, x: 0.6, y: 0.3 },
    anchor,
  );
  const width = Number(shown().image.match(/pixels:(\d+)/)![1]);
  expect(width).toBeGreaterThanOrEqual(580 * 2);
  preview.destroy();
});
