import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGrammars, packagedWasmPaths } from "../../../scripts/tasks/grammars";
import { FETCHED_WASM, GRAMMAR_WASM, RUNTIME_WASM } from "../../../utils/structural/packaged";

const BYTES = new TextEncoder().encode("a grammar");
const WANTED = {
  pkg: "tree-sitter-example",
  version: "1.0.0",
  file: "tree-sitter-example.wasm",
  url: "https://example.test/tree-sitter-example.wasm",
  sha256: createHash("sha256").update(BYTES).digest("hex"),
};

describe("fetchGrammars", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gh-prism-grammars-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves a download whose SHA-256 is the pinned one", async () => {
    const download = vi.fn(async () => BYTES);

    await fetchGrammars([WANTED], join(dir, "nested"), download);

    expect(download).toHaveBeenCalledWith(WANTED.url);
    expect(readFileSync(join(dir, "nested", WANTED.file))).toEqual(Buffer.from(BYTES));
  });

  it("rejects a download with another SHA-256 and saves nothing", async () => {
    const download = async () => new TextEncoder().encode("something else");

    await expect(fetchGrammars([WANTED], dir, download)).rejects.toThrow(WANTED.file);
    expect(existsSync(join(dir, WANTED.file))).toBe(false);
  });

  it("downloads nothing for a file already saved with the pinned SHA-256", async () => {
    writeFileSync(join(dir, WANTED.file), BYTES);
    const download = vi.fn(async () => BYTES);

    await fetchGrammars([WANTED], dir, download);

    expect(download).not.toHaveBeenCalled();
  });

  it("replaces a saved file whose SHA-256 is not the pinned one", async () => {
    writeFileSync(join(dir, WANTED.file), "stale");

    await fetchGrammars([WANTED], dir, async () => BYTES);

    expect(readFileSync(join(dir, WANTED.file))).toEqual(Buffer.from(BYTES));
  });
});

describe("packagedWasmPaths", () => {
  it("finds the runtime and every grammar's file on disk", () => {
    const paths = new Map(packagedWasmPaths());

    for (const file of [RUNTIME_WASM, ...Object.values(GRAMMAR_WASM)])
      expect(existsSync(paths.get(file) ?? ""), file).toBe(true);
  });

  it("finds each fetched file with its pinned SHA-256", () => {
    const paths = new Map(packagedWasmPaths());

    for (const { file, sha256 } of FETCHED_WASM) {
      const saved = readFileSync(paths.get(file) ?? "");
      expect(createHash("sha256").update(saved).digest("hex"), file).toBe(sha256);
    }
  });
});
