import { describe, expect, it, vi } from "vitest";
import type { FilesRoute } from "../entrypoints/content/files-page";
import {
  type FileLines,
  type IntentSection,
  intentFor,
  type Placement,
  readIntent,
} from "../entrypoints/content/intent";
import type { PrFileDiff } from "../utils/pr-diff";
import type { DiffRef, PrRef } from "../utils/pr-ref";
import type { PrFileContentResult, PrFilesResult } from "../utils/pr-source";

const lines = (...text: string[]) => text.join("\n");

const pr: PrRef = { owner: "macintacos", repo: "gh-prism-sandbox", number: 1 };
const route: FilesRoute = { diff: pr, commitFiltered: false };

const whole = (section: IntentSection): Placement => ({ kind: "whole", section });

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
  '        assert_eq!(version(), "0.2.0");',
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
  '        let expected = "0.2.0"; /* pinned */',
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

// The sandbox's src/render.rs: a code hunk and a doc-comment hunk.
const renderSplitPatch = lines(
  "@@ -2,7 +2,7 @@ pub fn render(items: &[String]) -> String {",
  " pub fn render(items: &[String]) -> String {",
  "     items",
  "         .iter()",
  '-        .map(|item| format!("- {item}"))',
  '+        .map(|item| format!("* {item}"))',
  "         .collect::<Vec<_>>()",
  '         .join("\\n")',
  " }",
  "@@ -22,7 +22,7 @@ pub fn blank() -> String {",
  "     String::new()",
  " }",
  " ",
  "-/// Renders a count summary.",
  '+/// Renders a count summary such as "3 items".',
  " pub fn summary(count: usize) -> String {",
  '     format!("{count} items")',
  " }",
);
const renderSplitHead = lines(
  "use std::fmt;",
  "pub fn render(items: &[String]) -> String {",
  "    items",
  "        .iter()",
  '        .map(|item| format!("* {item}"))',
  "        .collect::<Vec<_>>()",
  '        .join("\\n")',
  "}",
  "",
  "pub fn count(items: &[String]) -> usize {",
  "    items.len()",
  "}",
  "",
  "pub fn trim(text: &str) -> &str {",
  "    text.trim()",
  "}",
  "",
  "pub fn one() -> u8 {",
  "    1",
  "}",
  "pub fn blank() -> String {",
  "    String::new()",
  "}",
  "",
  '/// Renders a count summary such as "3 items".',
  "pub fn summary(count: usize) -> String {",
  '    format!("{count} items")',
  "}",
);

const engineDocsAndTestsPatch = lines(
  "@@ -1,2 +1,2 @@",
  "-//! Engine docs.",
  "+//! Engine docs for maintainers.",
  " pub fn run() -> u8 {",
  "@@ -10 +10 @@",
  "-        assert_eq!(run(), 1);",
  "+        assert_eq!(run(), 2);",
);
const engineDocsAndTestsHead = lines(
  "//! Engine docs for maintainers.",
  "pub fn run() -> u8 {",
  "    2",
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    #[test]",
  "    fn runs() {",
  "        assert_eq!(run(), 2);",
  "    }",
  "}",
);

const testsOnlyDocPatch = lines(
  "@@ -3 +3 @@",
  "-    /// Checks the pinned value.",
  "+    /// Checks the version.",
  "@@ -6 +6 @@",
  '-        assert_eq!(version(), "0.1.0");',
  '+        assert_eq!(version(), "0.2.0");',
);
const testsOnlyDocHead = lines(
  "#[cfg(test)]",
  "mod tests {",
  "    /// Checks the version.",
  "    #[test]",
  "    fn reports_version() {",
  '        assert_eq!(version(), "0.2.0");',
  "    }",
  "}",
);

const codeAndTestDocPatch = lines(
  "@@ -2 +2 @@",
  "-    2",
  "+    3",
  "@@ -7 +7 @@",
  "-    /// Checks the pinned value.",
  "+    /// Checks the value.",
);
const codeAndTestDocHead = lines(
  "pub fn run() -> u8 {",
  "    3",
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    /// Checks the value.",
  "    #[test]",
  "    fn runs() {",
  "        assert_eq!(run(), 3);",
  "    }",
  "}",
);

