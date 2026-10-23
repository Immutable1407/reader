import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** Data written by the app itself, as opposed to files Chromium creates at startup. */
const hasLibrary = (directory: string) =>
  existsSync(join(directory, "library")) ||
  existsSync(join(directory, "library-location.json"));

/**
 * Before the rename the app kept its data under `<appData>/Reader`. On the
 * first launch as NeoRead, moves those entries into the new data directory so
 * the library, settings and connector pairing carry over. Entries already in
 * the new directory win; nothing happens once NeoRead has a library of its own.
 */
export function adoptLegacyData(
  appData: string,
  userData: string,
  legacyName = "Reader",
) {
  const legacy = join(appData, legacyName);
  if (hasLibrary(userData) || !hasLibrary(legacy)) return false;
  mkdirSync(userData, { recursive: true });
  for (const name of readdirSync(legacy)) {
    const target = join(userData, name);
    if (!existsSync(target)) renameSync(join(legacy, name), target);
  }
  try {
    rmdirSync(legacy);
  } catch {
    // Entries the new directory already had stay behind in the old one.
  }
  // A library kept inside the old directory is recorded by absolute path.
  const pointer = join(userData, "library-location.json");
  try {
    const value = JSON.parse(readFileSync(pointer, "utf8"));
    const inside =
      typeof value?.directory === "string"
        ? relative(legacy, value.directory)
        : "";
    if (inside && !inside.startsWith("..") && !isAbsolute(inside))
      writeFileSync(
        pointer,
        JSON.stringify({ ...value, directory: join(userData, inside) }) + "\n",
        { mode: 0o600 },
      );
  } catch {
    // No pointer: the library is the default one, already moved above.
  }
  return true;
}
