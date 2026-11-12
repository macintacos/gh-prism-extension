import { describe, expect, it } from "vitest";
import type { PrFileDiff } from "../../../utils/github/pr-diff";
import { commentSyntaxOf } from "../../../utils/hunk-rules/head-scan";
import {
  INLINE_TEST_EXTENSIONS,
  inlineTestHunkVerdicts,
  inlineTestRuleApplies,
} from "../../../utils/hunk-rules/inline-tests";
import { headOf, lines } from "../../fixtures/head-scan";
import {
  type InlineCase,
  itBlockHead,
  itBlockPatch,
  pythonCases,
  typescriptCases,
} from "../../fixtures/inline-test-cases";

const modified = (path: string, patch: string): PrFileDiff => ({
  kind: "text",
  path,
  status: "modified",
  patch,
});

interface GateCase {
  readonly name: string;
  readonly file: PrFileDiff;
  readonly expected: boolean;
}

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

  it("reads a head's parsed test blocks instead of finding its own", () => {
    const head = lines("run(() => {", "  check(2);", "});");
    const patch = lines("@@ -2 +2 @@", "-  check(1);", "+  check(2);");

    const verdicts = inlineTestHunkVerdicts(modified("src/app.ts", patch), {
      ...headOf("src/app.ts", head),
      testBlocks: [{ start: 1, end: 3 }],
    });

    expect(verdicts).toEqual([true]);
  });

  it("widens a parsed test block over the comment lines directly above it", () => {
    const head = lines("const a = 1;", "// covers a", "run(() => {", "});");
    const patch = lines("@@ -2 +2 @@", "-// covers b", "+// covers a");

    const verdicts = inlineTestHunkVerdicts(modified("src/app.ts", patch), {
      ...headOf("src/app.ts", head),
      testBlocks: [{ start: 3, end: 4 }],
    });

    expect(verdicts).toEqual([true]);
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

describe("INLINE_TEST_EXTENSIONS", () => {
  it.each(INLINE_TEST_EXTENSIONS)("has a comment syntax for the head scan: %s", (ext) => {
    expect(commentSyntaxOf(`src/file.${ext}`)).toBeDefined();
  });
});
