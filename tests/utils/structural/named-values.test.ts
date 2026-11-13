import { describe, expect, it } from "vitest";
import type { TokenSpan } from "../../../utils/structural/changes";
import { structuralChanges } from "../../../utils/structural/engine";
import { type Grammar, grammarOf } from "../../../utils/structural/grammar";
import { isPlainText, PLAIN_TEXT } from "../../../utils/structural/plain-text";
import { inputFor, parserFor, regionsOf } from "../../fixtures/structural";

/** Each line of `text` with a span, trimmed, its marked stretches between `«` and `»`. */
function markedLines(text: string, spans: readonly TokenSpan[]): string[] {
  const lines = text.split("\n");
  const byLine = Map.groupBy(spans, (span) => span.line);

  return [...byLine].map(([line, lineSpans]) => {
    const source = lines[line - 1] ?? "";
    let marked = "";
    let at = 0;
    for (const span of lineSpans.toSorted((a, b) => a.startCol - b.startCol)) {
      marked += `${source.slice(at, span.startCol)}«${source.slice(span.startCol, span.endCol)}»`;
      at = span.endCol;
    }
    // Marks that touch, or that only a space parts, read as one.
    return (marked + source.slice(at)).replaceAll(/»( ?)«/g, "$1").trim();
  });
}

/** What the engine marks between `oldText` and `newText`, read as `path`'s language. */
async function marks(path: string, oldText: string, newText: string) {
  const grammar = grammarOf(path) as Grammar;
  const language = isPlainText(path)
    ? PLAIN_TEXT
    : { grammar, parser: await parserFor(grammar.id) };
  const result = await structuralChanges(
    inputFor({ oldText, newText, language, regions: regionsOf(oldText, newText) }),
  );

  if (!result.ok) throw new Error(`${path} refused: ${result.reason}`);
  return {
    old: markedLines(oldText, result.changes.old),
    new: markedLines(newText, result.changes.new),
    inside: result.changes.inside,
  };
}

const CALL = "load(path, opts.depth)";

/**
 * A value given a name on a line of its own, in each language: the file that uses the value in
 * place, the file that names it first, and the marks of each.
 */
