import type { APIConnection } from "@reader/core";
export function webSearchSupported(
  provider: string,
  connection?: APIConnection,
) {
  if (provider === "codex") return true;
  if (
    provider !== "api" ||
    !connection?.hasKey ||
    connection.protocol === "anthropic"
  )
    return false;
  try {
    const u = new URL(connection.url.replace(/\/+$/, ""));
    return (
      u.protocol === "https:" &&
      u.host === "api.deepseek.com" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      ["", "/v1", "/beta"].includes(u.pathname === "/" ? "" : u.pathname)
    );
  } catch {
    return false;
  }
}
