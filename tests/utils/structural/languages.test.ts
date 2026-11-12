import { describe, expect, it } from "vitest";
import { structuralChanges } from "../../../utils/structural/engine";
import { type Grammar, grammarOf } from "../../../utils/structural/grammar";
import { inputFor, parserFor, regionsOf, spanTexts } from "../../fixtures/structural";

/** The texts the engine marks as changed between `oldText` and `newText`, read as `path`'s language. */
async function changedTexts(path: string, oldText: string, newText: string) {
  const grammar = grammarOf(path) as Grammar;
  const result = await structuralChanges(
    inputFor({
      oldText,
      newText,
      language: { grammar, parser: await parserFor(grammar.id) },
      regions: regionsOf(oldText, newText),
    }),
  );

  if (!result.ok) throw new Error(`${path} refused: ${result.reason}`);
  return {
    old: spanTexts(oldText, result.changes.old),
    new: spanTexts(newText, result.changes.new),
  };
}

const NO_CHANGE = { old: [], new: [] };

/** What a comment must follow to parse, for the languages where it cannot open the file. */
const OPENERS: Record<string, string> = { "a.php": "<?php\n" };

/** A comment of one line comment per line of text, each after `marker`. */
const lineComments = (marker: string) => (lines: readonly string[]) =>
  `${lines.map((line) => `${marker} ${line}`).join("\n")}\n`;

/** A comment from `open` to `close` whose later lines have no leader. */
const blockComment = (open: string, close: string) => (lines: readonly string[]) =>
  `${open} ${lines.join("\n   ")} ${close}\n`;

/** A comment from `open` to `close`, one line of text after a `*` on each line between. */
const starComment = (open: string) => (lines: readonly string[]) =>
  `${open}\n${lines.map((line) => ` * ${line}`).join("\n")}\n */\n`;

const SLASHES = { style: "//", of: lineComments("//") };
const HASHES = { style: "#", of: lineComments("#") };
const BLOCK = { style: "/* */", of: blockComment("/*", "*/") };
const DOC_BLOCK = { style: "/** */", of: starComment("/**") };
const DOC_SLASHES = { style: "///", of: lineComments("///") };

/** Each comment style of each language that has comments; Markdown has none of its own. */
const COMMENTS = [
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.ts", ...comment })),
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.tsx", ...comment })),
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.js", ...comment })),
  { path: "a.py", ...HASHES },
  ...[SLASHES, DOC_SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.rs", ...comment })),
  { path: "a.rs", style: "//!", of: lineComments("//!") },
  { path: "a.rs", style: "/*! */", of: starComment("/*!") },
  ...[SLASHES, BLOCK].map((comment) => ({ path: "a.go", ...comment })),
  { path: "a.css", ...BLOCK },
  ...[SLASHES, BLOCK].map((comment) => ({ path: "a.jsonc", ...comment })),
  { path: "a.yaml", ...HASHES },
  { path: "a.toml", ...HASHES },
  { path: "a.sh", ...HASHES },
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.c", ...comment })),
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.cpp", ...comment })),
  { path: "a.lua", style: "--", of: lineComments("--") },
  { path: "a.lua", style: "---", of: lineComments("---") },
  { path: "a.lua", style: "--[[ ]]", of: blockComment("--[[", "]]") },
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "A.java", ...comment })),
  ...[SLASHES, HASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "a.php", ...comment })),
  { path: "a.rb", ...HASHES },
  {
    path: "a.rb",
    style: "=begin =end",
    of: (lines: readonly string[]) => `=begin\n${lines.join("\n")}\n=end\n`,
  },
  ...[SLASHES, DOC_SLASHES, BLOCK].map((comment) => ({ path: "A.cs", ...comment })),
  { path: "a.html", style: "<!-- -->", of: blockComment("<!--", "-->") },
  ...[SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "A.kt", ...comment })),
  ...[SLASHES, DOC_SLASHES, BLOCK, DOC_BLOCK].map((comment) => ({ path: "A.swift", ...comment })),
];