// Hunk 1 is a gutter-only block-comment change that needs the head; hunk 2 is a `///` line in `mod tests`.
const allDocsPatch = lines(
  "@@ -2,3 +2,3 @@",
  " * Returns the first line.",
  "-* Trims surrounding whitespace.",
  "+* Trims surrounding whitespace and blank lines.",
  " * Empty input gives an empty string.",
  "@@ -14 +14 @@",
  "-    /// Checks the pinned value.",
  "+    /// Checks the version.",
);
const allDocsHead = lines(
  "/**",
  " * Returns the first line.",
  " * Trims surrounding whitespace and blank lines.",
  " * Empty input gives an empty string.",
  " */",
  "pub fn first(input: &str) -> &str {",
  '    input.lines().next().unwrap_or("")',
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    /// Checks the version.",
  "    #[test]",
  "    fn reports_first() {",
  '        assert_eq!(first("a"), "a");',
  "    }",
  "}",
);

const goNeedsContentPatch = lines(
  "@@ -4,3 +4,3 @@",
  " * Returns the first line.",
  "-* Trims surrounding whitespace.",
  "+* Trims surrounding whitespace and blank lines.",
  " * Empty input gives an empty string.",
  "@@ -9 +9 @@",
  "-\treturn parse(input)",
  "+\treturn parse(input, true)",
);
const goNeedsContentHead = lines(
  "package engine",
  "",
  "/**",
  "* Returns the first line.",
  "* Trims surrounding whitespace and blank lines.",
  "* Empty input gives an empty string.",
  "*/",
  "func First(input string) string {",
  "\treturn parse(input, true)",
  "}",
);

