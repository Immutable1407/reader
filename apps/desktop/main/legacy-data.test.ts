import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), dialog: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mocks.exec(...args),
}));
vi.mock("electron", () => ({
  dialog: { showMessageBox: (...args: unknown[]) => mocks.dialog(...args) },
}));
import {
  migrateReaderData,
  promptLegacyCleanup,
  type ReaderMigration,
} from "./legacy-data";
const completed: ReaderMigration = {
  status: "completed",
  external: true,
  legacyCleanup: { status: "pending" },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exec.mockImplementation((_binary, _args, _options, callback) =>
    callback(null, { stdout: JSON.stringify(completed) }),
  );
  // Match the object returned by the real promisify(execFile) boundary.
  mocks.dialog.mockResolvedValue({ response: 0 });
});
it("skips cleanup UI for fresh installs and completed choices", async () => {
  for (const state of [
    { status: "not-needed" },
    { ...completed, legacyCleanup: { status: "kept" } },
    { ...completed, legacyCleanup: { status: "failed" } },
  ] as ReaderMigration[])
    await promptLegacyCleanup(
      {} as never,
      "/bin/server",
      "/data",
      "/data/NeoRead",
      state,
    );
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(mocks.exec).not.toHaveBeenCalled();
});
it("uses the fixed source directory and propagates migration errors", async () => {
  mocks.exec.mockImplementation((_b, _a, _o, cb) =>
    cb(Object.assign(new Error("failed"), { stderr: "旧书库仍在使用中" })),
  );
  await expect(
    migrateReaderData("/bin/server", "/data", "/data/NeoRead"),
  ).rejects.toThrow("旧书库仍在使用中");
  expect(mocks.exec.mock.calls[0][1]).toEqual([
    "--migrate-reader-data",
    "/data/Reader",
    "--data",
    "/data/NeoRead",
  ]);
});
it("recommends cleanup, but records keeping data when postponed", async () => {
  await promptLegacyCleanup(
    {} as never,
    "/bin/server",
    "/data",
    "/data/NeoRead",
    completed,
  );
  expect(mocks.dialog.mock.calls[0][1]).toMatchObject({
    buttons: ["稍后手动删除", "立即删除"],
    defaultId: 1,
    cancelId: 0,
  });
  expect(mocks.dialog.mock.calls[0][1].detail).toContain("不会卸载 App");
  expect(mocks.dialog.mock.calls[0][1].detail).toContain("外置自定义书库");
  expect(mocks.exec.mock.calls[0][1]).toContain("keep");
});
it("deletes only after the user chooses it and reports failures", async () => {
  mocks.dialog.mockResolvedValueOnce({ response: 1 });
  mocks.exec.mockImplementation((_b, _a, _o, cb) =>
    cb(new Error("旧数据发生变化")),
  );
  await promptLegacyCleanup(
    {} as never,
    "/bin/server",
    "/data",
    "/data/NeoRead",
    completed,
  );
  expect(mocks.exec.mock.calls[0][1]).toContain("delete");
  expect(mocks.dialog.mock.calls[1][1].detail).toContain("旧数据发生变化");
});
