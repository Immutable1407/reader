import type { WebSearchConfig } from "@reader/core";

/** A request captures the saved permission; there is no per-composer toggle. */
export function webSearchEnabled(provider: string, config?: WebSearchConfig) {
  if (!config) return false;
  if (provider === "codex") return config.cliEnabled;
  return (
    provider === "api" &&
    config.provider === "deepseek" &&
    !!config.url &&
    config.hasKey
  );
}
