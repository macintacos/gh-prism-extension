import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FETCHED_WASM, type FetchedWasm, WASM_SOURCES } from "../../utils/structural/packaged";

/** Where `bun install` saves the files of `FETCHED_WASM`; git ignores it. */
export const FETCHED_DIR = fileURLToPath(new URL("../../.grammars/", import.meta.url));

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Saves each of `wanted` under `dir`, unless a file with its SHA-256 is already there. Rejects,
 * saving nothing for that file, when `download` returns bytes with another SHA-256.
 */
export async function fetchGrammars(
  wanted: readonly FetchedWasm[],
  dir: string,
  download: (url: string) => Promise<Uint8Array>,
): Promise<void> {
  mkdirSync(dir, { recursive: true });

  for (const { file, url, sha256 } of wanted) {
    const path = join(dir, file);
    if (existsSync(path) && sha256Of(readFileSync(path)) === sha256) continue;

    const bytes = await download(url);
    const found = sha256Of(bytes);
    if (found !== sha256) {
      throw new Error(`${file} from ${url} has SHA-256 ${found}, not the pinned ${sha256}`);
    }
    writeFileSync(path, bytes);
  }
}

/** The bytes at `url`; rejects on a response that is not a success. */
export async function downloaded(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Each file the build packages under `WASM_DIR`, with its path on disk after `bun install`. */
export const packagedWasmPaths = (): (readonly [file: string, path: string])[] => [
  ...WASM_SOURCES.map(
    ([pkg, file]) => [file, fileURLToPath(import.meta.resolve(`${pkg}/${file}`))] as const,
  ),
  ...FETCHED_WASM.map(({ file }) => [file, join(FETCHED_DIR, file)] as const),
];
