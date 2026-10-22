import { expect, it } from "vitest";
import { webSearchSupported } from "./web-search";
it("enables only native Codex or keyed official DeepSeek OpenAI connections", () => {
  expect(webSearchSupported("codex")).toBe(true);
  for (const url of [
    "https://api.deepseek.com",
    "https://api.deepseek.com/v1/",
    "https://api.deepseek.com/beta",
  ])
    expect(webSearchSupported("api", { url, model: "", hasKey: true })).toBe(
      true,
    );
  for (const url of [
    "http://api.deepseek.com",
    "https://api.deepseek.com.evil.test",
    "https://api.deepseek.com:8443",
    "https://user:pass@api.deepseek.com",
    "https://api.deepseek.com/other",
    "https://api.deepseek.com/v1?key=x",
  ])
    expect(webSearchSupported("api", { url, model: "", hasKey: true })).toBe(
      false,
    );
  expect(
    webSearchSupported("api", {
      url: "https://api.deepseek.com",
      model: "",
      hasKey: false,
    }),
  ).toBe(false);
  expect(
    webSearchSupported("api", {
      url: "https://api.deepseek.com/anthropic",
      protocol: "anthropic",
      model: "",
      hasKey: true,
    }),
  ).toBe(false);
  expect(webSearchSupported("kimi")).toBe(false);
});
