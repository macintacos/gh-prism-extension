import { describe, expect, it } from "vitest";
import type { DocVerdict } from "../utils/doc-intent";
import { docHunkVerdict, docHunkVerdicts, scanHeadText } from "../utils/doc-intent";
import type { PrFileDiff, PrHunk } from "../utils/pr-diff";
import { parsePrHunks } from "../utils/pr-diff";

const lines = (...text: string[]) => text.join("\n");

const hunkOf = (patch: string): PrHunk => {
  const [hunk] = parsePrHunks(patch);
  if (hunk === undefined) throw new Error("patch has no hunk");
  return hunk;
};

const modified = (path: string, patch: string): PrFileDiff => ({
  kind: "text",
  path,
  status: "modified",
  patch,
});

const headOf = (path: string, text: string) => {
  const head = scanHeadText(path, text);
  if (head === undefined) throw new Error(`no comment syntax for ${path}`);
  return head;
};

// The new side of src/notes.rs, lines 1–23: the block opened on line 1 is still open before hunk 2.
const notesProse = [
  "/*",
  "Design notes for the fixture engine.",
  "The engine reads text and splits it into lines.",
  "Each line is trimmed of surrounding whitespace first.",
  "Empty lines never reach the limit check.",
  "The limit counts kept lines, not input lines.",
  "Rendering happens after the limit is applied.",
  "The renderer only knows about bullets and headings.",
  "Headings use a single hash and a space.",
  "Bullets use a dash unless config says otherwise.",
  "Config is read once at startup.",
  "A timeout guards slow inputs.",
  "The timeout is measured in milliseconds.",
  "Generated schema code lives in its own folder.",
  "Nobody edits generated code by hand.",
  "Helpers stay small and have no state.",
  "Tests live both inline and in the tests folder.",
  "Inline tests cover private helpers.",
  "Integration tests cover the public engine.",
  "The lockfile pins every dependency.",
  "Docs describe behaviour, not internals.",
  "The guide is the entry point for new readers.",
  "Notes like these are for maintainers.",
];
const notesHead = lines(...notesProse);
// The same head, with the block closed on line 23, so hunk 2 starts in code.
const notesHeadClosed = lines(...notesProse.slice(0, 22), "*/");

const parserHunk = lines(
  "@@ -1,6 +1,6 @@",
  " /// Splits input into trimmed, non-empty lines.",
  " ///",
  "-/// Blank lines are dropped.",
  "+/// Blank and whitespace-only lines are dropped.",
  " pub fn parse(input: &str) -> Vec<String> {",
  "     input",
  "         .lines()",
);

const notesHunk1 = lines(
  "@@ -1,7 +1,7 @@",
  " /*",
  " Design notes for the fixture engine.",
  " The engine reads text and splits it into lines.",
  "-Each line is trimmed before anything else happens.",
  "+Each line is trimmed of surrounding whitespace first.",
  " Empty lines never reach the limit check.",
  " The limit counts kept lines, not input lines.",
  " Rendering happens after the limit is applied.",
);

