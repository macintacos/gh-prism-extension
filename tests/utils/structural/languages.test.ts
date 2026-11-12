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

  it("marks a Markdown list item moved out of its parent item", async () => {
    const oldText = "- one\n  - two\n  - three\n";
    const newText = "- one\n  - two\n- three\n";

    expect(await changedTexts("a.md", oldText, newText)).toEqual({
      old: ["  ", "- "],
      new: ["- "],
    });
  });
});
