import { describe, expect, it, vi } from "vitest";
import { docPathsFor, readDocPaths } from "../entrypoints/content/doc-paths";
import type { FilesRoute } from "../entrypoints/content/files-page";
import type { PrFileDiff } from "../utils/pr-diff";
import type { PrRef } from "../utils/pr-ref";
import type { PrFileContentResult, PrFilesResult } from "../utils/pr-source";

const lines = (...text: string[]) => text.join("\n");

const pr: PrRef = { owner: "macintacos", repo: "gh-prism-sandbox", number: 1 };
const route: FilesRoute = { pr, commitFiltered: false };

const unreadable: PrFileContentResult = { ok: false, problem: "failed" };

const text = (path: string, patch: string): PrFileDiff => ({
  kind: "text",
  path,
  status: "modified",
  patch,
});

const parserPatch = lines(
  "@@ -1,2 +1,2 @@",
  "-/// Blank lines are dropped.",
  "+/// Blank and whitespace-only lines are dropped.",
  " pub fn parse(input: &str) -> Vec<String> {",
);

const renderPatch = lines(
  "@@ -2,2 +2,2 @@",
  " pub fn render(items: &[String]) -> String {",
  "-    items.len()",
  "+    items.len() + 1",
);

// Hunk 1 is docs; hunk 2 opens at line 24, inside the block that line 1 opens, so only the head decides it.
const notesPatch = lines(
  "@@ -1,7 +1,7 @@",
  " /*",
  " Design notes for the fixture engine.",
  " The engine reads text and splits it into lines.",
  "-Each line is trimmed before anything else happens.",
  "+Each line is trimmed of surrounding whitespace first.",
  " Empty lines never reach the limit check.",
  " The limit counts kept lines, not input lines.",
  " Rendering happens after the limit is applied.",
  "@@ -24,7 +24,7 @@ Notes like these are for maintainers.",
  " They change rarely and stay in prose.",
  " Nothing here is real; it stages review scenarios.",
  " Line wrapping in these notes is deliberate.",
  "-Each sentence sits on its own line.",
  "+Every sentence sits on a line of its own.",
  " That keeps diffs of this comment narrow.",
  " End of design notes.",
  " */",
);
const notesHead = lines("/*", "Design notes for the fixture engine.");

function fakeClient(files: PrFilesResult, content: PrFileContentResult) {
  return {
    files: vi.fn(async () => files),
    fileContent: vi.fn(async (_path: string) => content),
    close: vi.fn(),
  };
}

describe("readDocPaths", () => {
  it("returns a files() failure as is", async () => {
    const client = fakeClient({ ok: false, problem: "rate-limited" }, unreadable);

    expect(await readDocPaths(client)).toEqual({ ok: false, problem: "rate-limited" });
  });

  it("lists a file whose every change is a comment, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [text("src/parser.rs", parserPatch)] },
      unreadable,
    );

    expect(await readDocPaths(client)).toEqual({ ok: true, paths: new Set(["src/parser.rs"]) });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves out a file with a code change, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [text("src/render.rs", renderPatch)] },
      unreadable,
    );

    expect(await readDocPaths(client)).toEqual({ ok: true, paths: new Set() });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("reads a needs-content file's head text once, and lists the file when that text settles it", async () => {
    const client = fakeClient(
      { ok: true, files: [text("src/notes.rs", notesPatch)] },
      { ok: true, text: notesHead },
    );

    expect(await readDocPaths(client)).toEqual({ ok: true, paths: new Set(["src/notes.rs"]) });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
    expect(client.fileContent).toHaveBeenCalledWith("src/notes.rs");
  });

  it("leaves out a needs-content file whose content can't be read, and stays ok", async () => {
    const client = fakeClient({ ok: true, files: [text("src/notes.rs", notesPatch)] }, unreadable);

    expect(await readDocPaths(client)).toEqual({ ok: true, paths: new Set() });
  });

  it("never reads a binary file", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [{ kind: "binary", path: "web/public/logo.png", status: "added" }],
      },
      unreadable,
    );

    expect(await readDocPaths(client)).toEqual({ ok: true, paths: new Set() });
    expect(client.fileContent).not.toHaveBeenCalled();
  });
});

describe("docPathsFor", () => {
  it("resolves a commit-filtered route without connecting", async () => {
    const connect = vi.fn((_pr: PrRef) => fakeClient({ ok: true, files: [] }, unreadable));

    const result = await docPathsFor(
      { pr, commitFiltered: true },
      new AbortController().signal,
      connect,
    );

    expect(result).toEqual({ ok: false, problem: "commit-filtered" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects to the route's PR, and closes the client when the signal aborts", async () => {
    const client = fakeClient({ ok: true, files: [] }, unreadable);
    const connect = vi.fn((_pr: PrRef) => client);
    const controller = new AbortController();

    await docPathsFor(route, controller.signal, connect);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(pr);
    expect(client.close).not.toHaveBeenCalled();

    controller.abort();

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
