// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WebSearchConfig } from "@reader/core";
import { WebSearchSettings } from "./WebSearchSettings";

it("saves persistent CLI permission and preserves a masked search key", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const value: WebSearchConfig = {
    cliEnabled: false,
    provider: "deepseek",
    url: "https://search.example/v1",
    hasKey: true,
  };
  const save = vi.fn(async () => true);
  try {
    await act(async () =>
      root.render(
        <WebSearchSettings value={value} disabled={false} onSave={save} />,
      ),
    );
    expect(
      host.querySelector('input[type="password"]')?.getAttribute("value"),
    ).toBe("");
    await act(async () =>
      (host.querySelector('[role="checkbox"]') as HTMLElement).click(),
    );
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(save).toHaveBeenCalledWith({
      ...value,
      cliEnabled: true,
      key: undefined,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("requires a replacement key at a new address and retains failed edits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const value: WebSearchConfig = {
    cliEnabled: false,
    provider: "deepseek",
    url: "https://search.example/v1",
    hasKey: true,
  };
  const save = vi.fn(async () => false);
  const type = async (element: HTMLInputElement, text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await act(async () =>
      root.render(
        <WebSearchSettings value={value} disabled={false} onSave={save} />,
      ),
    );
    const fields = host.querySelectorAll("input:not([type=hidden])");
    const url = [...fields].find(
      (input) => (input as HTMLInputElement).value === value.url,
    ) as HTMLInputElement;
    const password = host.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const submit = host.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    await type(url, "https://other.example");
    expect(submit.disabled).toBe(true);
    await type(password, "replacement");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(save).toHaveBeenLastCalledWith({
      ...value,
      url: "https://other.example",
      key: "replacement",
      hasKey: false,
    });
    expect(password.value).toBe("replacement");
    const remove = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "移除搜索密钥",
    )!;
    await act(async () => remove.click());
    await act(async () => submit.click());
    expect(save).toHaveBeenLastCalledWith({
      ...value,
      provider: "",
      url: "https://other.example",
      key: undefined,
      hasKey: false,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
