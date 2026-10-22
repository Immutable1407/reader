// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DocumentNavigation, TOCItem } from "@reader/core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@reader/api", () => ({
  api: { navigation: mocks.load, saveNavigation: mocks.save },
}));
import { NavigationTree } from "./NavigationTree";
let root: Root, host: HTMLDivElement;
const go = vi.fn();
const outline: TOCItem[] = [
  {
    id: "a",
    label: "Parent",
    location: { type: "pdf", page: 1 },
    children: [
      {
        id: "b",
        label: "Child",
        location: { type: "pdf", page: 2 },
        children: [],
      },
    ],
  },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ revision: 0, entries: {} });
  mocks.save.mockImplementation(async (_id: string, n: DocumentNavigation) => ({
    ...n,
    revision: n.revision + 1,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () => {
    root.render(
      <NavigationTree
        documentId="d"
        type="pdf"
        outline={outline}
        blocks={[]}
        annotations={[]}
        go={go}
      />,
    );
  });
it("collapses without navigating and persists across remounts", async () => {
  await render();
  const toggle = host.querySelector<HTMLButtonElement>(
    '[aria-label="折叠 Parent"]',
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => toggle.click());
  expect(go).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][1].entries.a.collapsed).toBe(true);
  expect(
    host
      .querySelector('[aria-label="展开 Parent"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("false");
  mocks.load.mockResolvedValue({
    revision: 1,
    entries: { a: { collapsed: true } },
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.querySelector('[aria-label="展开 Parent"]')).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".navigation-link")!.click(),
  );
  expect(go).toHaveBeenCalledWith({ type: "pdf", page: 1 });
});
it("renames with F2 and Enter without changing the document destination", async () => {
  await render();
  await act(async () =>
    host
      .querySelector(".navigation-row")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
      ),
  );
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="目录名称"]',
  )!;
  expect(input).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "Custom title");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(mocks.save.mock.calls[0][1].entries.a.label).toBe("Custom title");
  expect(host.textContent).toContain("Custom title");
  expect(go).not.toHaveBeenCalled();
});
it("keeps the old title when a save fails", async () => {
  mocks.save.mockRejectedValue(new Error("保存失败"));
  await render();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="折叠 Parent"]')!
      .click(),
  );
  expect(host.querySelector('[aria-label="折叠 Parent"]')).not.toBeNull();
  expect(mocks.load).toHaveBeenCalledTimes(2);
});
it("keeps inline rename open after choosing the context menu command", async () => {
  await render();
  await act(async () =>
    host.querySelector(".navigation-row")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 20,
        clientY: 20,
      }),
    ),
  );
  const menu = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((n) => n.textContent === "重命名")!;
  expect(menu).toBeTruthy();
  await act(async () => menu.click());
  const input = host.querySelector('input[aria-label="目录名称"]');
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
});