const NAMED: { path: string; inPlace: string; named: string; want: [string[], string[]] }[] = [
  {
    path: "a.c",
    inPlace: `int f(void) {\n    return ${CALL};\n}\n`,
    named: `int f(void) {\n    int v = ${CALL};\n    check(v);\n    return v;\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«int v = load(path, opts.depth);»", "«check(v);»", "return «v»;"],
    ],
  },
  {
    path: "a.cpp",
    inPlace: `int f() {\n    return ${CALL};\n}\n`,
    named: `int f() {\n    auto v = ${CALL};\n    check(v);\n    return v;\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«auto v = load(path, opts.depth);»", "«check(v);»", "return «v»;"],
    ],
  },
  {
    path: "A.cs",
    inPlace: `class A {\n    int F() {\n        return ${CALL};\n    }\n}\n`,
    named: `class A {\n    int F() {\n        var v = ${CALL};\n        Check(v);\n        return v;\n    }\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«var v = load(path, opts.depth);»", "«Check(v);»", "return «v»;"],
    ],
  },
  {
    path: "A.java",
    inPlace: `class A {\n    int f() {\n        return ${CALL};\n    }\n}\n`,
    named: `class A {\n    int f() {\n        int v = ${CALL};\n        check(v);\n        return v;\n    }\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«int v = load(path, opts.depth);»", "«check(v);»", "return «v»;"],
    ],
  },
  ...["a.ts", "a.tsx", "a.js"].map((path) => ({
    path,
    inPlace: `function f() {\n  return ${CALL};\n}\n`,
    named: `function f() {\n  const v = ${CALL};\n  check(v);\n  return v;\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«const v = load(path, opts.depth);»", "«check(v);»", "return «v»;"],
    ] as [string[], string[]],
  })),
  {
    path: "a.py",
    inPlace: `def f():\n    return ${CALL}\n`,
    named: `def f():\n    v = ${CALL}\n    check(v)\n    return v\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«v = load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "a.rs",
    inPlace: `fn f() -> i32 {\n    return ${CALL};\n}\n`,
    named: `fn f() -> i32 {\n    let v = ${CALL};\n    check(v);\n    return v;\n}\n`,
    want: [
      ["return «load(path, opts.depth)»;"],
      ["«let v = load(path, opts.depth);»", "«check(v);»", "return «v»;"],
    ],
  },
  {
    path: "a.go",
    inPlace: `func f() int {\n\treturn ${CALL}\n}\n`,
    named: `func f() int {\n\tv := ${CALL}\n\tcheck(v)\n\treturn v\n}\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«v := load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "a.lua",
    inPlace: `function f()\n  return ${CALL}\nend\n`,
    named: `function f()\n  local v = ${CALL}\n  check(v)\n  return v\nend\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«local v = load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "a.php",
    inPlace: "<?php\nfunction f() {\n    return load($path, $opts->depth);\n}\n",
    named:
      "<?php\nfunction f() {\n    $v = load($path, $opts->depth);\n    check($v);\n    return $v;\n}\n",
    want: [
      ["return «load($path, $opts->depth)»;"],
      ["«$v = load($path, $opts->depth);»", "«check($v);»", "return «$v»;"],
    ],
  },
  {
    path: "a.rb",
    inPlace: `def f\n  return ${CALL}\nend\n`,
    named: `def f\n  v = ${CALL}\n  check(v)\n  return v\nend\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«v = load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "A.kt",
    inPlace: `fun f(): Int {\n    return ${CALL}\n}\n`,
    named: `fun f(): Int {\n    val v = ${CALL}\n    check(v)\n    return v\n}\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«val v = load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "A.swift",
    inPlace: `func f() -> Int {\n    return ${CALL}\n}\n`,
    named: `func f() -> Int {\n    let v = ${CALL}\n    check(v)\n    return v\n}\n`,
    want: [
      ["return «load(path, opts.depth)»"],
      ["«let v = load(path, opts.depth)»", "«check(v)»", "return «v»"],
    ],
  },
  {
    path: "a.sh",
    inPlace: 'f() {\n  echo "$(load "$path" --depth 2)"\n}\n',
    named: 'f() {\n  v="$(load "$path" --depth 2)"\n  check "$v"\n  echo "$v"\n}\n',
    want: [
      ['echo "«$(load "$path" --depth 2)»"'],
      ['«v="$(load "$path" --depth 2)"»', '«check "$v"»', 'echo "«$v»"'],
    ],
  },
  {
    path: "a.json",
    inPlace: '{\n  "run": "load --path x --depth 2"\n}\n',
    named: '{\n  "v": "load --path x --depth 2",\n  "check": "v",\n  "run": "v"\n}\n',
    want: [
      ['"run": "«load --path x --depth 2»"'],
      ['«"v": "load --path x --depth 2",»', '«"check": "v",»', '"run": "«v»"'],
    ],
  },
  {
    path: "a.yml",
    inPlace: "job:\n  run: load --path x --depth 2\n",
    named: "job:\n  v: load --path x --depth 2\n  check: v\n  run: v\n",
    want: [
      ["run: «load --path x --depth 2»"],
      ["«v: load --path x --depth 2»", "«check: v»", "run: «v»"],
    ],
  },
  {
    path: "a.toml",
    inPlace: '[job]\nrun = "load --path x --depth 2"\n',
    named: '[job]\nv = "load --path x --depth 2"\ncheck = "v"\nrun = "v"\n',
    want: [
      ['run = "«load --path x --depth 2»"'],
      ['«v = "load --path x --depth 2"»', '«check = "v"»', 'run = "«v»"'],
    ],
  },
  {
    path: "a.md",
    inPlace: "Intro.\n\nReturn the loaded path and depth here.\n",
    named: "Intro.\n\nLet v be the loaded path and depth.\n\nCheck v.\n\nReturn v here.\n",
    want: [
      ["Return «the loaded path and depth» here."],
      ["«Let v be the loaded path and depth.»", "«Check v.»", "Return «v» here."],
    ],
  },
  {
    path: "a.html",
    inPlace: '<p>\n  <a href="/load/path/depth">go</a>\n</p>\n',
    named: '<p>\n  <b id="v">/load/path/depth</b>\n  <i>check</i>\n  <a href="v">go</a>\n</p>\n',
    want: [
      ['<a href="«/load/path/depth»">go</a>'],
      ['«<b id="v">/load/path/depth</b>»', "«<i>check</i>»", '<a href="«v»">go</a>'],
    ],
  },
  // Plain text has no statements, so a line stands in for one and a word for a name.
  {
    path: "a.txt",
    inPlace: "intro\nreturn load path with depth two\n",
    named: "intro\nv is load path with depth two\ncheck v\nreturn v\n",
    want: [
      ["return «load path with depth two»"],
      ["«v is load path with depth two»", "«check v»", "return «v»"],
    ],
  },
];

describe("structuralChanges, a value that gains or loses a name", () => {
  it.each(NAMED)(
    "marks the value where $path used it and the name that took its place",
    async ({ path, inPlace, named, want: [inPlaceMarks, namedMarks] }) => {
      const { old, new: added } = await marks(path, inPlace, named);

      expect({ old, new: added }).toEqual({ old: inPlaceMarks, new: namedMarks });
    },
  );

  it.each(NAMED)(
    "marks the name $path dropped and the value put in its place",
    async ({ path, inPlace, named, want: [inPlaceMarks, namedMarks] }) => {
      const { old, new: added } = await marks(path, named, inPlace);

      expect({ old, new: added }).toEqual({ old: namedMarks, new: inPlaceMarks });
    },
  );

  it("names the line that uses the name as changed inside, and not the line that defines it", async () => {
    const inPlace = `int f(void) {\n    return ${CALL};\n}\n`;
    const named = `int f(void) {\n    int v = ${CALL};\n    check(v);\n    return v;\n}\n`;

    const { inside } = await marks("a.c", inPlace, named);

    expect(inside).toEqual({ old: [2], new: [4] });
  });

  it("pairs a C statement wrapped over two lines with the one that uses its name", async () => {
    const inPlace = "int f(void) {\n    return load(path,\n                opts.depth);\n}\n";
    const named =
      "int f(void) {\n    int v = load(path,\n                 opts.depth);\n    check(v);\n    return v;\n}\n";

    const { old, new: added } = await marks("a.c", inPlace, named);

    expect(old).toEqual(["return «load(path,»", "«opts.depth)»;"]);
    expect(added).toEqual(["«int v = load(path,»", "«opts.depth);»", "«check(v);»", "return «v»;"]);
  });

  it("pairs a Python statement wrapped over two lines with the one that uses its name", async () => {
    const inPlace = "def f():\n    return load(path,\n                opts.depth)\n";
    const named =
      "def f():\n    v = load(path,\n             opts.depth)\n    check(v)\n    return v\n";

    const { old, new: added } = await marks("a.py", inPlace, named);

    expect(old).toEqual(["return «load(path,»", "«opts.depth)»"]);
    expect(added).toEqual(["«v = load(path,»", "«opts.depth)»", "«check(v)»", "return «v»"]);
  });

  it("reads a CSS value moved into a custom property as the property renamed, since `var(--v)` is no bare name", async () => {
    const inPlace = "a {\n  color: rgb(10, 20, 30);\n}\n";
    const named = "a {\n  --v: rgb(10, 20, 30);\n  outline: 0;\n  color: var(--v);\n}\n";

    const { old, new: added } = await marks("a.css", inPlace, named);

    expect(old).toEqual(["«color»: rgb(10, 20, 30);"]);
    expect(added).toEqual(["«--v»: rgb(10, 20, 30);", "«outline: 0;»", "«color: var(--v);»"]);
  });
});

describe("structuralChanges, changes that only look like a value gaining a name", () => {
  const body = (...lines: string[]) => `int f(void) {\n${lines.join("\n")}\n}\n`;

  it("keeps a statement beside the one that kept its body when its keyword changed", async () => {
    const oldText = body("    if (x) foo();");
    const newText = body("    while (x) foo();", "    if (y) bar();");

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«if» (x) foo();"]);
    expect(added).toEqual(["«while» (x) foo();", "«if (y) bar();»"]);
  });

  it("marks only the renamed function of a call", async () => {
    const oldText = body(`    return ${CALL};`);
    const newText = body("    return fetch(path, opts.depth);");

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["return «load»(path, opts.depth);"]);
    expect(added).toEqual(["return «fetch»(path, opts.depth);"]);
  });

  it("does not pair a value with a name no line gives it", async () => {
    const oldText = body(`    return ${CALL};`);
    const newText = body(`    int v = ${CALL};`, "    return cached;");

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«return» load(path, opts.depth);"]);
    expect(added).toEqual(["«int v =» load(path, opts.depth);", "«return cached;»"]);
  });

  it("does not pair a value with a name defined as something else", async () => {
    const oldText = body(`    return ${CALL};`);
    const newText = body("    int v = load(opts.depth, path);", "    return v;");

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«return» load(«path,» opts.depth);"]);
    expect(added).toEqual(["«int v =» load(opts.depth«, path»);", "«return v;»"]);
  });

  it("does not pair a value with an expression of its name", async () => {
    const oldText = body(`    return ${CALL};`);
    const newText = body(`    int v = ${CALL};`, "    return v + v;");

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«return» load(path, opts.depth);"]);
    expect(added).toEqual(["«int v =» load(path, opts.depth);", "«return v + v;»"]);
  });

  it("does not pair a value with a name defined below its use", async () => {
    const oldText = body(`    return ${CALL};`);
    const newText = body("    return v;", `    int v = ${CALL};`);

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«return» load(path, opts.depth);"]);
    expect(added).toEqual(["«return v;»", "«int v =» load(path, opts.depth);"]);
  });

  it("keeps a statement that is all value beside the line that names it", async () => {
    const oldText = `fn f() -> i32 {\n    ${CALL}\n}\n`;
    const newText = `fn f() -> i32 {\n    let v = ${CALL};\n    check(v);\n    v\n}\n`;

    const { old, new: added } = await marks("a.rs", oldText, newText);

    expect(old).toEqual([]);
    expect(added).toEqual(["«let v =» load(path, opts.depth)«;»", "«check(v);»", "«v»"]);
  });

  it("leaves two values named in the other order to the diff", async () => {
    const oldText = body("    foo(load(a, b));", "    bar(calc(c, d));");
    const newText = body(
      "    int w = calc(c, d);",
      "    bar(w);",
      "    int v = load(a, b);",
      "    foo(v);",
    );

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect(old).toEqual(["«foo(»load(a, b)«)»;", "«bar(calc(c, d));»"]);
    expect(added).toEqual([
      "«int w = calc(c, d);»",
      "«bar(w);»",
      "«int v =» load(a, b);",
      "«foo(v);»",
    ]);
  });

  it("finds no change in a re-wrapped comment", async () => {
    const oldText = "// alpha beta gamma delta\n// epsilon zeta\nint x;\n";
    const newText = "// alpha beta\n// gamma delta epsilon\n// zeta\nint x;\n";

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect({ old, new: added }).toEqual({ old: [], new: [] });
  });

  it("finds no change in a re-wrapped comment whose words repeat as a named value's would", async () => {
    const oldText = "// x b c p x s\n//   p b c s\nint x;\n";
    const newText = "// x b c\n// p x s\n// p b c s\nint x;\n";

    const { old, new: added } = await marks("a.c", oldText, newText);

    expect({ old, new: added }).toEqual({ old: [], new: [] });
  });
});
