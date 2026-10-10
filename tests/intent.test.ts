import { describe, expect, it, vi } from "vitest";
import type { FilesRoute } from "../entrypoints/content/files-page";
import { intentFor, readIntent } from "../entrypoints/content/intent";
import type { PrFileDiff } from "../utils/pr-diff";
import type { PrRef } from "../utils/pr-ref";
import type { PrFileContentResult, PrFilesResult } from "../utils/pr-source";

const lines = (...text: string[]) => text.join("\n");

const pr: PrRef = { owner: "macintacos", repo: "gh-prism-sandbox", number: 1 };
const route: FilesRoute = { pr, commitFiltered: false };

const unreadable: PrFileContentResult = { ok: false, problem: "failed" };

const modified = (path: string, patch: string): PrFileDiff => ({
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
const renderHead = lines(
  "use std::fmt;",
  "pub fn render(items: &[String]) -> String {",
  "    items.len() + 1",
  "}",
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

// The `mod tests` block spans head lines 5 to 13, with its `#[cfg(test)]` widened in.
const versionHead = lines(
  "pub fn version() -> &'static str {",
  '    "0.1.0"',
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn reports_version() {",
  '        assert_eq!(version(), "0.1.0");',
  "    }",
  "}",
);
const pinnedHead = lines(
  "pub fn version() -> &'static str {",
  '    "0.1.0"',
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn reports_version() {",
  '        let expected = "0.1.0"; /* pinned */',
  "        assert_eq!(version(), expected);",
  "    }",
  "}",
);

const versionTestPatch = lines(
  "@@ -10,3 +10,3 @@",
  "     fn reports_version() {",
  '-        assert_eq!(version(), "0.1.0");',
  '+        assert_eq!(version(), "0.2.0");',
  "     }",
);
// The `*/` makes the hunk ambiguous until the head says whether line 10 starts inside a comment.
const pinnedTestPatch = lines(
  "@@ -10,3 +10,3 @@",
  "     fn reports_version() {",
  '-        let expected = "0.1.0"; /* pinned */',
  '+        let expected = "0.2.0"; /* pinned */',
  "         assert_eq!(version(), expected);",
);
const commentTestPatch = lines(
  "@@ -10,3 +10,3 @@",
  "     fn reports_version() {",
  "-        // checks the pinned value",
  "+        // checks the version",
  "     }",
);

const describePatch = lines(
  "@@ -1,1 +1,2 @@",
  " import { parse } from './parse';",
  "+describe('parses', () => {",
);

function fakeClient(files: PrFilesResult, content: PrFileContentResult) {
  return {
    files: vi.fn(async () => files),
    fileContent: vi.fn(async (_path: string) => content),
    close: vi.fn(),
  };
}

describe("readIntent", () => {
  it("returns a files() failure as is", async () => {
    const client = fakeClient({ ok: false, problem: "rate-limited" }, unreadable);

    expect(await readIntent(client)).toEqual({ ok: false, problem: "rate-limited" });
  });

  it("lists a file whose every change is a comment, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/parser.rs", parserPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      overrides: new Map([["src/parser.rs", "docs"]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves out a file with a code change outside the inline-test rule, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/render.go", renderPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("reads a Rust file's head once, and leaves it out when no hunk is inside a test block", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/render.rs", renderPatch)] },
      { ok: true, text: renderHead },
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
    expect(client.fileContent).toHaveBeenCalledWith("src/render.rs");
  });

  it("reads a needs-content file's head text once, and lists the file when that text settles it", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/notes.rs", notesPatch)] },
      { ok: true, text: notesHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      overrides: new Map([["src/notes.rs", "docs"]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
    expect(client.fileContent).toHaveBeenCalledWith("src/notes.rs");
  });

  it("leaves out a needs-content file whose content can't be read, and stays ok", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/notes.rs", notesPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
  });

  it("maps a Rust implementation file whose only hunk is inside `mod tests` to tests", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", versionTestPatch)] },
      { ok: true, text: versionHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      overrides: new Map([["src/lib.rs", "tests"]]),
    });
  });

  it("reads a file that needs content for both rules exactly once", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/engine.rs", pinnedTestPatch)] },
      { ok: true, text: pinnedHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      overrides: new Map([["src/engine.rs", "tests"]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("maps a comment-only change inside a test block to docs without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", commentTestPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      overrides: new Map([["src/lib.rs", "docs"]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves out a test-block file whose content can't be read, and stays ok", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", versionTestPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
  });

  it("never reads a JavaScript file, a test-directory file or a renamed file", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [
          modified("src/parser.js", describePatch),
          modified("tests/foo.rs", versionTestPatch),
          {
            kind: "text",
            path: "src/lib.rs",
            previousPath: "src/old.rs",
            status: "renamed",
            patch: versionTestPatch,
          },
        ],
      },
      { ok: true, text: versionHead },
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("never reads a binary file", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [{ kind: "binary", path: "web/public/logo.png", status: "added" }],
      },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({ ok: true, overrides: new Map() });
    expect(client.fileContent).not.toHaveBeenCalled();
  });
});

describe("intentFor", () => {
  it("resolves a commit-filtered route without connecting", async () => {
    const connect = vi.fn((_pr: PrRef) => fakeClient({ ok: true, files: [] }, unreadable));

    const result = await intentFor(
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

    await intentFor(route, controller.signal, connect);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(pr);
    expect(client.close).not.toHaveBeenCalled();

    controller.abort();

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
