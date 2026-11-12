/** How to write a long file of one language: `block` once per index between `open` and `close`. */
export interface LargeFile {
  /** A path whose extension names the language. */
  readonly path: string;
  /** What the file must start with to parse. */
  readonly open?: string;
  /** One self-contained stretch of the file that names `name` once, as a single token. */
  readonly block: (name: string, i: number) => string;
  /** What must end the file for it to parse. */
  readonly close?: string;
}

const cFamily = (name: string, i: number) => `int ${name}(int a) {\n  return a + ${i};\n}\n`;
const member = (name: string, i: number) => `  int ${name}(int a) {\n    return a + ${i};\n  }\n`;
const prose = (name: string) => `Some words about ${name} here.\n`;

/** One long file per grammar, and one of plain text. */
export const LARGE_FILES: readonly LargeFile[] = [
  { path: "a.ts", block: (name, i) => `function ${name}(a: number) {\n  return a + ${i};\n}\n` },
  { path: "a.tsx", block: (name, i) => `const ${name} = () => <p title="t">text {${i}}</p>;\n` },
  { path: "a.js", block: (name, i) => `function ${name}(a) {\n  return a + ${i};\n}\n` },
  { path: "a.py", block: (name, i) => `def ${name}(a):\n    return a + ${i}\n\n` },
  { path: "a.rs", block: (name, i) => `fn ${name}(a: i32) -> i32 {\n    a + ${i}\n}\n` },
  {
    path: "a.go",
    open: "package main\n\n",
    block: (name, i) => `func ${name}(a int) int {\n\treturn a + ${i}\n}\n`,
  },
  { path: "a.css", block: (name, i) => `.${name} {\n  order: ${i};\n}\n` },
  { path: "a.md", block: (name, i) => `## Heading ${i}\n\n${prose(name)}\n` },
  {
    path: "a.json",
    open: "[\n",
    block: (name, i) => `  { "${name}": ${i} },\n`,
    close: "  null\n]\n",
  },
  { path: "a.yaml", block: (name, i) => `${name}:\n  value: ${i}\n` },
  { path: "a.toml", block: (name, i) => `[${name}]\nvalue = ${i}\n` },
  { path: "a.sh", block: (name, i) => `${name}() {\n  echo ${i}\n}\n` },
  { path: "a.c", block: cFamily },
  { path: "a.cpp", block: cFamily },
  { path: "a.lua", block: (name, i) => `local function ${name}(a)\n  return a + ${i}\nend\n` },
  { path: "A.java", open: "class A {\n", block: member, close: "}\n" },
  {
    path: "a.php",
    open: "<?php\n",
    block: (name, i) => `function ${name}($a) {\n  return $a + ${i};\n}\n`,
  },
  { path: "a.rb", block: (name, i) => `def ${name}(a)\n  a + ${i}\nend\n` },
  { path: "A.cs", open: "class A {\n", block: member, close: "}\n" },
  { path: "a.html", block: (name, i) => `<p id="p${i}">${name} text</p>\n` },
  { path: "A.kt", block: (name, i) => `fun ${name}(a: Int): Int {\n  return a + ${i}\n}\n` },
  { path: "A.swift", block: (name, i) => `func ${name}(a: Int) -> Int {\n  return a + ${i}\n}\n` },
  { path: "a.txt", block: prose },
];

/** The name the middle block has in the old text, and in the new one. */
export const RENAME = { from: "before", to: "after" };

/**
 * `file` written out to at least `length` UTF-16 units, twice: the texts differ only in the
 * middle block's name, {@link RENAME}. Every other block is named `item<index>`.
 */
export function largePair(
  { open = "", block, close = "" }: LargeFile,
  length: number,
): { oldText: string; newText: string } {
  const blocks: string[] = [];
  for (let size = 0; size < length; size += blocks.at(-1)?.length ?? 0)
    blocks.push(block(`item${blocks.length}`, blocks.length));

  const middle = blocks.length >> 1;
  const written = (name: string) =>
    `${open}${blocks.map((text, i) => (i === middle ? block(name, i) : text)).join("")}${close}`;
  return { oldText: written(RENAME.from), newText: written(RENAME.to) };
}