const goSplitPatch = lines(
  "@@ -2 +2 @@",
  "-\treturn parse(input)",
  "+\treturn parse(input, true)",
  "@@ -10 +10 @@",
  "-// Run keeps the first lines.",
  "+// Run keeps the first non-blank lines.",
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

  it("reports no progress when files() fails", async () => {
    const client = fakeClient({ ok: false, problem: "rate-limited" }, unreadable);
    const onProgress = vi.fn();

    await readIntent(client, onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reports progress from zero once files() succeeds, then once per file", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [
          modified("src/parser.rs", parserPatch),
          { kind: "binary", path: "web/public/logo.png", status: "added" },
          modified("src/render.rs", renderPatch),
        ],
      },
      { ok: true, text: renderHead },
    );
    const onProgress = vi.fn();

    await readIntent(client, onProgress);

    expect(onProgress.mock.calls).toEqual([
      [{ checked: 0, total: 3 }],
      [{ checked: 1, total: 3 }],
      [{ checked: 2, total: 3 }],
      [{ checked: 3, total: 3 }],
    ]);
  });

  it("counts each file's lines from its patch, and marks a binary file as binary", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [
          { kind: "binary", path: "web/public/logo.png", status: "added" },
          { kind: "text", path: "b.txt", previousPath: "a.txt", status: "renamed", patch: "" },
          {
            kind: "text",
            path: "src/old.rs",
            status: "deleted",
            patch: lines("@@ -1,3 +0,0 @@", "-a", "-b", "-c"),
          },
        ],
      },
      unreadable,
    );

    const result = await readIntent(client);

    if (!result.ok) throw new Error(result.problem);
    expect(result.lines).toEqual(
      new Map<string, FileLines>([
        ["web/public/logo.png", "binary"],
        ["b.txt", { added: 0, removed: 0 }],
        ["src/old.rs", { added: 0, removed: 3 }],
      ]),
    );
  });

  it("lists a file whose every change is a comment, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/parser.rs", parserPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([["src/parser.rs", whole("docs")]]),
      lines: new Map([["src/parser.rs", { added: 1, removed: 1 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves out a file with a code change outside the inline-test rule, without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/render.go", renderPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([["src/render.go", { added: 1, removed: 1 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("reads a Rust file's head once, and leaves it out when no hunk is inside a test block", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/render.rs", renderPatch)] },
      { ok: true, text: renderHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([["src/render.rs", { added: 1, removed: 1 }]]),
    });
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
      placements: new Map([["src/notes.rs", whole("docs")]]),
      lines: new Map([["src/notes.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
    expect(client.fileContent).toHaveBeenCalledWith("src/notes.rs");
  });

  it("splits out a needs-content file's docs hunk when its content can't be read, and keeps the rest in its path section", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/notes.rs", notesPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "src/notes.rs",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 24, last: 30 }],
                lines: { added: 1, removed: 1 },
              },
              { section: "docs", hunks: [{ first: 1, last: 7 }], lines: { added: 1, removed: 1 } },
            ],
          },
        ],
      ]),
      lines: new Map([["src/notes.rs", { added: 2, removed: 2 }]]),
    });
  });

  it("maps a Rust implementation file whose only hunk is inside `mod tests` to tests", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", versionTestPatch)] },
      { ok: true, text: versionHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([["src/lib.rs", whole("tests")]]),
      lines: new Map([["src/lib.rs", { added: 1, removed: 1 }]]),
    });
  });

  it("reads a file that needs content for both rules exactly once", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/engine.rs", pinnedTestPatch)] },
      { ok: true, text: pinnedHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([["src/engine.rs", whole("tests")]]),
      lines: new Map([["src/engine.rs", { added: 1, removed: 1 }]]),
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
      placements: new Map([["src/lib.rs", whole("docs")]]),
      lines: new Map([["src/lib.rs", { added: 1, removed: 1 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves out a test-block file whose content can't be read, and stays ok", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", versionTestPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([["src/lib.rs", { added: 1, removed: 1 }]]),
    });
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

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([
        ["src/parser.js", { added: 1, removed: 0 }],
        ["tests/foo.rs", { added: 1, removed: 1 }],
        ["src/lib.rs", { added: 1, removed: 1 }],
      ]),
    });
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

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([["web/public/logo.png", "binary"]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("splits the sandbox's src/render.rs into its code and doc-comment hunks, reading its head once", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/render.rs", renderSplitPatch)] },
      { ok: true, text: renderSplitHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "src/render.rs",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 2, last: 8 }],
                lines: { added: 1, removed: 1 },
              },
              {
                section: "docs",
                hunks: [{ first: 22, last: 28 }],
                lines: { added: 1, removed: 1 },
              },
            ],
          },
        ],
      ]),
      lines: new Map([["src/render.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("splits a Rust file's doc-comment hunk and its inline-test hunk, with no implementation share", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/engine.rs", engineDocsAndTestsPatch)] },
      { ok: true, text: engineDocsAndTestsHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "src/engine.rs",
          {
            kind: "split",
            shares: [
              {
                section: "tests",
                hunks: [{ first: 10, last: 10 }],
                lines: { added: 1, removed: 1 },
              },
              { section: "docs", hunks: [{ first: 1, last: 2 }], lines: { added: 1, removed: 1 } },
            ],
          },
        ],
      ]),
      lines: new Map([["src/engine.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("keeps a Rust file whose hunks all sit in `mod tests`, one editing only a /// line, as a whole tests placement", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/lib.rs", testsOnlyDocPatch)] },
      { ok: true, text: testsOnlyDocHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([["src/lib.rs", whole("tests")]]),
      lines: new Map([["src/lib.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("splits a Rust file's code hunk outside any test block from its docstring-only hunk inside `mod tests`", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/engine.rs", codeAndTestDocPatch)] },
      { ok: true, text: codeAndTestDocHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "src/engine.rs",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 2, last: 2 }],
                lines: { added: 1, removed: 1 },
              },
              { section: "tests", hunks: [{ first: 7, last: 7 }], lines: { added: 1, removed: 1 } },
            ],
          },
        ],
      ]),
      lines: new Map([["src/engine.rs", { added: 2, removed: 2 }]]),
    });
  });

  it("keeps a Rust file whose every hunk is docs whole in Documentation, though one sits inside `mod tests`", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/report.rs", allDocsPatch)] },
      { ok: true, text: allDocsHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([["src/report.rs", whole("docs")]]),
      lines: new Map([["src/report.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("splits a Go file's code hunk from its patch-settled docs hunk without reading its content", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("engine/engine.go", goSplitPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "engine/engine.go",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 2, last: 2 }],
                lines: { added: 1, removed: 1 },
              },
              {
                section: "docs",
                hunks: [{ first: 10, last: 10 }],
                lines: { added: 1, removed: 1 },
              },
            ],
          },
        ],
      ]),
      lines: new Map([["engine/engine.go", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("counts each split share's lines from only the hunks placed in it", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [
          modified(
            "engine/engine.go",
            lines(
              "@@ -2,3 +2,2 @@",
              "-\treturn parse(input)",
              "-\tlog(input)",
              "+\treturn parse(input, true)",
              " }",
              "@@ -10 +10 @@",
              "-// Run keeps the first lines.",
              "+// Run keeps the first non-blank lines.",
            ),
          ),
        ],
      },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "engine/engine.go",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 2, last: 3 }],
                lines: { added: 1, removed: 2 },
              },
              {
                section: "docs",
                hunks: [{ first: 10, last: 10 }],
                lines: { added: 1, removed: 1 },
              },
            ],
          },
        ],
      ]),
      lines: new Map([["engine/engine.go", { added: 2, removed: 3 }]]),
    });
  });

  it("reads a Go file's head once to settle its needs-content hunk, and splits it from the code hunk", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("engine/engine.go", goNeedsContentPatch)] },
      { ok: true, text: goNeedsContentHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "engine/engine.go",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 9, last: 9 }],
                lines: { added: 1, removed: 1 },
              },
              {
                section: "docs",
                hunks: [{ first: 4, last: 6 }],
                lines: { added: 1, removed: 1 },
              },
            ],
          },
        ],
      ]),
      lines: new Map([["engine/engine.go", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).toHaveBeenCalledTimes(1);
  });

  it("keeps a test-directory file's unclaimed code hunk in Tests, beside its docs hunk in Documentation", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("tests/engine.go", goSplitPatch)] },
      unreadable,
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map([
        [
          "tests/engine.go",
          {
            kind: "split",
            shares: [
              { section: "tests", hunks: [{ first: 2, last: 2 }], lines: { added: 1, removed: 1 } },
              {
                section: "docs",
                hunks: [{ first: 10, last: 10 }],
                lines: { added: 1, removed: 1 },
              },
            ],
          },
        ],
      ]),
      lines: new Map([["tests/engine.go", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });

  it("leaves a renamed mixed file out of the placements, without reading it", async () => {
    const client = fakeClient(
      {
        ok: true,
        files: [
          {
            kind: "text",
            path: "src/render.rs",
            previousPath: "src/old_render.rs",
            status: "renamed",
            patch: renderSplitPatch,
          },
        ],
      },
      { ok: true, text: renderSplitHead },
    );

    expect(await readIntent(client)).toEqual({
      ok: true,
      placements: new Map(),
      lines: new Map([["src/render.rs", { added: 2, removed: 2 }]]),
    });
    expect(client.fileContent).not.toHaveBeenCalled();
  });
});