const notesHunk2 = lines(
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

const renderPatch = lines(
  "@@ -2,7 +2,7 @@",
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

const pythonDocstring = (quote: string) =>
  lines(
    "@@ -3,5 +3,5 @@",
    " def run(text):",
    `     ${quote}Runs the tool.`,
    " ",
    "-    Keeps the first lines.",
    "+    Keeps the first non-blank lines.",
    `     ${quote}`,
  );
const pythonDocstringHead = (quote: string) =>
  lines(
    "import re",
    "",
    "def run(text):",
    `    ${quote}Runs the tool.`,
    "",
    "    Keeps the first non-blank lines.",
    `    ${quote}`,
  );

const sqlCallPatch = lines(
  "@@ -3,4 +3,4 @@",
  " cursor.execute(",
  '     """',
  "-    SELECT * FROM users",
  "+    SELECT * FROM accounts",
  '     """,',
);
const printCallPatch = lines(
  "@@ -3,3 +3,3 @@",
  " print(",
  '-    """Usage: tool"""',
  '+    """Usage: tool --force"""',
  " )",
);

interface HunkCase {
  name: string;
  path: string;
  patch: string;
  verdict: DocVerdict;
}

interface HeadHunkCase {
  name: string;
  path: string;
  patch: string;
  headText: string;
  verdict: "docs" | "path";
}

const hunkCases: HunkCase[] = [
  {
    name: "TypeScript: a changed // line is docs",
    path: "src/app.ts",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input: string) {",
      "-  // Trims each line.",
      "+  // Trims each line and drops blanks.",
      "   return parse(input);",
    ),
    verdict: "docs",
  },
  {
    name: "TypeScript: a changed code line is path",
    path: "src/app.ts",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input: string) {",
      "-  return parse(input);",
      "+  return parse(input.trim());",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "TypeScript: a changed code line with a trailing line comment is path",
    path: "src/app.ts",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input: string) {",
      "-  run(input); // note",
      "+  run(input.trim()); // note",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "TypeScript: a hunk whose only changes are blank lines is path",
    path: "src/app.ts",
    patch: lines(
      "@@ -6,4 +6,4 @@",
      "   return parse(input);",
      " }",
      "-",
      "+  ",
      " export function next() {",
    ),
    verdict: "path",
  },
  {
    name: "TypeScript: a code change beside a comment change in one hunk is path",
    path: "src/app.ts",
    patch: lines(
      "@@ -5,4 +5,4 @@",
      " export function run(input: string) {",
      "-  // Trims each line.",
      "+  // Trims each line and drops blanks.",
      "-  return parse(input);",
      "+  return parse(input.trim());",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "TypeScript: a changed line inside a /** */ block is docs",
    path: "src/app.ts",
    patch: lines(
      "@@ -7,4 +7,4 @@",
      " /**",
      "- * Returns the first line.",
      "+ * Returns the first non-blank line.",
      " */",
      " export function first() {",
    ),
    verdict: "docs",
  },
  {
    name: "TypeScript: a /* inside a string literal opens no comment",
    path: "src/app.ts",
    patch: lines("@@ -4,3 +4,3 @@", ' let s = "/*";', "-// note", "+// note: changed", " x();"),
    verdict: "docs",
  },
  {
    name: "TypeScript: a code change after a /* inside a string literal is path",
    path: "src/app.ts",
    patch: lines("@@ -4,3 +4,3 @@", ' let s = "/*";', "-x();", "+y();", " z();"),
    verdict: "path",
  },
  {
    name: "TypeScript: a changed closer after code needs content",
    path: "src/app.ts",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " const a = 1;",
      "-x(); /* note */",
      "+x(); /* note: changed */",
      " const b = 2;",
    ),
    verdict: "needs-content",
  },
  {
    name: "TypeScript: an edit inside a long /** */ block with neither delimiter in view needs content",
    path: "src/app.ts",
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " * Returns the first line.",
      "-* Trims surrounding whitespace.",
      "+* Trims surrounding whitespace and blank lines.",
      " * Empty input gives an empty string.",
    ),
    verdict: "needs-content",
  },
  {
    name: "TypeScript: wrapping a function in /* */ in one hunk needs content",
    path: "src/app.ts",
    patch: lines("@@ -3,2 +3,4 @@", " const a = 1;", "+/*", " function f() { return 1; }", "+*/"),
    verdict: "needs-content",
  },
  {
    name: "JavaScript: a changed /** */ line is docs",
    path: "src/app.js",
    patch: lines(
      "@@ -7,4 +7,4 @@",
      " /**",
      "- * Returns the first line.",
      "+ * Returns the first non-blank line.",
      " */",
      " export function first() {",
    ),
    verdict: "docs",
  },
  {
    name: "JavaScript: a changed code line is path",
    path: "src/app.js",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input) {",
      "-  return parse(input);",
      "+  return parse(input.trim());",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "JavaScript: a changed // line is docs",
    path: "src/app.js",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input) {",
      "-  // Trims each line.",
      "+  // Trims each line and drops blanks.",
      "   return parse(input);",
    ),
    verdict: "docs",
  },
  {
    name: "JavaScript: a code line with a trailing // note is path",
    path: "src/app.js",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " export function run(input) {",
      "-  run(input); // note",
      "+  run(input.trim()); // note",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "JavaScript: a hunk whose only changes are blank lines is path",
    path: "src/app.js",
    patch: lines(
      "@@ -6,4 +6,4 @@",
      "   return parse(input);",
      " }",
      "-",
      "+  ",
      " export function next() {",
    ),
    verdict: "path",
  },
  {
    name: "JavaScript: a code change beside a comment change in one hunk is path",
    path: "src/app.js",
    patch: lines(
      "@@ -5,4 +5,4 @@",
      " export function run(input) {",
      "-  // Trims each line.",
      "+  // Trims each line and drops blanks.",
      "-  return parse(input);",
      "+  return parse(input.trim());",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "Go: a changed // line is docs",
    path: "engine/engine.go",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " ",
      "-// Run keeps the first lines.",
      "+// Run keeps the first non-blank lines.",
      " func Run(input string) []string {",
    ),
    verdict: "docs",
  },
  {
    name: "Go: a changed /* */ comment is docs",
    path: "engine/engine.go",
    patch: lines(
      "@@ -2,3 +2,3 @@",
      " ",
      "-/* Run keeps the first lines. */",
      "+/* Run keeps the first non-blank lines. */",
      " func Run(input string) []string {",
    ),
    verdict: "docs",
  },
  {
    name: "Go: a changed code line is path",
    path: "engine/engine.go",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " func Run(input string) []string {",
      "-\treturn parse(input)",
      "+\treturn parse(input, true)",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "Go: a changed code line with a trailing // comment is path",
    path: "engine/engine.go",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " func Run(input string) []string {",
      "-\trun(input) // note",
      "+\trun(input, nil) // note",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "Go: a hunk whose only changes are blank lines is path",
    path: "engine/engine.go",
    patch: lines("@@ -6,4 +6,4 @@", " \treturn parse(input)", " }", "-", "+\t", " func Next() {"),
    verdict: "path",
  },
  {
    name: "Go: a code change beside a comment change in one hunk is path",
    path: "engine/engine.go",
    patch: lines(
      "@@ -4,4 +4,4 @@",
      " func Run(input string) []string {",
      "-// Trims each line.",
      "+// Trims each line and drops blanks.",
      "-\treturn parse(input)",
      "+\treturn parse(input, true)",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "Go: unwrapping a function from /* */ in one hunk needs content",
    path: "engine/engine.go",
    patch: lines(
      "@@ -3,6 +3,4 @@",
      " var x = 1",
      "-/*",
      " func f() int {",
      "\treturn 1",
      " }",
      "-*/",
    ),
    verdict: "needs-content",
  },
  {
    name: "Go: a changed //go:build line is path",
    path: "engine/engine.go",
    patch: lines(
      "@@ -1,3 +1,3 @@",
      "-//go:build linux",
      "+//go:build darwin",
      " ",
      " package engine",
    ),
    verdict: "path",
  },
  {
    name: "Go: a changed // +build line is path",
    path: "engine/engine.go",
    patch: lines(
      "@@ -1,3 +1,3 @@",
      "-// +build linux",
      "+// +build darwin",
      " ",
      " package engine",
    ),
    verdict: "path",
  },
  {
    name: "Rust: a /// docstring edit in src/parser.rs is docs",
    path: "src/parser.rs",
    patch: parserHunk,
    verdict: "docs",
  },
  {
    name: "Rust: a changed //! line is docs",
    path: "src/engine.rs",
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " ",
      "-//! Engine docs.",
      "+//! Engine docs for maintainers.",
      " pub mod engine;",
    ),
    verdict: "docs",
  },
  {
    name: "Rust: a changed /** */ block is docs",
    path: "src/engine.rs",
    patch: lines(
      "@@ -7,4 +7,4 @@",
      " /**",
      "- * Runs the engine.",
      "+ * Runs the engine on each line.",
      " */",
      " pub fn run() {",
    ),
    verdict: "docs",
  },
  {
    name: "Rust: a changed /*! */ block is docs",
    path: "src/engine.rs",
    patch: lines(
      "@@ -2,3 +2,3 @@",
      " pub mod engine;",
      "-/*! Engine docs. */",
      "+/*! Engine docs for maintainers. */",
      " pub mod notes;",
    ),
    verdict: "docs",
  },
  {
    name: "Rust: a changed code line is path",
    path: "src/engine.rs",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      "     items.iter()",
      "-        .map(|item| item.trim())",
      "+        .map(|item| item.trim().to_owned())",
      "         .collect()",
    ),
    verdict: "path",
  },
  {
    name: "Rust: a changed code line with a trailing // comment is path",
    path: "src/engine.rs",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " pub fn run(input: &str) {",
      "-    let n = self.limit; // cap",
      "+    let n = self.limit.max(1); // cap",
      "     n",
    ),
    verdict: "path",
  },
  {
    name: "Rust: a hunk whose only changes are blank lines is path",
    path: "src/engine.rs",
    patch: lines("@@ -6,4 +6,4 @@", "     input", " }", "-", "+    ", " pub fn next() {"),
    verdict: "path",
  },
  {
    name: "Rust: a code change beside a comment change in one hunk is path",
    path: "src/engine.rs",
    patch: lines(
      "@@ -4,4 +4,4 @@",
      " pub fn run(input: &str) {",
      "-    // Trims each line.",
      "+    // Trims each line and drops blanks.",
      "-    parse(input)",
      "+    parse(input.trim())",
      " }",
    ),
    verdict: "path",
  },
  {
    name: "Rust: block-comment prose with no delimiter in view is path without a read",
    path: "src/notes.rs",
    patch: lines(
      "@@ -5,3 +5,3 @@",
      " The engine reads text and splits it into lines.",
      "-Each line is trimmed before anything else happens.",
      "+Each line is trimmed of surrounding whitespace first.",
      " Empty lines never reach the limit check.",
    ),
    verdict: "path",
  },
  {
    name: "Rust: the first hunk of src/notes.rs is docs",
    path: "src/notes.rs",
    patch: notesHunk1,
    verdict: "docs",
  },
  {
    name: "Rust: the second hunk of src/notes.rs, which ends on */, needs content",
    path: "src/notes.rs",
    patch: notesHunk2,
    verdict: "needs-content",
  },
  {
    name: "Python: a changed # line is docs",
    path: "tool/run.py",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " ",
      "-# Keeps the first lines.",
      "+# Keeps the first non-blank lines.",
      " def run(text):",
    ),
    verdict: "docs",
  },
  {
    name: "Python: a changed code line is path",
    path: "tool/run.py",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " def run(text):",
      "-    return text[:limit]",
      "+    return text[:limit + 1]",
      " ",
    ),
    verdict: "path",
  },
  {
    name: "Python: a changed code line with a trailing # comment is path",
    path: "tool/run.py",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " def run(text):",
      "-    run(text)  # note",
      "+    run(text.strip())  # note",
      " ",
    ),
    verdict: "path",
  },
  {
    name: "Python: a hunk whose only changes are blank lines is path",
    path: "tool/run.py",
    patch: lines("@@ -4,3 +4,3 @@", " def run(text):", "-", "+    ", "     return text"),
    verdict: "path",
  },
  {
    name: "Python: a code change beside a comment change in one hunk is path",
    path: "tool/run.py",
    patch: lines(
      "@@ -4,4 +4,4 @@",
      " def run(text):",
      "-# Keeps the first lines.",
      "+# Keeps the first non-blank lines.",
      "-    return text[:limit]",
      "+    return text[:limit + 1]",
      " ",
    ),
    verdict: "path",
  },
  {
    name: 'Python: a changed line of a """ docstring needs content',
    path: "tool/run.py",
    patch: pythonDocstring('"""'),
    verdict: "needs-content",
  },
  {
    name: "Python: a changed line of a ''' docstring needs content",
    path: "tool/run.py",
    patch: pythonDocstring("'''"),
    verdict: "needs-content",
  },
  {
    name: "Python: a changed # line in a hunk opening on a line-start triple quote needs content",
    path: "tool/run.py",
    patch: lines("@@ -2,3 +2,3 @@", ' """', "-# Old heading", "+# New heading", ' """'),
    verdict: "needs-content",
  },
  {
    name: "Python: a module docstring on line 1 is docs",
    path: "tool/run.py",
    patch: lines("@@ -1,3 +1,3 @@", '-"""Old."""', '+"""New."""', " ", " import os"),
    verdict: "docs",
  },
  {
    name: "Python: a triple-quoted SQL string passed to a call is path",
    path: "tool/run.py",
    patch: sqlCallPatch,
    verdict: "path",
  },
  {
    name: "Python: a triple-quoted message passed to print() is path",
    path: "tool/run.py",
    patch: printCallPatch,
    verdict: "path",
  },
  {
    name: "Python: a code change in a hunk opening inside a docstring is path from the patch alone",
    path: "tool/run.py",
    patch: lines("@@ -3,3 +3,3 @@", " more text", '     """', "-    x = 1", "+    x = 2"),
    verdict: "path",
  },
  {
    name: "Python: a code change after a multi-line assigned string needs content",
    path: "tool/run.py",
    patch: lines("@@ -3,4 +3,4 @@", ' """', " ", " def run():", "-    return 1", "+    return 2"),
    verdict: "needs-content",
  },
  {
    name: 'Python: a changed # line before a closing """ needs content, since that quote may open a string',
    path: "tool/run.py",
    patch: lines("@@ -3,3 +3,3 @@", " def run(text):", "-# note", "+# note: changed", '     """'),
    verdict: "needs-content",
  },
  {
    name: "Lua: a changed -- line is docs",
    path: "init.lua",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " local M = {}",
      "--- Runs the engine.",
      "+-- Runs the engine on each line.",
      " function M.run(t)",
    ),
    verdict: "docs",
  },
  {
    name: "Lua: a changed --- line is docs",
    path: "init.lua",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " local M = {}",
      "---- Runs the engine.",
      "+--- Runs the engine on each line.",
      " function M.run(t)",
    ),
    verdict: "docs",
  },
  {
    name: "Lua: a changed --[[ ]] comment is docs",
    path: "init.lua",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " local M = {}",
      "---[[ Runs the engine. ]]",
      "+--[[ Runs the engine on each line. ]]",
      " function M.run(t)",
    ),
    verdict: "docs",
  },
  {
    name: "Lua: a changed code line is path",
    path: "init.lua",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " local M = {}",
      "-local n = #t",
      "+local n = #t + 1",
      " function M.run(t)",
    ),
    verdict: "path",
  },
  {
    name: "Lua: a changed code line with a trailing -- comment is path",
    path: "init.lua",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " local M = {}",
      "-run(t) -- note",
      "+run(t, 1) -- note",
      " function M.run(t)",
    ),
    verdict: "path",
  },
  {
    name: "Lua: a hunk whose only changes are blank lines is path",
    path: "init.lua",
    patch: lines("@@ -4,3 +4,3 @@", " local M = {}", "-", "+  ", " function M.run(t)"),
    verdict: "path",
  },
  {
    name: "Lua: a code change beside a comment change in one hunk is path",
    path: "init.lua",
    patch: lines(
      "@@ -4,4 +4,4 @@",
      " local M = {}",
      "--- Runs the engine.",
      "+-- Runs the engine on each line.",
      "-local n = #t",
      "+local n = #t + 1",
      " function M.run(t)",
    ),
    verdict: "path",
  },
  {
    name: "Lua: a changed line ending in ]] needs content",
    path: "init.lua",
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " local a = {1, 2}",
      "-local v = t[a[1]]",
      "+local v = t[a[2]]",
      " return v",
    ),
    verdict: "needs-content",
  },
];

