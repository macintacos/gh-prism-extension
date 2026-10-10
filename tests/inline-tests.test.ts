import { describe, expect, it } from "vitest";
import { scanHeadText } from "../utils/doc-intent";
import { inlineTestHunkVerdicts, inlineTestRuleApplies } from "../utils/inline-tests";
import type { PrFileDiff } from "../utils/pr-diff";

const lines = (...text: string[]) => text.join("\n");

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

interface InlineCase {
  readonly name: string;
  readonly path: string;
  readonly head: string;
  readonly patch: string;
  readonly expected: boolean;
}

interface GateCase {
  readonly name: string;
  readonly file: PrFileDiff;
  readonly expected: boolean;
}

// The new side of src/lib.rs on sandbox PR #3 (head 5fcad454), lines 1–23.
const prThreeLib = lines(
  "pub mod engine;",
  "pub mod notes;",
  "pub mod parser;",
  "pub mod render;",
  "",
  "pub fn version() -> &'static str {",
  '    "0.1.0"',
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "",
  "    #[test]",
  "    fn version_is_semver() {",
  '        assert_eq!(version().split(".").count(), 3);',
  "    }",
  "",
  "    #[test]",
  "    fn reports_version() {",
  '        assert_eq!(version(), "0.1.0");',
  "    }",
  "}",
);

const gateCases: GateCase[] = [
  {
    name: "Gate: a modified Rust implementation file is a candidate",
    file: modified("src/lib.rs", ""),
    expected: true,
  },
  {
    name: "Gate: a modified Python implementation file is a candidate",
    file: modified("src/app.py", ""),
    expected: true,
  },
  {
    name: "Gate: a TypeScript implementation file is a candidate",
    file: modified("src/app.ts", ""),
    expected: true,
  },
  {
    name: "Gate: a .tsx implementation file is a candidate",
    file: modified("src/app.tsx", ""),
    expected: true,
  },
  {
    name: "Gate: a .mts implementation file is a candidate",
    file: modified("src/app.mts", ""),
    expected: true,
  },
  {
    name: "Gate: a .cts implementation file is a candidate",
    file: modified("src/app.cts", ""),
    expected: true,
  },
  {
    name: "Gate: a JavaScript file is not a candidate",
    file: modified("src/app.js", ""),
    expected: false,
  },
  {
    name: "Gate: a Go file is not a candidate",
    file: modified("src/main.go", ""),
    expected: false,
  },
  {
    name: "Gate: a Python stub file is not a candidate",
    file: modified("src/app.pyi", ""),
    expected: false,
  },
  {
    name: "Gate: a Rust file already in a Tests path is not a candidate",
    file: modified("tests/foo.rs", ""),
    expected: false,
  },
  {
    name: "Gate: a renamed Rust file is not a candidate",
    file: {
      kind: "text",
      path: "src/new.rs",
      previousPath: "src/old.rs",
      status: "renamed",
      patch: "",
    },
    expected: false,
  },
  {
    name: "Gate: a deleted Rust file is not a candidate",
    file: { kind: "text", path: "src/lib.rs", status: "deleted", patch: "" },
    expected: false,
  },
  {
    name: "Gate: a binary file is not a candidate",
    file: { kind: "binary", path: "src/lib.rs", status: "modified" },
    expected: false,
  },
];

