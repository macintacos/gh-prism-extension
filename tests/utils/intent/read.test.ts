import { describe, expect, it, vi } from "vitest";
import type { FilesRoute } from "../../../utils/github/files-route";
import type { PrFileDiff } from "../../../utils/github/pr-diff";
import type { DiffPin, DiffRef, PrRef } from "../../../utils/github/pr-ref";
import type { PrFileContentResult, PrFilesResult } from "../../../utils/github/pr-source";
import type { IntentCache } from "../../../utils/intent/cache";
import {
  type FileLines,
  HEAD_READS_AT_ONCE,
  type IntentResult,
  type IntentSection,
  intentFor,
  type Placement,
  readIntent,
} from "../../../utils/intent/read";
import { lines } from "../../fixtures/head-scan";

const pr: PrRef = { kind: "pr", owner: "macintacos", repo: "gh-prism-sandbox", number: 1 };
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

const headSha = "c".repeat(40);

function fakeClient(files: PrFilesResult, content: PrFileContentResult) {
  return {
    files: vi.fn(async () => (files.ok ? { ...files, headSha } : files)),
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

  it("reads at most HEAD_READS_AT_ONCE heads at once, and reports progress once per file", async () => {
    const fileCount = HEAD_READS_AT_ONCE * 3;
    const files = Array.from({ length: fileCount }, (_, i) =>
      modified(`src/r${i}.rs`, renderPatch),
    );

    let inFlight = 0;
    let peak = 0;

    const client = {
      files: async (): Promise<PrFilesResult> => ({ ok: true, files }),
      fileContent: vi.fn(async (_path: string): Promise<PrFileContentResult> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return { ok: true, text: renderHead };
      }),
    };
    const onProgress = vi.fn();

    await readIntent(client, onProgress);

    expect(peak).toBe(HEAD_READS_AT_ONCE);
    expect(client.fileContent).toHaveBeenCalledTimes(fileCount);
    expect(onProgress).toHaveBeenCalledTimes(fileCount + 1);
    expect(onProgress).toHaveBeenLastCalledWith({ checked: fileCount, total: fileCount });
  });

  it("keeps the diff's file order when reads finish out of order", async () => {
    const fileCount = HEAD_READS_AT_ONCE + 2;
    const paths = Array.from({ length: fileCount }, (_, i) => `src/notes${i}.rs`);
    const files = paths.map((path) => modified(path, notesPatch));

    const client = {
      files: async (): Promise<PrFilesResult> => ({ ok: true, files }),
      fileContent: async (path: string): Promise<PrFileContentResult> => {
        await new Promise((resolve) => setTimeout(resolve, fileCount - paths.indexOf(path)));
        return { ok: true, text: notesHead };
      },
    };

    const result = await readIntent(client);

    if (!result.ok) throw new Error(result.problem);
    expect([...result.placements.keys()]).toEqual(paths);
    expect(result).toEqual(
      await readIntent(fakeClient({ ok: true, files }, { ok: true, text: notesHead })),
    );
  });
});

/** An in-memory cache. */
function memoryCache(): IntentCache {
  const stored = new Map<string, Extract<IntentResult, { ok: true }>>();

  return {
    get: async (key) => stored.get(key),
    set: async (key, intent) => {
      stored.set(key, intent);
    },
  };
}

const noAccess: PrFileContentResult = { ok: false, problem: "no-access" };

/** Opens the route twice with `cache`, first through `first` and then through `second`. */
async function visitTwice(
  cache: IntentCache,
  first: ReturnType<typeof fakeClient>,
  second: ReturnType<typeof fakeClient>,
) {
  await intentFor(route, new AbortController().signal, { connect: () => first, cache });
  return intentFor(route, new AbortController().signal, { connect: () => second, cache });
}

