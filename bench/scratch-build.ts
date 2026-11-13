/**
 * Builds a scratch copy of the working tree with bench-only files overlaid, so a bench can load the
 * real extension plus its own entrypoints without touching the working tree.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Copies the working tree's tracked and unignored files to `copy`, then writes `overlays` there by path. */
export function scratchCopy(copy: string, overlays: Readonly<Record<string, string>> = {}): void {
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    mkdirSync(dirname(join(copy, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(copy, path));
  }
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
  // Ignored, but the build copies its grammars into the extension.
  symlinkSync(join(ROOT, ".grammars"), join(copy, ".grammars"));
  for (const [path, text] of Object.entries(overlays)) writeFileSync(join(copy, path), text);
}

/** Builds `copy` for `browserName` and returns the unpacked extension's directory. */
export function buildCopy(copy: string, browserName: "chromium" | "firefox"): string {
  const firefox = browserName === "firefox";
  execFileSync("bunx", ["--no-install", "wxt", "build", "-b", firefox ? "firefox" : "chrome"], {
    cwd: copy,
    stdio: ["ignore", "ignore", "inherit"],
  });
  return join(copy, ".output", firefox ? "firefox-mv3" : "chrome-mv3");
}