const headCases: HeadHunkCase[] = [
  {
    name: "TypeScript: a changed closer after code is path once the head shows code before the hunk",
    path: "src/app.ts",
    patch: lines(
      "@@ -4,3 +4,3 @@",
      " const a = 1;",
      "-x(); /* note */",
      "+x(); /* note: changed */",
      " const b = 2;",
    ),
    headText: lines(
      "const z = 0;",
      "const y = 1;",
      "const w = 2;",
      "const a = 1;",
      "x(); /* note: changed */",
      "const b = 2;",
    ),
    verdict: "path",
  },
  {
    name: "TypeScript: a /** */ gutter edit is docs once the head opens the block",
    path: "src/app.ts",
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " * Returns the first line.",
      "-* Trims surrounding whitespace.",
      "+* Trims surrounding whitespace and blank lines.",
      " * Empty input gives an empty string.",
    ),
    headText: lines(
      "/**",
      "* Summary.",
      "* Returns the first line.",
      "* Trims surrounding whitespace and blank lines.",
      "* Empty input gives an empty string.",
      " */",
    ),
    verdict: "docs",
  },
  {
    name: 'Python: a """ docstring edit is docs when the head\'s function starts in code',
    path: "tool/run.py",
    patch: pythonDocstring('"""'),
    headText: pythonDocstringHead('"""'),
    verdict: "docs",
  },
  {
    name: "Python: a ''' docstring edit is docs when the head's function starts in code",
    path: "tool/run.py",
    patch: pythonDocstring("'''"),
    headText: pythonDocstringHead("'''"),
    verdict: "docs",
  },
  {
    name: "Python: a hunk opening inside a docstring is path once the head is inside the docstring",
    path: "tool/run.py",
    patch: lines("@@ -3,3 +3,3 @@", " more text", '     """', "-    x = 1", "+    x = 2"),
    headText: lines(
      '"""Builds the report.',
      "The header comes first.",
      "more text",
      '    """',
      "    x = 2",
    ),
    verdict: "path",
  },
  {
    name: "Python: a code change after a multi-line assigned string is path once the head is inside the string",
    path: "tool/run.py",
    patch: lines("@@ -3,4 +3,4 @@", ' """', " ", " def run():", "-    return 1", "+    return 2"),
    headText: lines('HELP = """', "Usage: tool", '"""', "", "def run():", "    return 2"),
    verdict: "path",
  },
  {
    name: "Lua: a changed line ending in ]] is path once the head shows code before the hunk",
    path: "init.lua",
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " local a = {1, 2}",
      "-local v = t[a[1]]",
      "+local v = t[a[2]]",
      " return v",
    ),
    headText: lines(
      "local t = {}",
      "local n = 2",
      "local a = {1, 2}",
      "local v = t[a[2]]",
      "return v",
    ),
    verdict: "path",
  },
  {
    name: "Rust: the second hunk of src/notes.rs is docs once the head shows the block open",
    path: "src/notes.rs",
    patch: notesHunk2,
    headText: notesHead,
    verdict: "docs",
  },
  {
    name: "TypeScript: wrapping a function in /* */ is path once the head shows code before the hunk",
    path: "src/app.ts",
    patch: lines("@@ -3,2 +3,4 @@", " const a = 1;", "+/*", " function f() { return 1; }", "+*/"),
    headText: lines(
      "const z = 0;",
      "const y = 1;",
      "const a = 1;",
      "/*",
      "function f() { return 1; }",
      "*/",
      "const b = 2;",
    ),
    verdict: "path",
  },
  {
    name: "Go: unwrapping a function from /* */ is path once the head shows code before the hunk",
    path: "engine/engine.go",
    patch: lines(
      "@@ -3,6 +3,4 @@",
      " var x = 1",
      "-/*",
      " func f() int {",
      "\treturn 1",
      " }",
      "-*/",
    ),
    headText: lines(
      "package engine",
      "",
      "var x = 1",
      "func f() int {",
      "\treturn 1",
      "}",
      "func g() {",
    ),
    verdict: "path",
  },
  {
    name: "Python: a triple-quoted SQL string passed to a call is path once the head shows a call above it",
    path: "tool/run.py",
    patch: sqlCallPatch,
    headText: lines(
      "import sqlite3",
      "cursor = connection.cursor()",
      "cursor.execute(",
      '    """',
      "    SELECT * FROM accounts",
      '    """,',
      ")",
    ),
    verdict: "path",
  },
  {
    name: "Python: a triple-quoted message passed to print() is path once the head shows a call above it",
    path: "tool/run.py",
    patch: printCallPatch,
    headText: lines("import sys", "main()", "print(", '    """Usage: tool --force"""', ")"),
    verdict: "path",
  },
  {
    name: "Python: a changed # line after a line-start triple quote is path once the head shows a call above it",
    path: "tool/run.py",
    patch: lines("@@ -2,3 +2,3 @@", ' """', "-# Old heading", "+# New heading", ' """'),
    headText: lines("html = render(", '"""', "# New heading", '"""', ")"),
    verdict: "path",
  },
  {
    name: "Rust: the second hunk of src/notes.rs is path once the head closes the block first",
    path: "src/notes.rs",
    patch: notesHunk2,
    headText: notesHeadClosed,
    verdict: "path",
  },
];