const rustCases: InlineCase[] = [
  {
    name: "Rust: the PR #3 fixture shape, with mod tests as the hunk's first context line, is Tests",
    path: "src/lib.rs",
    head: prThreeLib,
    patch: lines(
      "@@ -11,6 +11,11 @@ pub fn version() -> &'static str {",
      " mod tests {",
      "     use super::*;",
      " ",
      "+    #[test]",
      "+    fn version_is_semver() {",
      '+        assert_eq!(version().split(".").count(), 3);',
      "+    }",
      "+",
      "     #[test]",
      "     fn reports_version() {",
      '         assert_eq!(version(), "0.1.0");',
    ),
    expected: true,
  },
  {
    name: "Rust: a change inside mod test is Tests",
    path: "src/lib.rs",
    head: lines(
      "#[cfg(test)]",
      "mod test {",
      "    #[test]",
      "    fn works() {",
      "        assert!(true);",
      "    }",
      "}",
    ),
    patch: lines(
      "@@ -2,4 +2,4 @@",
      " mod test {",
      "     #[test]",
      "     fn works() {",
      "-        assert!(false);",
      "+        assert!(true);",
    ),
    expected: true,
  },
  {
    name: "Rust: a mod tests nested in mod a is Tests",
    path: "src/lib.rs",
    head: lines(
      "mod a {",
      "    mod tests {",
      "        #[test]",
      "        fn t() { assert!(true); }",
      "    }",
      "}",
    ),
    patch: lines(
      "@@ -2,5 +2,5 @@",
      "     mod tests {",
      "         #[test]",
      "-        fn t() {}",
      "+        fn t() { assert!(true); }",
      "     }",
      " }",
    ),
    expected: true,
  },
  {
    name: "Rust: a brace in a string or char literal and a lifetime do not end the block",
    path: "src/lib.rs",
    head: lines(
      "pub fn first<'a>(x: &'a str) -> &'a str {",
      "    x",
      "}",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    struct Span<'a> { text: &'a str }",
      "",
      "    #[test]",
      "    fn literals() {",
      '        assert_eq!("}", "}");',
      "        assert_eq!('}', '}');",
      "        assert!(false);",
      "    }",
      "}",
    ),
    patch: lines(
      "@@ -11,4 +11,4 @@",
      '         assert_eq!("}", "}");',
      "         assert_eq!('}', '}');",
      "-        assert!(true);",
      "+        assert!(false);",
      "     }",
    ),
    expected: true,
  },
  {
    name: "Rust: a whole #[cfg(test)] mod tests added after a pub fn, with its leading blank line, is Tests",
    path: "src/lib.rs",
    head: lines(
      "pub fn version() -> &'static str {",
      '    "0.1.0"',
      "}",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    #[test]",
      "    fn reports_version() {",
      '        assert_eq!(version(), "0.1.0");',
      "    }",
      "}",
    ),
    patch: lines(
      "@@ -1,3 +1,11 @@",
      " pub fn version() -> &'static str {",
      '     "0.1.0"',
      " }",
      "+",
      "+#[cfg(test)]",
      "+mod tests {",
      "+    #[test]",
      "+    fn reports_version() {",
      '+        assert_eq!(version(), "0.1.0");',
      "+    }",
      "+}",
    ),
    expected: true,
  },
  {
    name: "Rust: a deletion inside the block is Tests",
    path: "src/lib.rs",
    head: lines("mod tests {", "    #[test]", "    fn a() {", "        b();", "    }", "}"),
    patch: lines(
      "@@ -2,6 +2,5 @@",
      "     #[test]",
      "     fn a() {",
      "         b();",
      "-        c();",
      "     }",
      " }",
    ),
    expected: true,
  },
  {
    name: "Rust: a change in a pub fn above the block is not Tests",
    path: "src/lib.rs",
    head: lines(
      "pub fn version() -> u8 {",
      "    2",
      "}",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    #[test]",
      "    fn a() {}",
      "}",
    ),
    patch: lines("@@ -1,2 +1,2 @@", " pub fn version() -> u8 {", "-    1", "+    2"),
    expected: false,
  },
  {
    name: "Rust: a file with one hunk inside a block and one outside is not Tests",
    path: "src/lib.rs",
    head: lines(
      "pub fn version() -> &'static str {",
      '    "0.2.0"',
      "}",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    #[test]",
      "    fn reports_version() {",
      '        assert_eq!(version(), "0.2.0");',
      "    }",
      "}",
    ),
    patch: lines(
      "@@ -1,3 +1,3 @@",
      " pub fn version() -> &'static str {",
      '-    "0.1.0"',
      '+    "0.2.0"',
      " }",
      "@@ -9 +9 @@",
      '-        assert_eq!(version(), "0.1.0");',
      '+        assert_eq!(version(), "0.2.0");',
    ),
    expected: false,
  },
  {
    name: "Rust: a hunk changing the block's closing brace and the line after it is not Tests",
    path: "src/lib.rs",
    head: lines(
      "mod tests {",
      "    #[test]",
      "    fn a() {}",
      "} // end of tests",
      "pub fn after() -> u8 { 1 }",
    ),
    patch: lines(
      "@@ -2,4 +2,4 @@",
      "     #[test]",
      "     fn a() {}",
      "-}",
      "+} // end of tests",
      "-pub fn after() -> u8 { 0 }",
      "+pub fn after() -> u8 { 1 }",
    ),
    expected: false,
  },
  {
    name: "Rust: a hunk whose only change is a blank line inside a block is not Tests",
    path: "src/lib.rs",
    head: lines(
      "mod tests {",
      "    #[test]",
      "    fn a() {}",
      "",
      "    #[test]",
      "    fn b() {}",
      "}",
    ),
    patch: lines(
      "@@ -2,4 +2,5 @@",
      "     #[test]",
      "     fn a() {}",
      "+",
      "     #[test]",
      "     fn b() {}",
    ),
    expected: false,
  },
  {
    name: "Rust: a mod tests; declaration is not Tests",
    path: "src/lib.rs",
    head: lines("pub mod engine;", "mod tests;"),
    patch: lines("@@ -1 +1,2 @@", " pub mod engine;", "+mod tests;"),
    expected: false,
  },
  {
    name: "Rust: a mod tests_util block is not Tests",
    path: "src/lib.rs",
    head: lines("mod tests_util {", "    pub fn helper() {}", "}"),
    patch: lines("@@ -1,2 +1,3 @@", " mod tests_util {", "+    pub fn helper() {}", " }"),
    expected: false,
  },
  {
    name: "Rust: a block that never closes is not Tests",
    path: "src/lib.rs",
    head: lines("mod tests {", "    #[test]", "    fn a() {", "        c();", "    }"),
    patch: lines("@@ -4 +4 @@", "-        b();", "+        c();"),
    expected: false,
  },
  {
    name: "Rust: a removed line just above a test block is not Tests",
    path: "src/lib.rs",
    head: lines("pub fn a() {}", "mod tests {", "    #[test]", "    fn t() {}", "}"),
    patch: lines("@@ -1,3 +1,2 @@", " pub fn a() {}", "-// retired", " mod tests {"),
    expected: false,
  },
  {
    name: "Rust: a modified file with an empty patch is not Tests",
    path: "src/lib.rs",
    head: prThreeLib,
    patch: "",
    expected: false,
  },
];

