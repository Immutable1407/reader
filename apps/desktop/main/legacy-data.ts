import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";

import type { startDiagnosticService } from "./diagnostic-service";
import { serverSpawnDiagnostics } from "./server-spawn-diagnostics";
const execute = promisify(execFile);
export class ReaderMigrationError extends Error {}

export interface ReaderMigration {
  status: "copying" | "verified" | "completed" | "not-needed";
  source?: string;
  library?: string;
  external?: boolean;
  legacyCleanup?: { status: "pending" | "kept" | "deleted" | "failed" };
}
async function run(binary: string, args: string[]): Promise<ReaderMigration> {
  try {
    const { stdout } = await execute(binary, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const state = JSON.parse(stdout) as ReaderMigration;
    if (!state || !["completed", "not-needed"].includes(state.status))
      throw new Error("迁移尚未完成");
    return state;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim() || failure.message, {
      cause: error,
    });
  }
}
export async function migrateReaderData(
  binary: string,
  appData: string,
  userData: string,
  diagnostics?: ReturnType<typeof startDiagnosticService>,
) {
  const started = Date.now();
  diagnostics?.record("migration.start");
  try {
    const state = await run(binary, [
      "--migrate-reader-data",
      join(appData, "Reader"),
      "--data",
      userData,
      ...(diagnostics
        ? [
            "--logs",
            diagnostics.directory,
            "--session",
            diagnostics.logs.sessionId,
          ]
        : []),
    ]);
    diagnostics?.logs.record("desktop", {
      level: "info",
      event: "migration.finish",
      status: state.status,
      durationMs: Date.now() - started,
    });
    return state;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : error;
    diagnostics?.logs.record("desktop", {
      level: "error",
      event: "migration.failed",
      durationMs: Date.now() - started,
      ...serverSpawnDiagnostics(binary, cause),
    });
    throw new ReaderMigrationError((error as Error).message, { cause: error });
  }
}
/** Called only after the new library and renderer have opened successfully. */
export async function promptLegacyCleanup(
  window: BrowserWindow,
  binary: string,
  appData: string,
  userData: string,
  state: ReaderMigration,
) {
  if (state.status !== "completed" || state.legacyCleanup?.status !== "pending")
    return;
  const source = join(appData, "Reader");
  const { response } = await dialog.showMessageBox(window, {
    type: "info",
    title: "迁移已完成",
    message: "你的数据已迁移到 NeoRead 并通过校验",
    detail: `建议卸载旧 Reader App，并删除其应用数据目录，释放磁盘空间。\n\n旧 Reader App 请手动卸载。“立即删除”仅删除下方的旧应用数据目录，不会卸载 App。\n\n原目录：${source}${state.external ? "\n\n外置自定义书库的旧副本不会被删除。" : ""}`,
    buttons: ["稍后手动删除", "立即删除"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  try {
    await run(binary, [
      "--cleanup-reader-data",
      response === 1 ? "delete" : "keep",
      "--reader-data",
      source,
      "--data",
      userData,
    ]);
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "warning",
      message: "旧数据清理未完成",
      detail: `${(error as Error).message}\n\nNeoRead 的迁移结果不受影响。请检查旧目录后手动处理：${source}`,
      buttons: ["知道了"],
      noLink: true,
    });
  }
}