describe("intentFor", () => {
  it("resolves a commit-filtered route without connecting", async () => {
    const connect = vi.fn((_diff: DiffRef) => fakeClient({ ok: true, files: [] }, unreadable));

    const result = await intentFor(
      { diff: pr, commitFiltered: true },
      new AbortController().signal,
      { connect, cache: memoryCache() },
    );

    expect(result).toEqual({ ok: false, problem: "commit-filtered" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports no progress for a commit-filtered route", async () => {
    const onProgress = vi.fn();

    await intentFor(
      { diff: pr, commitFiltered: true },
      new AbortController().signal,
      { connect: () => fakeClient({ ok: true, files: [] }, unreadable), cache: memoryCache() },
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

    await intentFor(
      route,
      new AbortController().signal,
      { connect: () => client, cache: memoryCache() },
      onProgress,
    );

    expect(onProgress.mock.calls).toEqual([[{ checked: 0, total: 1 }], [{ checked: 1, total: 1 }]]);
  });

  it("connects to the route's PR, and closes the client when the signal aborts", async () => {
    const client = fakeClient({ ok: true, files: [] }, unreadable);
    const connect = vi.fn((_diff: DiffRef) => client);
    const controller = new AbortController();

    await intentFor(route, controller.signal, { connect, cache: memoryCache() });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(pr);
    expect(client.close).not.toHaveBeenCalled();

    controller.abort();

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("answers a revisit to the same diff from the cache, reading no file's content", async () => {
    const files: PrFilesResult = { ok: true, files: [modified("src/render.rs", renderPatch)] };
    const first = fakeClient(files, noAccess);
    const second = fakeClient(files, noAccess);

    const revisited = await visitTwice(memoryCache(), first, second);

    expect(revisited).toEqual(await readIntent(fakeClient(files, noAccess)));
    expect(first.fileContent).toHaveBeenCalled();
    expect(second.fileContent).not.toHaveBeenCalled();
  });

  it("reads again when the same head's diff has changed, as when its base moves", async () => {
    const first = fakeClient(
      { ok: true, files: [modified("src/render.rs", renderPatch)] },
      noAccess,
    );
    const second = fakeClient(
      {
        ok: true,
        files: [modified("src/parser.rs", parserPatch), modified("src/render.rs", renderPatch)],
      },
      noAccess,
    );

    await visitTwice(memoryCache(), first, second);

    expect(second.fileContent).toHaveBeenCalled();
  });

  it("reads again when a file's content failed to load the first time", async () => {
    const files: PrFilesResult = { ok: true, files: [modified("src/render.rs", renderPatch)] };
    const second = fakeClient(files, noAccess);

    await visitTwice(memoryCache(), fakeClient(files, unreadable), second);

    expect(second.fileContent).toHaveBeenCalled();
  });

  const pin: DiffPin = { baseSha: "b".repeat(40), headSha };
  const files: PrFilesResult = { ok: true, files: [modified("src/render.rs", renderPatch)] };
  const spiedConnect = () => vi.fn((_diff: DiffRef) => fakeClient(files, noAccess));
  const visit = (sources: Parameters<typeof intentFor>[2]) =>
    intentFor(route, new AbortController().signal, sources);

  it("lands a pinned revisit from the cache without fetching the diff or any head", async () => {
    const cache = memoryCache();
    const first = await visit({
      connect: () => fakeClient(files, noAccess),
      cache,
      pinOf: () => pin,
    });
    const connect = spiedConnect();

    const second = await visit({ connect, cache, pinOf: () => pin });

    expect(second).toEqual(first);
    expect(connect).not.toHaveBeenCalled();
  });

  it("finds a pinned read again on a visit without a pin", async () => {
    const cache = memoryCache();
    await visit({ connect: () => fakeClient(files, noAccess), cache, pinOf: () => pin });
    const second = fakeClient(files, noAccess);

    await visit({ connect: () => second, cache });

    expect(second.fileContent).not.toHaveBeenCalled();
  });

  it("pins a cached diff on its first pinned visit", async () => {
    const cache = memoryCache();
    await visit({ connect: () => fakeClient(files, noAccess), cache });
    const second = fakeClient(files, noAccess);
    await visit({ connect: () => second, cache, pinOf: () => pin });
    const connect = spiedConnect();

    await visit({ connect, cache, pinOf: () => pin });

    expect(second.files).toHaveBeenCalled();
    expect(second.fileContent).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("reads the diff when the pin's base differs", async () => {
    const cache = memoryCache();
    await visit({ connect: () => fakeClient(files, noAccess), cache, pinOf: () => pin });
    const connect = spiedConnect();

    await visit({ connect, cache, pinOf: () => ({ ...pin, baseSha: "e".repeat(40) }) });

    expect(connect).toHaveBeenCalled();
  });

  it("keeps a commit-filtered route path-only without looking up its pin", async () => {
    const cache = memoryCache();
    const get = vi.spyOn(cache, "get");
    const pinOf = vi.fn(() => pin);
    const connect = spiedConnect();

    await intentFor({ diff: pr, commitFiltered: true }, new AbortController().signal, {
      connect,
      cache,
      pinOf,
    });

    expect(pinOf).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("closes the client when the visit aborts during the pinned lookup", async () => {
    const controller = new AbortController();
    const cache: IntentCache = {
      get: async (key) => {
        if (key.includes("...")) controller.abort();
        return undefined;
      },
      set: async () => {},
    };
    const client = fakeClient(files, noAccess);

    void intentFor(route, controller.signal, { connect: () => client, cache, pinOf: () => pin });
    await vi.waitFor(() => expect(client.close).toHaveBeenCalled());

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("doesn't pin a read at another head", async () => {
    const cache = memoryCache();
    const pinAtOtherHead: DiffPin = { ...pin, headSha: "d".repeat(40) };
    await visit({ connect: () => fakeClient(files, noAccess), cache, pinOf: () => pinAtOtherHead });
    const connect = spiedConnect();

    await visit({ connect, cache, pinOf: () => pinAtOtherHead });

    expect(connect).toHaveBeenCalled();
  });

  it("files a cached read only under the head it was read at", async () => {
    const cache = memoryCache();
    const pinAtOtherHead: DiffPin = { ...pin, headSha: "d".repeat(40) };
    await visit({ connect: () => fakeClient(files, noAccess), cache });
    await visit({ connect: () => fakeClient(files, noAccess), cache, pinOf: () => pinAtOtherHead });
    const connect = spiedConnect();

    await visit({ connect, cache, pinOf: () => pinAtOtherHead });

    expect(connect).toHaveBeenCalled();
  });

  it("stores a read under its keys one at a time", async () => {
    const stored: string[] = [];
    let release = () => {};

    const cache: IntentCache = {
      get: async () => undefined,
      set: (key) => {
        stored.push(key);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };

    await visit({ connect: () => fakeClient(files, noAccess), cache, pinOf: () => pin });
    await vi.waitFor(() => expect(stored).toHaveLength(1));
    await Promise.resolve();
    expect(stored).toHaveLength(1);
    release();

    await vi.waitFor(() => expect(stored).toHaveLength(2));
  });

  it("stores nothing when the diff can't be read", async () => {
    const cache = memoryCache();
    const set = vi.spyOn(cache, "set");

    await intentFor(route, new AbortController().signal, {
      connect: () => fakeClient({ ok: false, problem: "rate-limited" }, unreadable),
      cache,
    });

    expect(set).not.toHaveBeenCalled();
  });
});