const pythonCases: InlineCase[] = [
  {
    name: "Python: a def test_x body change is Tests",
    path: "src/app.py",
    head: lines(
      "import pytest",
      "",
      "def test_x():",
      "    value = compute(2)",
      "    assert value == 2",
    ),
    patch: lines(
      "@@ -3,3 +3,3 @@",
      " def test_x():",
      "-    value = compute()",
      "+    value = compute(2)",
      "     assert value == 2",
    ),
    expected: true,
  },
  {
    name: "Python: a module-level def test_x added with its two blank lines is Tests",
    path: "src/app.py",
    head: lines("import pytest", "", "", "def test_x():", "    assert True"),
    patch: lines("@@ -1 +1,5 @@", " import pytest", "+", "+", "+def test_x():", "+    assert True"),
    expected: true,
  },
  {
    name: "Python: renaming an outermost def test_parse() is Tests",
    path: "src/app.py",
    head: lines("def test_parse_all():", '    assert parse("a") == ["a"]'),
    patch: lines(
      "@@ -1,2 +1,2 @@",
      "-def test_parse():",
      "+def test_parse_all():",
      '     assert parse("a") == ["a"]',
    ),
    expected: true,
  },
  {
    name: "Python: an async def test_x body change is Tests",
    path: "src/app.py",
    head: lines("async def test_x():", "    await run(2)"),
    patch: lines(
      "@@ -1,2 +1,2 @@",
      " async def test_x():",
      "-    await run(1)",
      "+    await run(2)",
    ),
    expected: true,
  },
  {
    name: "Python: a method of class TestFoo is Tests",
    path: "src/app.py",
    head: lines(
      "class TestFoo:",
      "    def test_a(self):",
      "        assert True",
      "    def helper(self):",
      "        return 2",
    ),
    patch: lines(
      "@@ -4,2 +4,2 @@",
      "     def helper(self):",
      "-        return 1",
      "+        return 2",
    ),
    expected: true,
  },
  {
    name: "Python: a class named Testing is Tests",
    path: "src/app.py",
    head: lines("class Testing:", "    def helper(self):", "        return 2"),
    patch: lines(
      "@@ -2,2 +2,2 @@",
      "     def helper(self):",
      "-        return 1",
      "+        return 2",
    ),
    expected: true,
  },
  {
    name: "Python: a single-line decorator change above a test is Tests",
    path: "src/app.py",
    head: lines("import pytest", "", "@pytest.mark.slow", "def test_x():", "    assert True"),
    patch: lines(
      "@@ -2,4 +2,4 @@",
      " ",
      "-@pytest.mark.fast",
      "+@pytest.mark.slow",
      " def test_x():",
      "     assert True",
    ),
    expected: true,
  },
  {
    name: "Python: a black-style signature ending ') -> None:' keeps its body in the block",
    path: "src/app.py",
    head: lines("def test_x(", "    tmp_path,", ") -> None:", "    assert tmp_path.exists()"),
    patch: lines("@@ -4 +4 @@", "-    assert tmp_path.is_dir()", "+    assert tmp_path.exists()"),
    expected: true,
  },
  {
    name: "Python: a column-zero line inside a triple-quoted string does not end the test",
    path: "src/app.py",
    head: lines("def test_x():", '    text = """', "column zero", '"""', "    assert text.strip()"),
    patch: lines("@@ -5 +5 @@", "-    assert text", "+    assert text.strip()"),
    expected: true,
  },
  {
    name: "Python: a nested def inside a test is Tests",
    path: "src/app.py",
    head: lines(
      "def test_x():",
      "    def helper():",
      "        return 2",
      "    assert helper() == 2",
    ),
    patch: lines(
      "@@ -2,3 +2,3 @@",
      "     def helper():",
      "-        return 1",
      "+        return 2",
      "     assert helper() == 2",
    ),
    expected: true,
  },
  {
    name: "Python: def testing() is not Tests",
    path: "src/app.py",
    head: lines("def testing():", "    return 1"),
    patch: lines("@@ -1,2 +1,2 @@", " def testing():", "-    return 0", "+    return 1"),
    expected: false,
  },
  {
    name: "Python: a def test_x method of a class that is not Test* is not Tests",
    path: "src/app.py",
    head: lines("class Helper:", "    def test_x(self):", "        return 1"),
    patch: lines("@@ -3 +3 @@", "-        return 0", "+        return 1"),
    expected: false,
  },
  {
    name: "Python: a change after the test's dedent is not Tests",
    path: "src/app.py",
    head: lines("def test_x():", "    assert True", "", "VALUE = 1"),
    patch: lines("@@ -2,3 +2,3 @@", "     assert True", " ", "-VALUE = 0", "+VALUE = 1"),
    expected: false,
  },
  {
    name: "Python: a code change in a test plus a reworded comment above the next def is not Tests",
    path: "src/app.py",
    head: lines(
      "def test_x():",
      "    assert True",
      "",
      "# Helper below checks the value.",
      "def helper():",
      "    return 1",
    ),
    patch: lines(
      "@@ -1,5 +1,5 @@",
      " def test_x():",
      "-    assert False",
      "+    assert True",
      " ",
      "-# Helper checks the value.",
      "+# Helper below checks the value.",
      " def helper():",
    ),
    expected: false,
  },
];

