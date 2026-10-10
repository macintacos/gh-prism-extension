import { describe, expect, it } from "vitest";
import type { PrFileDiff } from "../utils/pr-diff";
import { parsePrDiff } from "../utils/pr-diff";

const lines = (...text: string[]) => text.join("\n");

const guidePatch = lines(
  "@@ -1,6 +1,7 @@",
  " # Guide",
  " ",
  " Create an engine with a limit, then call `run` on some text.",
  "-The engine keeps the first lines up to the limit and drops the rest.",
  "+The engine keeps the first lines up to the limit and ignores the rest.",
  "+A zero limit still keeps the first line.",
  " ",
  " Pass the result to `render` to get a bulleted list.",
);
const enginePatch = lines(
  "@@ -11,7 +11,7 @@ impl Engine {",
  " ",
  "     pub fn run(&self, input: &str) -> Vec<String> {",
  "         let items = parse(input);",
  "-        items.into_iter().take(self.limit).collect()",
  "+        items.into_iter().take(self.limit.max(1)).collect()",
  "     }",
  " ",
  "     pub fn limit(&self) -> usize {",
);
const helpersPatch = lines(
  "@@ -11,5 +11,5 @@ pub fn is_blank(text: &str) -> bool {",
  " }",
  " ",
  " pub fn first_word(text: &str) -> &str {",
  '-    text.split_whitespace().next().unwrap_or("")',
  "+    text.split_whitespace().next().unwrap_or_default()",
  " }",
);
const catalogPatch = lines(
  "@@ -0,0 +1,2 @@",
  "+export const catalog = [",
  '+  { id: 1, name: "item-1" },',
);
const noNewlinePatch = lines("@@ -1 +1 @@", "-old", "+new", "\\ No newline at end of file");

const cases: [string, string, PrFileDiff[]][] = [
  [
    "two modified files",
    `${lines(
      "diff --git a/docs/guide.md b/docs/guide.md",
      "index bd94ee6..80088d3 100644",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      guidePatch,
      "diff --git a/src/engine.rs b/src/engine.rs",
      "index 0d4433b..6aad5c1 100644",
      "--- a/src/engine.rs",
      "+++ b/src/engine.rs",
      enginePatch,
    )}\n`,
    [
      { kind: "text", path: "docs/guide.md", status: "modified", patch: guidePatch },
      { kind: "text", path: "src/engine.rs", status: "modified", patch: enginePatch },
    ],
  ],
  [
    "a rename with edits",
    lines(
      "diff --git a/src/util.rs b/src/helpers.rs",
      "similarity index 80%",
      "rename from src/util.rs",
      "rename to src/helpers.rs",
      "index 2c18b6d..2cc0d47 100644",
      "--- a/src/util.rs",
      "+++ b/src/helpers.rs",
      helpersPatch,
    ),
    [
      {
        kind: "text",
        path: "src/helpers.rs",
        previousPath: "src/util.rs",
        status: "renamed",
        patch: helpersPatch,
      },
    ],
  ],
  [
    "an added binary",
    lines(
      "diff --git a/web/public/logo.png b/web/public/logo.png",
      "new file mode 100644",
      "index 0000000..613754c",
      "Binary files /dev/null and b/web/public/logo.png differ",
    ),
    [{ kind: "binary", path: "web/public/logo.png", status: "added" }],
  ],
  [
    "an added text file",
    lines(
      "diff --git a/web/src/data/catalog.ts b/web/src/data/catalog.ts",
      "new file mode 100644",
      "index 0000000..3af7dbf",
      "--- /dev/null",
      "+++ b/web/src/data/catalog.ts",
      catalogPatch,
    ),
    [{ kind: "text", path: "web/src/data/catalog.ts", status: "added", patch: catalogPatch }],
  ],
  [
    "a deleted file",
    lines(
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "index 1234567..0000000",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
    ),
    [{ kind: "text", path: "old.txt", status: "deleted", patch: lines("@@ -1 +0,0 @@", "-gone") }],
  ],
  [
    "a pure rename",
    lines(
      "diff --git a/a.txt b/b.txt",
      "similarity index 100%",
      "rename from a.txt",
      "rename to b.txt",
    ),
    [{ kind: "text", path: "b.txt", previousPath: "a.txt", status: "renamed", patch: "" }],
  ],
  [
    "a mode-only change",
    lines("diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"),
    [{ kind: "text", path: "run.sh", status: "modified", patch: "" }],
  ],
  [
    "a hunk without a newline at end of file",
    lines(
      "diff --git a/x.txt b/x.txt",
      "index 1111111..2222222 100644",
      "--- a/x.txt",
      "+++ b/x.txt",
      noNewlinePatch,
    ),
    [{ kind: "text", path: "x.txt", status: "modified", patch: noNewlinePatch }],
  ],
  [
    "a modified binary",
    lines(
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
    ),
    [{ kind: "binary", path: "img.png", status: "modified" }],
  ],
  [
    "a path with a space",
    lines(
      "diff --git a/docs/my notes.md b/docs/my notes.md",
      "index 1111111..2222222 100644",
      "--- a/docs/my notes.md\t",
      "+++ b/docs/my notes.md\t",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ),
    [
      {
        kind: "text",
        path: "docs/my notes.md",
        status: "modified",
        patch: lines("@@ -1 +1 @@", "-a", "+b"),
      },
    ],
  ],
  [
    "a C-quoted path",
    lines(
      String.raw`diff --git "a/caf\303\251.md" "b/caf\303\251.md"`,
      "index 1111111..2222222 100644",
      String.raw`--- "a/caf\303\251.md"`,
      String.raw`+++ "b/caf\303\251.md"`,
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ),
    [
      {
        kind: "text",
        path: "café.md",
        status: "modified",
        patch: lines("@@ -1 +1 @@", "-a", "+b"),
      },
    ],
  ],
  ["empty input", "", []],
];

describe("parsePrDiff", () => {
  it.each(cases)("parses %s", (_name, diff, expected) => {
    expect(parsePrDiff(diff)).toEqual(expected);
  });
});