describe("intentFor", () => {
  it("resolves a commit-filtered route without connecting", async () => {
    const connect = vi.fn((_diff: DiffRef) => fakeClient({ ok: true, files: [] }, unreadable));

    const result = await intentFor(
      { diff: pr, commitFiltered: true },
      new AbortController().signal,
      connect,
    );

    expect(result).toEqual({ ok: false, problem: "commit-filtered" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports no progress for a commit-filtered route", async () => {
    const onProgress = vi.fn();

    await intentFor(
      { diff: pr, commitFiltered: true },
      new AbortController().signal,
      () => fakeClient({ ok: true, files: [] }, unreadable),
      onProgress,
    );

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("passes progress through to readIntent", async () => {
    const client = fakeClient(
      { ok: true, files: [modified("src/parser.rs", parserPatch)] },
      unreadable,
    );
    const onProgress = vi.fn();

    await intentFor(route, new AbortController().signal, () => client, onProgress);

    expect(onProgress.mock.calls).toEqual([[{ checked: 0, total: 1 }], [{ checked: 1, total: 1 }]]);
  });

  it("connects to the route's PR, and closes the client when the signal aborts", async () => {
    const client = fakeClient({ ok: true, files: [] }, unreadable);
    const connect = vi.fn((_diff: DiffRef) => client);
    const controller = new AbortController();

    await intentFor(route, controller.signal, connect);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(pr);
    expect(client.close).not.toHaveBeenCalled();

    controller.abort();

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