const itBlockHead = lines('it("adds", () => {', "  expect(add(1, 2)).toBe(3);", "});");
const itBlockPatch = lines(
  "@@ -2 +2 @@",
  "-  expect(add(1, 1)).toBe(2);",
  "+  expect(add(1, 2)).toBe(3);",
);

const typescriptCases: InlineCase[] = [
  {
    name: "TypeScript: a describe body with an arrow callback is Tests",
    path: "src/app.ts",
    head: lines(
      'describe("x", () => {',
      '  it("works", () => {',
      "    expect(add(1, 2)).toBe(3);",
      "  });",
      "});",
    ),
    patch: lines(
      "@@ -3 +3 @@",
      "-    expect(add(1, 1)).toBe(2);",
      "+    expect(add(1, 2)).toBe(3);",
    ),
    expected: true,
  },
  {
    name: "TypeScript: an it body is Tests",
    path: "src/app.ts",
    head: itBlockHead,
    patch: itBlockPatch,
    expected: true,
  },
  {
    name: "TypeScript: a test body is Tests",
    path: "src/app.ts",
    head: lines('test("adds", () => {', "  expect(add(1, 2)).toBe(3);", "});"),
    patch: lines("@@ -2 +2 @@", "-  expect(add(1, 1)).toBe(2);", "+  expect(add(1, 2)).toBe(3);"),
    expected: true,
  },
  {
    name: "TypeScript: an it.only body is Tests",
    path: "src/app.ts",
    head: lines('it.only("adds", () => {', "  expect(add(1, 2)).toBe(3);", "});"),
    patch: lines("@@ -2 +2 @@", "-  expect(add(1, 1)).toBe(2);", "+  expect(add(1, 2)).toBe(3);"),
    expected: true,
  },
  {
    name: "TypeScript: a describe.skip body is Tests",
    path: "src/app.ts",
    head: lines('describe.skip("adds", () => {', "  expect(add(1, 2)).toBe(3);", "});"),
    patch: lines("@@ -2 +2 @@", "-  expect(add(1, 1)).toBe(2);", "+  expect(add(1, 2)).toBe(3);"),
    expected: true,
  },
  {
    name: "TypeScript: a test.each table call with a callback is Tests",
    path: "src/app.ts",
    head: lines(
      'test.each([[1, 2, 3]])("adds %i + %i", (a, b, c) => {',
      "  expect(a + b).toBe(c);",
      "});",
    ),
    patch: lines("@@ -2 +2 @@", "-  expect(a + b).toBe(c + 1);", "+  expect(a + b).toBe(c);"),
    expected: true,
  },
  {
    name: 'TypeScript: renaming an outermost describe("old") to describe("new") is Tests',
    path: "src/app.ts",
    head: lines(
      'describe("new", () => {',
      '  it("works", () => {',
      "    expect(1).toBe(1);",
      "  });",
      "});",
    ),
    patch: lines(
      "@@ -1,4 +1,4 @@",
      '-describe("old", () => {',
      '+describe("new", () => {',
      '   it("works", () => {',
      "     expect(1).toBe(1);",
      "   });",
    ),
    expected: true,
  },
  {
    name: "TypeScript: a namespace tests block is Tests",
    path: "src/app.ts",
    head: lines("namespace tests {", "  export const value = 1;", "}"),
    patch: lines("@@ -2 +2 @@", "-  export const value = 0;", "+  export const value = 1;"),
    expected: true,
  },
  {
    name: "TypeScript: a .tsx test file is Tests",
    path: "src/app.tsx",
    head: itBlockHead,
    patch: itBlockPatch,
    expected: true,
  },
  {
    name: "TypeScript: a .mts test file is Tests",
    path: "src/app.mts",
    head: itBlockHead,
    patch: itBlockPatch,
    expected: true,
  },
  {
    name: "TypeScript: a .cts test file is Tests",
    path: "src/app.cts",
    head: itBlockHead,
    patch: itBlockPatch,
    expected: true,
  },
  {
    name: "TypeScript: items.forEach with a callback is not Tests",
    path: "src/app.ts",
    head: lines("items.forEach(() => {", "  console.log(1);", "});"),
    patch: lines("@@ -2 +2 @@", "-  console.log(0);", "+  console.log(1);"),
    expected: false,
  },
  {
    name: "TypeScript: itemize with a callback is not Tests",
    path: "src/app.ts",
    head: lines("itemize(items, () => {", "  return 1;", "});"),
    patch: lines("@@ -2 +2 @@", "-  return 0;", "+  return 1;"),
    expected: false,
  },
  {
    name: "TypeScript: setup with a callback is not Tests",
    path: "src/app.ts",
    head: lines("setup(() => {", "  return 1;", "});"),
    patch: lines("@@ -2 +2 @@", "-  return 0;", "+  return 1;"),
    expected: false,
  },
  {
    name: "TypeScript: test_refresh with a callback is not Tests",
    path: "src/app.ts",
    head: lines("test_refresh(() => {", "  return 1;", "});"),
    patch: lines("@@ -2 +2 @@", "-  return 0;", "+  return 1;"),
    expected: false,
  },
  {
    name: "TypeScript: a test call without a callback is not Tests",
    path: "src/app.ts",
    head: lines("test(value);", "const x = 1;"),
    patch: lines("@@ -1,2 +1,2 @@", "-test(other);", "+test(value);", " const x = 1;"),
    expected: false,
  },
  {
    name: "TypeScript: a class method named test with a body that has an arrow is not Tests",
    path: "src/app.ts",
    head: lines(
      "class Checker {",
      "  test(input: string): boolean {",
      "    return [1].map((x) => x).length > 0 && input.length > 0;",
      "  }",
      "}",
    ),
    patch: lines(
      "@@ -3 +3 @@",
      "-    return [1].map((x) => x).length > 0 && input.length > 1;",
      "+    return [1].map((x) => x).length > 0 && input.length > 0;",
    ),
    expected: false,
  },
  {
    name: "TypeScript: a describe method with a body that has an arrow is not Tests",
    path: "src/app.ts",
    head: lines(
      "class Labels {",
      "  describe(): string {",
      '    return names.map((n) => n).join(",");',
      "  }",
      "}",
    ),
    patch: lines(
      "@@ -3 +3 @@",
      '-    return names.map((n) => n).join(";");',
      '+    return names.map((n) => n).join(",");',
    ),
    expected: false,
  },
  {
    name: "TypeScript: an object-literal test method with a body that has an arrow is not Tests",
    path: "src/app.ts",
    head: lines(
      "const runner = {",
      "  test(x) {",
      "    return [x].filter((y) => y > 0);",
      "  },",
      "};",
    ),
    patch: lines(
      "@@ -3 +3 @@",
      "-    return [x].filter((y) => y > 1);",
      "+    return [x].filter((y) => y > 0);",
    ),
    expected: false,
  },
  {
    name: "TypeScript: a class method named test with wrapped parameters is not Tests",
    path: "src/app.ts",
    head: lines(
      "class Checker {",
      "  test(",
      "    input: string,",
      "    options: Options,",
      "  ): boolean {",
      "    return this.rules.every((rule) => rule.check(input, options));",
      "  }",
      "}",
    ),
    patch: lines(
      "@@ -6 +6 @@",
      "-    return this.rules.every((rule) => rule.check(input));",
      "+    return this.rules.every((rule) => rule.check(input, options));",
    ),
    expected: false,
  },
  {
    name: "TypeScript: an interface member named test with wrapped parameters is not Tests",
    path: "src/app.ts",
    head: lines(
      "interface Matcher {",
      "  test(",
      "    name: string,",
      "    fn: () => Promise<void>,",
      "  ): void;",
      "}",
    ),
    patch: lines("@@ -3 +3 @@", "-    name: string,", "+    label: string,"),
    expected: false,
  },
  {
    name: "TypeScript: a describe call whose arguments wrap onto lines is Tests",
    path: "src/app.ts",
    head: lines("describe(", '  "x",', "  () => {", "    expect(add(1, 2)).toBe(3);", "  },", ");"),
    patch: lines(
      "@@ -4 +4 @@",
      "-    expect(add(1, 1)).toBe(2);",
      "+    expect(add(1, 2)).toBe(3);",
    ),
    expected: true,
  },
  {
    name: "TypeScript: a describe body with brace, paren and template strings is Tests",
    path: "src/app.ts",
    head: lines(
      'describe("x", () => {',
      '  const brace = "}";',
      "  const paren = '(';",
      "  const template = `})`;",
      "  expect(add(1, 2)).toBe(3);",
      "});",
    ),
    patch: lines("@@ -5 +5 @@", "-  expect(add(1, 1)).toBe(2);", "+  expect(add(1, 2)).toBe(3);"),
    expected: true,
  },
  {
    name: "TypeScript: a change outside every test block is not Tests",
    path: "src/app.ts",
    head: lines(
      'import { it } from "vitest";',
      "",
      'it("works", () => {',
      "  expect(1).toBe(1);",
      "});",
      "const helper = 1;",
    ),
    patch: lines("@@ -6 +6 @@", "-const helper = 0;", "+const helper = 1;"),
    expected: false,
  },
];