interface FileCase {
  name: string;
  file: PrFileDiff;
  verdicts: DocVerdict[];
}

const fileCases: FileCase[] = [
  {
    name: "Binary: a binary file has no hunks to judge",
    file: { kind: "binary", path: "web/public/logo.png", status: "added" },
    verdicts: [],
  },
  {
    name: "Unknown language: a Cargo.lock comment change is path",
    file: modified(
      "Cargo.lock",
      lines(
        "@@ -1,3 +1,3 @@",
        " # This file is automatically @generated by Cargo.",
        "-# It is not intended for manual editing.",
        "+# It is not meant for manual editing.",
        " version = 3",
      ),
    ),
    verdicts: ["path"],
  },
  {
    name: "Unknown language: a config/app.toml comment change is path",
    file: modified(
      "config/app.toml",
      lines(
        "@@ -2,3 +2,3 @@",
        " [server]",
        "-# Milliseconds before a request gives up.",
        "+# Milliseconds before a request is abandoned.",
        " timeout_ms = 500",
      ),
    ),
    verdicts: ["path"],
  },
  {
    name: "Empty patch: a pure rename has no hunks to judge",
    file: {
      kind: "text",
      path: "src/helpers.rs",
      previousPath: "src/util.rs",
      status: "renamed",
      patch: "",
    },
    verdicts: [],
  },
  {
    name: "TypeScript: a needs-content hunk beside a path hunk is left unresolved without a head",
    file: modified(
      "src/app.ts",
      lines(
        "@@ -4,3 +4,3 @@",
        " const a = 1;",
        "-x(); /* note */",
        "+x(); /* note: changed */",
        " const b = 2;",
        "@@ -20,2 +20,2 @@ export function run() {",
        "-  run();",
        "+  run(true);",
        " }",
      ),
    ),
    verdicts: ["needs-content", "path"],
  },
  {
    name: "Renamed: a renamed file has no hunks to judge, even with a // comment changed",
    file: {
      kind: "text",
      path: "src/b.ts",
      previousPath: "src/a.ts",
      status: "renamed",
      patch: lines(
        "@@ -1,3 +1,3 @@",
        " import { run } from './run';",
        "-// Old note.",
        "+// New note.",
        " export { run };",
      ),
    },
    verdicts: [],
  },
  {
    name: "TypeScript: wrapping a function in /* */ across two hunks, with no head text",
    file: modified(
      "src/app.ts",
      lines(
        "@@ -10,3 +10,4 @@",
        " export function run() {",
        "+/*",
        "   const a = 1;",
        "   const b = 2;",
        "@@ -30,2 +31,3 @@",
        "   return a + b;",
        " }",
        "+*/",
      ),
    ),
    verdicts: ["path", "needs-content"],
  },
  {
    name: "Rust: a deleted file whose removed lines are all // comments is docs",
    file: {
      kind: "text",
      path: "src/old_parser.rs",
      status: "deleted",
      patch: lines(
        "@@ -1,2 +0,0 @@",
        "-// Splits input into lines.",
        "-// Blank lines are dropped.",
      ),
    },
    verdicts: ["docs"],
  },
  {
    name: "Rust: src/parser.rs is docs",
    file: modified("src/parser.rs", parserHunk),
    verdicts: ["docs"],
  },
  {
    name: "Rust: src/render.rs's code hunk is path and its docs hunk is docs",
    file: modified("src/render.rs", renderPatch),
    verdicts: ["path", "docs"],
  },
  {
    name: "Rust: src/notes.rs's second hunk needs content without a head text",
    file: modified("src/notes.rs", lines(notesHunk1, notesHunk2)),
    verdicts: ["docs", "needs-content"],
  },
];

