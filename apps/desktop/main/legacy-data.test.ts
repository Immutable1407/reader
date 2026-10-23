import { afterEach, beforeEach, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adoptLegacyData } from "./legacy-data";

let appData: string;
const legacy = () => join(appData, "Reader");
const current = () => join(appData, "NeoRead");
beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), "neoread-legacy-"));
});
afterEach(() => rm(appData, { recursive: true, force: true }));

it("moves the Reader library and settings into the NeoRead directory", async () => {
  await mkdir(join(legacy(), "library"), { recursive: true });
  await writeFile(join(legacy(), "library", "reader.sqlite"), "db");
  await writeFile(join(legacy(), "proxy-settings.json"), "{}");
  // Chromium may create the new directory before the app's code runs.
  await mkdir(join(current(), "Crashpad"), { recursive: true });

  expect(adoptLegacyData(appData, current())).toBe(true);
  expect(await readFile(join(current(), "library", "reader.sqlite"), "utf8")).toBe("db");
  expect(existsSync(join(current(), "proxy-settings.json"))).toBe(true);
  expect(existsSync(join(current(), "Crashpad"))).toBe(true);
  expect(existsSync(legacy())).toBe(false);
});

it("rewrites a library pointer that lived inside the old directory", async () => {
  await mkdir(join(legacy(), "custom"), { recursive: true });
  await writeFile(
    join(legacy(), "library-location.json"),
    JSON.stringify({ directory: join(legacy(), "custom") }),
  );
  adoptLegacyData(appData, current());
  const pointer = JSON.parse(
    await readFile(join(current(), "library-location.json"), "utf8"),
  );
  expect(pointer.directory).toBe(join(current(), "custom"));
});

it("keeps a pointer to a library elsewhere", async () => {
  await mkdir(legacy(), { recursive: true });
  const elsewhere = join(appData, "Documents", "Reader Library");
  await writeFile(
    join(legacy(), "library-location.json"),
    JSON.stringify({ directory: elsewhere }),
  );
  adoptLegacyData(appData, current());
  const pointer = JSON.parse(
    await readFile(join(current(), "library-location.json"), "utf8"),
  );
  expect(pointer.directory).toBe(elsewhere);
});

it("leaves both directories alone once NeoRead has its own library", async () => {
  await mkdir(join(legacy(), "library"), { recursive: true });
  await mkdir(join(current(), "library"), { recursive: true });
  expect(adoptLegacyData(appData, current())).toBe(false);
  expect(existsSync(join(legacy(), "library"))).toBe(true);
});

it("does nothing without old data", () => {
  expect(adoptLegacyData(appData, current())).toBe(false);
  expect(existsSync(current())).toBe(false);
});