describe("inlineTestRuleApplies", () => {
  it.each(gateCases)("$name", ({ file, expected }) => {
    expect(inlineTestRuleApplies(file)).toBe(expected);
  });
});

describe("inlineTestHunkVerdicts", () => {
  it.each([...rustCases, ...pythonCases, ...typescriptCases])(
    "$name",
    ({ path, head, patch, expected }) => {
      const verdicts = inlineTestHunkVerdicts(modified(path, patch), headOf(path, head));
      expect(verdicts.length > 0 && verdicts.every(Boolean)).toBe(expected);
    },
  );

  it("judges each hunk on its own, in diff order", () => {
    const head = lines(
      "pub fn a() -> u8 { 2 }",
      "",
      "#[cfg(test)]",
      "mod tests {",
      "    #[test]",
      "    fn it_works() {",
      "        assert_eq!(a(), 2);",
      "    }",
      "}",
    );
    const patch = lines(
      "@@ -1 +1 @@",
      "-pub fn a() -> u8 { 1 }",
      "+pub fn a() -> u8 { 2 }",
      "@@ -7 +7 @@",
      "-        assert_eq!(a(), 1);",
      "+        assert_eq!(a(), 2);",
    );

    expect(
      inlineTestHunkVerdicts(modified("src/lib.rs", patch), headOf("src/lib.rs", head)),
    ).toEqual([false, true]);
  });

  it("gives no verdicts when the rule does not apply to the file", () => {
    expect(
      inlineTestHunkVerdicts(
        modified("src/app.js", itBlockPatch),
        headOf("src/app.js", itBlockHead),
      ),
    ).toEqual([]);
  });
});