interface HeadFileCase {
  name: string;
  file: PrFileDiff;
  headText: string;
  verdicts: ("docs" | "path")[];
}

const proseHead = lines(
  "/*",
  "Design notes for the fixture engine.",
  "Summary of the engine.",
  "Behaviour is documented below.",
  "The engine reads text and splits it into lines.",
  "Each line is trimmed of surrounding whitespace first.",
  "Empty lines never reach the limit check.",
);

const headFileCases: HeadFileCase[] = [
  {
    name: "Rust: both hunks of src/notes.rs are docs once the head shows its block open",
    file: modified("src/notes.rs", lines(notesHunk1, notesHunk2)),
    headText: notesHead,
    verdicts: ["docs", "docs"],
  },
  {
    name: "Rust: src/notes.rs's second hunk is path once the head closes its block first",
    file: modified("src/notes.rs", lines(notesHunk1, notesHunk2)),
    headText: notesHeadClosed,
    verdicts: ["docs", "path"],
  },
  {
    name: "Rust: a prose hunk that is path from the patch stays path under a head that opens a block above it",
    file: modified(
      "src/notes.rs",
      lines(
        "@@ -5,3 +5,3 @@",
        " The engine reads text and splits it into lines.",
        "-Each line is trimmed before anything else happens.",
        "+Each line is trimmed of surrounding whitespace first.",
        " Empty lines never reach the limit check.",
      ),
    ),
    headText: proseHead,
    verdicts: ["path"],
  },
];

describe("docHunkVerdict", () => {
  it.each(hunkCases)("$name", ({ path, patch, verdict }) => {
    expect(docHunkVerdict(path, hunkOf(patch))).toBe(verdict);
  });

  it.each(headCases)("$name", ({ path, patch, headText, verdict }) => {
    expect(docHunkVerdict(path, hunkOf(patch), headOf(path, headText))).toBe(verdict);
  });
});

describe("docHunkVerdicts", () => {
  it.each(fileCases)("$name", ({ file, verdicts }) => {
    expect(docHunkVerdicts(file)).toEqual(verdicts);
  });

  it.each(headFileCases)("$name", ({ file, headText, verdicts }) => {
    expect(docHunkVerdicts(file, headOf(file.path, headText))).toEqual(verdicts);
  });
});

describe("scanHeadText", () => {
  it("Python: a line that starts inside a triple-quoted string reads as a string", () => {
    const head = headOf("src/app.py", lines('x = """', "column zero", '"""', "y = 1"));
    expect(head.kinds).toEqual(["code", "string", "string", "code"]);
  });
});