/** Each string style of each language that has strings, as a file holding `text` in one. */
const STRINGS: { path: string; style: string; of: (text: string) => string }[] = [
  { path: "a.ts", style: "'", of: (text) => `const s = '${text}';\n` },
  { path: "a.ts", style: '"', of: (text) => `const s = "${text}";\n` },
  { path: "a.ts", style: "`", of: (text) => `const s = \`${text}\`;\n` },
  { path: "a.tsx", style: "attribute", of: (text) => `const s = <p title="${text}" />;\n` },
  { path: "a.js", style: "'", of: (text) => `const s = '${text}';\n` },
  { path: "a.py", style: '"', of: (text) => `s = "${text}"\n` },
  { path: "a.py", style: '"""', of: (text) => `s = """${text}"""\n` },
  { path: "a.rs", style: '"', of: (text) => `const S: &str = "${text}";\n` },
  { path: "a.rs", style: 'r#""#', of: (text) => `const S: &str = r#"${text}"#;\n` },
  { path: "a.go", style: '"', of: (text) => `package main\n\nvar s = "${text}"\n` },
  { path: "a.go", style: "`", of: (text) => `package main\n\nvar s = \`${text}\`\n` },
  { path: "a.css", style: '"', of: (text) => `.a::after {\n  content: "${text}";\n}\n` },
  { path: "a.json", style: '"', of: (text) => `{ "s": "${text}" }\n` },
  { path: "a.yaml", style: "plain", of: (text) => `s: ${text}\n` },
  { path: "a.yaml", style: '"', of: (text) => `s: "${text}"\n` },
  { path: "a.yaml", style: "'", of: (text) => `s: '${text}'\n` },
  { path: "a.yaml", style: "|", of: (text) => `s: |\n  first line\n  ${text}\n  last line\n` },
  { path: "a.yaml", style: ">", of: (text) => `s: >\n  first line\n  ${text}\n  last line\n` },
  { path: "a.toml", style: '"', of: (text) => `s = "${text}"\n` },
  { path: "a.toml", style: "'", of: (text) => `s = '${text}'\n` },
  { path: "a.toml", style: '"""', of: (text) => `s = """\n${text}\n"""\n` },
  { path: "a.sh", style: '"', of: (text) => `s="${text}"\n` },
  { path: "a.sh", style: "'", of: (text) => `s='${text}'\n` },
  { path: "a.sh", style: "$''", of: (text) => `s=$'${text}'\n` },
  { path: "a.sh", style: "heredoc", of: (text) => `cat <<EOF\n${text}\nEOF\n` },
  { path: "a.c", style: '"', of: (text) => `char *s = "${text}";\n` },
  { path: "a.cpp", style: '"', of: (text) => `auto s = "${text}";\n` },
  { path: "a.cpp", style: 'R"()"', of: (text) => `auto s = R"(${text})";\n` },
  { path: "a.lua", style: '"', of: (text) => `local s = "${text}"\n` },
  { path: "a.lua", style: "'", of: (text) => `local s = '${text}'\n` },
  { path: "a.lua", style: "[[ ]]", of: (text) => `local s = [[${text}]]\n` },
  { path: "A.java", style: '"', of: (text) => `class A {\n  String s = "${text}";\n}\n` },
  {
    path: "A.java",
    style: '"""',
    of: (text) => `class A {\n  String s = """\n    ${text}\n    """;\n}\n`,
  },
  { path: "a.php", style: '"', of: (text) => `<?php\n$s = "${text}";\n` },
  { path: "a.php", style: "'", of: (text) => `<?php\n$s = '${text}';\n` },
  { path: "a.php", style: "heredoc", of: (text) => `<?php\n$s = <<<EOT\n${text}\nEOT;\n` },
  { path: "a.php", style: "nowdoc", of: (text) => `<?php\n$s = <<<'EOT'\n${text}\nEOT;\n` },
  { path: "a.rb", style: '"', of: (text) => `s = "${text}"\n` },
  { path: "a.rb", style: "'", of: (text) => `s = '${text}'\n` },
  { path: "a.rb", style: "heredoc", of: (text) => `s = <<~EOS\n  ${text}\nEOS\n` },
  { path: "A.cs", style: '"', of: (text) => `var s = "${text}";\n` },
  { path: "A.cs", style: '@""', of: (text) => `var s = @"${text}";\n` },
  { path: "A.cs", style: '$""', of: (text) => `var s = $"${text}";\n` },
  { path: "A.cs", style: '"""', of: (text) => `var s = """${text}""";\n` },
  { path: "a.html", style: "attribute", of: (text) => `<p title="${text}"></p>\n` },
  { path: "a.html", style: "text", of: (text) => `<p>${text}</p>\n` },
  { path: "a.html", style: "script", of: (text) => `<script>\n  ${text}\n</script>\n` },
  { path: "A.kt", style: '"', of: (text) => `val s = "${text}"\n` },
  { path: "A.kt", style: '"""', of: (text) => `val s = """${text}"""\n` },
  { path: "A.swift", style: '"', of: (text) => `let s = "${text}"\n` },
  { path: "A.swift", style: '"""', of: (text) => `let s = """\n  ${text}\n  """\n` },
  { path: "A.swift", style: '#""#', of: (text) => `let s = #"${text}"#\n` },
];

