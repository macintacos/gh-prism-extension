/**
 * Bun-bundles a module and its imports into one IIFE for a page, as the bench and the structural
 * e2e harness inject it. Run directly, `bun bench/bundle.ts <entry>` writes the bundle to stdout.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// The one slice of Bun's API this module uses: `@types/bun` would be a new dependency.
interface BunPlugin {
  name: string;
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      resolve: (args: { path: string; resolveDir: string }) => { path: string },
    ): void;
    onLoad(
      options: { filter: RegExp },
      load: (args: { path: string }) => Promise<{ contents: string; loader: "text" }>,
    ): void;
  }): void;
}

declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser";
    format: "iife";
    loader: Record<string, "text">;
    plugins: BunPlugin[];
  }): Promise<{ outputs: { text(): Promise<string> }[] }>;
  resolveSync(specifier: string, from: string): string;
};

// WXT imports CSS with Vite's `?inline` suffix, which Bun can't resolve; `loader` reads it as
// text, so the sheets reach the page without Tailwind's utilities.
const inline: BunPlugin = {
  name: "inline",
  setup(build) {
    build.onResolve({ filter: /\?inline$/ }, ({ path, resolveDir }) => ({
      path: Bun.resolveSync(path.slice(0, -"?inline".length), resolveDir),
    }));
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => ({
      contents: await withImports(path),
      loader: "text",
    }));
  },
};

/**
 * `path`'s sheet with each plain `@import` replaced by the imported sheet, as Vite inlines it. A
 * shadow root can't fetch the import, and without `ui/reveal.css` a row's full-name copy lays out
 * inline, taking room from its folder units. Imports with a modifier, such as Tailwind's
 * `prefix(tw)`, stay.
 */
async function withImports(path: string): Promise<string> {
  const sheet = await readFile(path, "utf8");
  const imports = [...sheet.matchAll(/@import "([^"]+)";/g)];
  const importedSheets = await Promise.all(
    imports.map(([, url = ""]) => withImports(join(dirname(path), url))),
  );
  return imports.reduce(
    (text, [statement], i) => text.replace(statement, importedSheets[i] ?? ""),
    sheet,
  );
}

export async function bundle(entrypoint: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    loader: { ".css": "text" },
    plugins: [inline],
  });
  const [output] = built.outputs;
  if (!output) throw new Error(`${entrypoint} built no output`);
  return output.text();
}

if (import.meta.main) process.stdout.write(await bundle(process.argv[2] ?? ""));
