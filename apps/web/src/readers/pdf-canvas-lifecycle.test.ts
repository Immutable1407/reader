// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

// Exercise the installed PDF.js lifecycle, including our pinned dependency
// patch. These internal classes are not exported; extract their actual code
// rather than reproducing the swap/cancellation algorithm in a mock.
const require = createRequire(import.meta.url);
const source = readFileSync(
  require.resolve("pdfjs-dist/web/pdf_viewer.mjs"),
  "utf8",
);
const baseSource = source.slice(
  source.indexOf("class BasePDFPageView extends"),
  source.indexOf(";// ./web/draw_layer_builder.js"),
);
class Cancelled extends Error {}
const Base = new Function(
  "RenderableView",
  "FeatureTest",
  "RenderingStates",
  "RenderingCancelledException",
  `${baseSource}; return BasePDFPageView;`,
)(
  class {},
  { isBackdropFilterSupported: false },
  { INITIAL: 0, RUNNING: 1, PAUSED: 2, FINISHED: 3 },
  Cancelled,
);
const cancelStart = source.indexOf(
  "const resultPromise = this._drawCanvas(this._getRenderingContext(canvas,",
);
const cancelBody = source.slice(
  source.indexOf("() => {", cancelStart) + 7,
  source.indexOf("}, renderTask =>", cancelStart),
);
const cancellation = new Function(
  "canvas",
  "prevCanvas",
  `return function () { ${cancelBody} };`,
);

function setup() {
  const wrapper = document.createElement("div");
  const old = document.createElement("canvas");
  old.width = 160;
  old.height = 100;
  wrapper.append(old);
  const view = new Base({
    pageColors: {
      foreground: "#dcd7d2",
      background: "#2f2c2f",
      mapColor: (c: string) => c,
    },
  });
  view.div = wrapper;
  view.canvas = old;
  return { view, wrapper, old };
}
function start(view: InstanceType<typeof Base>, wrapper: HTMLElement) {
  const { canvas, prevCanvas } = view._createCanvas((next: HTMLCanvasElement) =>
    wrapper.append(next),
  );
  let resolve!: () => void, reject!: (error: Error) => void;
  const task = {
    promise: new Promise<void>((a, b) => {
      resolve = a;
      reject = b;
    }),
    onContinue: undefined as ((cont: () => void) => void) | undefined,
    onError: undefined as ((e: Error) => void) | undefined,
    cancel: vi.fn(),
  };
  view.pdfPage = { render: () => task };
  const done = view._drawCanvas(
    {},
    cancellation(canvas, prevCanvas).bind(view),
    vi.fn(),
  );
  return { canvas, task, resolve, reject, done };
}

it("keeps the last completed frame through partial drawing and swaps only on completion", async () => {
  const { view, wrapper, old } = setup();
  const render = start(view, wrapper);
  render.task.onContinue?.(vi.fn());
  expect(wrapper.children).toHaveLength(1);
  expect(wrapper.firstChild).toBe(old);
  expect(old.width).toBe(160);
  render.resolve();
  await render.done;
  expect(wrapper.children).toHaveLength(1);
  expect(wrapper.firstChild).toBe(render.canvas);
  expect(old.width).toBe(0);
});

it("cancellation preserves the previous frame for the next render instead of clearing it", async () => {
  const { view, wrapper, old } = setup();
  const render = start(view, wrapper);
  const error = new Cancelled();
  render.task.onError?.(error);
  render.reject(error);
  await render.done;
  expect(wrapper.firstChild).toBe(old);
  expect(old.width).toBe(160);
  expect(view.canvas).toBe(old);
  expect(render.canvas.width).toBe(0);
  const retry = start(view, wrapper);
  expect(wrapper.firstChild).toBe(old);
  retry.resolve();
  await retry.done;
  expect(wrapper.children).toHaveLength(1);
  expect(wrapper.firstChild).toBe(retry.canvas);
});

it("keeps the completed frame when its replacement fails", async () => {
  const { view, wrapper, old } = setup();
  const render = start(view, wrapper);
  const result = expect(render.done).rejects.toThrow("render failure");
  render.reject(new Error("render failure"));
  await result;
  expect(wrapper.firstChild).toBe(old);
  expect(view.canvas).toBe(old);
  expect(old.width).toBe(160);
});