/**
 * Valid code each grammar reports an error on, as a file holding `word` inside that code and
 * `value` after it.
 */
const UNPARSED: { path: string; what: string; of: (word: string, value: string) => string }[] = [
  {
    path: "a.go",
    what: "Go's new(expression)",
    of: (word, value) => `package p\n\nvar name = new("${word}")\n\nvar size = ${value}\n`,
  },
  {
    path: "a.css",
    what: "Tailwind's @import prefix() and @source",
    of: (word, value) =>
      `@import "tailwindcss" prefix(${word});\n@source "../components";\n\n.a {\n  order: ${value};\n}\n`,
  },
  {
    path: "a.ts",
    what: "a call with a typeof import() type argument and its arguments on their own lines",
    of: (word, value) =>
      `const actual = await load<typeof import("./module")>(\n  "./${word}",\n);\nconst size = ${value};\n`,
  },
];

describe("structuralChanges in each language", () => {
  it.each([
    {
      path: "a.rs",
      oldText: "fn main() {\n    let total = add(1, 2);\n    print(total);\n}\n",
      newText: "fn main() {\n  let sum = add(\n    1,\n    2\n  );\n  print(sum);\n}\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "a.go",
      oldText: "package main\n\nfunc main() {\n\ttotal := add(1, 2)\n\tprint(total)\n}\n",
      newText: "package main\n\nfunc main() {\n  sum := add(\n    1,\n    2)\n  print(sum)\n}\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "a.css",
      oldText: ".card {\n  color: red;\n  margin: 0 auto;\n}\n",
      newText: ".card {\n    color: blue;\n    margin: 0 auto;\n}\n",
      changed: { old: ["red"], new: ["blue"] },
    },
    {
      path: "a.md",
      oldText: "# Title\n\n- one\n- two\n\nSome text.\n",
      newText: "# Heading\n\n- one\n- two\n\nSome text.\n",
      changed: { old: ["Title"], new: ["Heading"] },
    },
    {
      path: "a.json",
      oldText: '{\n  "name": "a",\n  "tags": ["x", "y"]\n}\n',
      newText: '{\n    "name": "b",\n    "tags": [\n        "x",\n        "y"\n    ]\n}\n',
      changed: { old: ["a"], new: ["b"] },
    },
    {
      path: "a.yaml",
      oldText: "server:\n  host: a\n  ports: [80, 443]\n",
      newText: "server:\n    host: b\n    ports: [80, 443]\n",
      changed: { old: ["a"], new: ["b"] },
    },
    {
      path: "a.toml",
      oldText: '[package]\nname = "a"\ntags = ["x", "y"]\n',
      newText: '[package]\nname = "b"\ntags = [\n  "x",\n  "y"\n]\n',
      changed: { old: ["a"], new: ["b"] },
    },
    {
      path: "a.sh",
      oldText: 'total=$(add 1 2)\nif [ -n "$total" ]; then\n  echo "$total"\nfi\n',
      newText: 'sum=$(add 1 2)\nif [ -n "$sum" ]; then\n    echo "$sum"\nfi\n',
      changed: { old: ["total", "total", "total"], new: ["sum", "sum", "sum"] },
    },
    {
      path: "a.c",
      oldText: "int main(void) {\n  int total = add(1, 2);\n  return total;\n}\n",
      newText:
        "int main(void) {\n    int sum = add(\n        1,\n        2);\n    return sum;\n}\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "a.cpp",
      oldText: "class Counter {\n public:\n  int total() { return add(1, 2); }\n};\n",
      newText: "class Counter {\n public:\n  int sum() {\n    return add(1, 2);\n  }\n};\n",
      changed: { old: ["total"], new: ["sum"] },
    },
    {
      path: "a.h",
      oldText: "namespace app {\nint total();\n}\n",
      newText: "namespace app {\n  int sum();\n}\n",
      changed: { old: ["total"], new: ["sum"] },
    },
    {
      path: "a.lua",
      oldText: "local total = add(1, 2)\nprint(total)\n",
      newText: "local sum = add(\n  1,\n  2\n)\nprint(sum)\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "A.java",
      oldText: "class A {\n  int total() {\n    return add(1, 2);\n  }\n}\n",
      newText: "class A {\n    int sum() {\n        return add(1, 2);\n    }\n}\n",
      changed: { old: ["total"], new: ["sum"] },
    },
    {
      path: "a.php",
      oldText: "<p>Hi</p>\n<?php\n$total = add(1, 2);\necho $total;\n",
      newText: "<p>Hi</p>\n<?php\n$sum = add(\n    1,\n    2\n);\necho $sum;\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "a.rb",
      oldText: "def total\n  add(1, 2)\nend\n",
      newText: "def sum\n    add(1, 2)\nend\n",
      changed: { old: ["total"], new: ["sum"] },
    },
    {
      path: "A.cs",
      oldText: "class A {\n  int Total() {\n    return Add(1, 2);\n  }\n}\n",
      newText: "class A {\n    int Sum() {\n        return Add(1, 2);\n    }\n}\n",
      changed: { old: ["Total"], new: ["Sum"] },
    },
    {
      path: "a.html",
      oldText: '<div class="a">\n  <p>Hello</p>\n</div>\n',
      newText: '<div class="b">\n    <p>Hello</p>\n</div>\n',
      changed: { old: ["a"], new: ["b"] },
    },
    {
      path: "A.kt",
      oldText: "fun main() {\n    val total = add(1, 2)\n    println(total)\n}\n",
      newText: "fun main() {\n  val sum = add(\n    1,\n    2\n  )\n  println(sum)\n}\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
    {
      path: "A.swift",
      oldText: "func main() {\n    let total = add(1, 2)\n    print(total)\n}\n",
      newText: "func main() {\n  let sum = add(\n    1,\n    2\n  )\n  print(sum)\n}\n",
      changed: { old: ["total", "total"], new: ["sum", "sum"] },
    },
  ])(
    "marks only the renamed tokens of a reformatted $path",
    async ({ path, oldText, newText, changed }) => {
      expect(await changedTexts(path, oldText, newText)).toEqual(changed);
    },
  );

  it.each(COMMENTS)("marks only the reworded word of a $path $style comment", async (comment) => {
    const open = OPENERS[comment.path] ?? "";
    const oldText = open + comment.of(["one two", "three"]);
    const newText = open + comment.of(["one four", "three"]);

    expect(await changedTexts(comment.path, oldText, newText)).toEqual({
      old: ["two"],
      new: ["four"],
    });
  });

  it.each(COMMENTS)("finds no change in a re-wrapped $path $style comment", async (comment) => {
    const open = OPENERS[comment.path] ?? "";
    const oldText = open + comment.of(["one two", "three"]);
    const newText = open + comment.of(["one", "two three"]);

    expect(await changedTexts(comment.path, oldText, newText)).toEqual(NO_CHANGE);
  });

  it.each([
    { style: "/** */", comment: "/**\n * one two\n *\n * three\n */\n" },
    { style: "//", comment: "// one two\n//\n// three\n" },
  ])("marks every character of a new $style comment's lines", async ({ comment }) => {
    const { new: marked } = await changedTexts("a.ts", "x;\n", `${comment}x;\n`);

    expect(marked.join("")).toBe(comment.replace(/\s/g, ""));
  });

  it("leaves the * before a reworded word of a block comment unmarked", async () => {
    const oldText = "/**\n * one two\n * three four\n */\n";
    const newText = "/**\n * one five\n * six four\n */\n";

    expect(await changedTexts("a.ts", oldText, newText)).toEqual({
      old: ["two", "three"],
      new: ["five", "six"],
    });
  });

  it.each(STRINGS)("marks only the reworded word of a $path $style string", async (string) => {
    const oldText = string.of("one two three");
    const newText = string.of("one four three");

    expect(await changedTexts(string.path, oldText, newText)).toEqual({
      old: ["two"],
      new: ["four"],
    });
  });

  it.each([
    { path: "a.rs", comment: ["/* a", "   b */"] },
    { path: "a.go", comment: ["/* a", "   b */"] },
    { path: "a.css", comment: ["/* a", "   b */"] },
    { path: "a.jsonc", comment: ["/* a", "   b */"] },
    { path: "a.c", comment: ["/* a", "   b */"] },
    { path: "a.cpp", comment: ["/* a", "   b */"] },
    { path: "a.lua", comment: ["--[[ a", "     b ]]"] },
    { path: "A.java", comment: ["/* a", "   b */"] },
    { path: "a.php", comment: ["/* a", "   b */"] },
    { path: "A.cs", comment: ["/* a", "   b */"] },
    { path: "a.html", comment: ["<!-- a", "     b -->"] },
    { path: "A.kt", comment: ["/* a", "   b */"] },
    { path: "A.swift", comment: ["/* a", "   b */"] },
  ])("finds no change in a reindented $path comment", async ({ path, comment }) => {
    const indented = (indent: string) => `${comment.map((line) => indent + line).join("\n")}\n`;
    const open = OPENERS[path] ?? "";

    expect(await changedTexts(path, open + indented(""), open + indented("    "))).toEqual(
      NO_CHANGE,
    );
  });

  it("finds no change in reindented HTML text", async () => {
    const oldText = "<p>\n  one\n  two\n</p>\n";
    const newText = "<p>\n      one\n      two\n</p>\n";

    expect(await changedTexts("a.html", oldText, newText)).toEqual(NO_CHANGE);
  });

  it("marks a YAML key moved out of its mapping", async () => {
    const oldText = "a:\n  b: 1\n  c: 2\n";
    const newText = "a:\n  b: 1\nc: 2\n";

    expect(await changedTexts("a.yaml", oldText, newText)).toEqual({ old: ["c"], new: ["c"] });
  });

  it("finds no change in a YAML file indented deeper throughout", async () => {
    const oldText = "a:\n  b:\n    - c\n    - d: 1\n";
    const newText = "a:\n    b:\n        - c\n        - d: 1\n";

    expect(await changedTexts("a.yaml", oldText, newText)).toEqual(NO_CHANGE);
  });

  it.each([
    { where: "paragraph", of: (text: string) => `# Title\n\nFirst line\n${text} here.\n` },
    { where: "heading", of: (text: string) => `## ${text}\n\nBody.\n` },
    { where: "list item", of: (text: string) => `- ${text}\n- other\n` },
    { where: "block quote", of: (text: string) => `> ${text}\n` },
  ])("marks only the reworded word of a Markdown $where", async ({ of }) => {
    const oldText = of("one two three");
    const newText = of("one four three");

    expect(await changedTexts("a.md", oldText, newText)).toEqual({ old: ["two"], new: ["four"] });
  });

  it.each([
    {
      where: "paragraph",
      oldText: "Some (text) here\n*and* more words.\n",
      newText: "Some (text)\nhere *and* more\nwords.\n",
    },
    {
      where: "block quote",
      oldText: "> one two\n> three\n",
      newText: "> one\n> two three\n",
    },
    {
      where: "list item",
      oldText: "- one two\n  three\n- other\n",
      newText: "- one\n  two three\n- other\n",
    },
  ])("finds no change in a reflowed Markdown $where", async ({ oldText, newText }) => {
    expect(await changedTexts("a.md", oldText, newText)).toEqual(NO_CHANGE);
  });

  it("marks only the words a long line of a Markdown fenced block gained and lost", async () => {
    const line = (tail: string) =>
      `\`\`\`text\n  structural/            the engine Worker's message channel, Chrome's offscreen relay, ${tail}\n\`\`\`\n`;
    const oldText = line("the engine-thread loader, and the list of packaged files");
    const newText = line(
      "the engine thread the host runs requests on, and the list of packaged files; reading changed regions from hunks",
    );

    expect(await changedTexts("a.md", oldText, newText)).toEqual({
      old: ["-", "loader"],
      new: [
        ...["the", "host", "runs", "requests", "on"],
        ...[";", "reading", "changed", "regions", "from", "hunks"],
      ],
    });
  });

  it.each([
    {
      where: "fenced code block",
      of: (text: string) => `\`\`\`ts\nconst a = f(${text});\n\`\`\`\n`,
    },
    {
      where: "fenced block in a list item",
      of: (text: string) => `- item\n\n  ~~~\n  ${text}\n  ~~~\n`,
    },
    { where: "indented code block", of: (text: string) => `Text.\n\n    ${text}\n    last\n` },
    { where: "table cell", of: (text: string) => `| a | b |\n|---|---|\n| x | ${text} |\n` },
    { where: "table header", of: (text: string) => `| a | ${text} |\n|---|---|\n| x | y |\n` },
    {
      where: "HTML block",
      of: (text: string) => `<div align="center">\n  <b>${text}</b>\n</div>\n`,
    },
    { where: "HTML comment", of: (text: string) => `<!-- note\n${text} -->\n\nText.\n` },
    { where: "link reference title", of: (text: string) => `[ref]: https://a.example "${text}"\n` },
    {
      where: "front matter",
      of: (text: string) => `---\ntitle: ${text}\ntags: [a]\n---\n\nText.\n`,
    },
    { where: "TOML front matter", of: (text: string) => `+++\ntitle = "${text}"\n+++\n\nText.\n` },
    { where: "link text", of: (text: string) => `See [${text}](https://a.example) here.\n` },
    { where: "emphasis", of: (text: string) => `Some *${text}* and **${text}** here.\n` },
    { where: "inline code", of: (text: string) => `Run \`${text}\` first.\n` },
    { where: "inline HTML", of: (text: string) => `Some <kbd>${text}</kbd> here.\n` },
  ])("marks only the reworded word of a Markdown $where", async ({ of }) => {
    const oldText = of("one two three");
    const newText = of("one four three");

    const changed = await changedTexts("a.md", oldText, newText);

    expect(new Set(changed.old)).toEqual(new Set(["two"]));
    expect(new Set(changed.new)).toEqual(new Set(["four"]));
  });

  it.each([
    {
      where: "link target",
      oldText: "See [the docs](https://a.example/guide/setup-old.html).\n",
      newText: "See [the docs](https://a.example/guide/setup-new.html).\n",
    },
    {
      where: "link reference target",
      oldText: "[docs]: https://a.example/guide/setup-old.html\n",
      newText: "[docs]: https://a.example/guide/setup-new.html\n",
    },
  ])("marks only the changed part of a Markdown $where", async ({ oldText, newText }) => {
    expect(await changedTexts("a.md", oldText, newText)).toEqual({ old: ["old"], new: ["new"] });
  });

  it("marks only the new cell of a Markdown table padded wider for it", async () => {
    const oldText = "| Name | Use   |\n|------|-------|\n| a    | first |\n";
    const newText =
      "| Name      | Use   |\n|-----------|-------|\n| a         | first |\n| long name | other |\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual({
      old: [],
      new: ["|", "long", "name", "|", "other", "|"],
    });
  });

  it("marks a Markdown table column's changed alignment", async () => {
    const oldText = "| a | b |\n|---|---|\n| x | y |\n";
    const newText = "| a | b |\n|---|:-:|\n| x | y |\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual({ old: [], new: [":", ":"] });
  });

  it.each([
    { where: "fenced code", of: (code: string) => `\`\`\`py\n${code}\`\`\`\n` },
    { where: "indented code", of: (code: string) => `Text.\n\n${code.replace(/^/gm, "    ")}` },
    { where: "front matter", of: (code: string) => `---\n${code}---\n\nText.\n` },
  ])("marks a line of Markdown $where moved under the line before it", async ({ of }) => {
    const oldText = of("a:\n  b\nc\n");
    const newText = of("a:\n  b\n  c\n");

    expect(await changedTexts("a.md", oldText, newText)).toEqual({ old: ["c"], new: ["c"] });
  });

  it("finds no change in Markdown fenced code respaced inside its lines", async () => {
    const oldText = "```\nf(a,b)  # note\n  g( c )\n```\n";
    const newText = "```\nf(a, b) # note\n  g(c)\n```\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual(NO_CHANGE);
  });

  it("reads a Markdown list's depth after an unclosed bracket in a fenced block", async () => {
    const oldText = "```\nf(\n```\n\n- one\n  - two\n  - three\n";
    const newText = "```\nf(\n```\n\n- one\n  - two\n- three\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual({
      old: ["  ", "- "],
      new: ["- "],
    });
  });

  it("finds no change in a YAML block scalar indented deeper", async () => {
    const oldText = "a:\n  b: |\n    one two\n    three\n";
    const newText = "a:\n    b: |\n        one two\n        three\n";

    expect(await changedTexts("a.yaml", oldText, newText)).toEqual(NO_CHANGE);
  });

  it("marks a Markdown list item moved out of its parent item", async () => {
    const oldText = "- one\n  - two\n  - three\n";
    const newText = "- one\n  - two\n- three\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual({
      old: ["  ", "- "],
      new: ["- "],
    });
  });

  it.each(UNPARSED)(
    "marks a change after $what, which the grammar reports as an error",
    async ({ path, of }) => {
      expect(await changedTexts(path, of("old", "1"), of("old", "2"))).toEqual({
        old: ["1"],
        new: ["2"],
      });
    },
  );

  it.each(UNPARSED)(
    "marks a word changed inside $what, which the grammar reports as an error",
    async ({ path, of }) => {
      expect(await changedTexts(path, of("old", "1"), of("new", "1"))).toEqual({
        old: ["old"],
        new: ["new"],
      });
    },
  );
});
