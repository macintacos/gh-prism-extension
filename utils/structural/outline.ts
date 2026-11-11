import type { Node, Tree } from "web-tree-sitter";
import type { EngineLimits, EngineRefusal, LoadedGrammar } from "./engine";

/** A comment or string literal that covers more than one line. Lines are 1-based. */
export interface OutlineSpan {
  readonly kind: "comment" | "string";
  /** The line the literal opens on; lines after it, through `endLine`, start inside it. */
  readonly startLine: number;
  readonly endLine: number;
  /** The text that ends it, as the line scan's `Inside.closer`. */
  readonly closer: string;
}

/** 1-based and inclusive, like `PrHunk.newStart`. */
export interface LineBlock {
  readonly start: number;
  readonly end: number;
}

/** What a parse knows about a head file that the hunk rules' line scans guess at. */
export interface HeadOutline {
  readonly spans: readonly OutlineSpan[];
  /** Outermost test blocks in source order, not yet widened over the comments above them. */
  readonly testBlocks: readonly LineBlock[];
}

export type OutlineResult =
  | { readonly ok: true; readonly outline: HeadOutline }
  | { readonly ok: false; readonly reason: EngineRefusal };

export interface OutlineInput {
  readonly text: string;
  /** `undefined` when `grammarOf` found no grammar for the file. */
  readonly language: LoadedGrammar | undefined;
  readonly limits: Pick<EngineLimits, "maxTextLength" | "maxParseMs">;
  /** A millisecond clock, such as `performance.now`. */
  readonly now: () => number;
}

/**
 * `text`'s multi-line comments and strings and its test blocks, or why it has none:
 * `unsupported` without a grammar, `too-large` past a limit, `failed` when it does not parse.
 */
export function headOutline({ text, language, limits, now }: OutlineInput): OutlineResult {
  if (language === undefined) return refuse("unsupported");
  if (text.length > limits.maxTextLength) return refuse("too-large");

  // A parse cancelled earlier would otherwise resume on this text.
  language.parser.reset();
  const deadline = now() + limits.maxParseMs;
  const tree = language.parser.parse(text, null, { progressCallback: () => now() > deadline });
  if (tree === null) return refuse("too-large");

  try {
    if (tree.rootNode.hasError) return refuse("failed");
    return { ok: true, outline: outlineOf(tree, language.grammar.id === "python") };
  } finally {
    tree.delete();
  }
}

const refuse = (reason: EngineRefusal): OutlineResult => ({ ok: false, reason });

/**
 * Walks every named node in source order, without recursion, so deep nesting cannot overflow.
 */
// ponytail: visits every named node of a text up to `maxTextLength` with no node budget; add one,
// as `maxTokens` does for the diff, if a large file's outline shows up in a profile.
function outlineOf(tree: Tree, python: boolean): HeadOutline {
  const spans: OutlineSpan[] = [];
  const testBlocks: LineBlock[] = [];
  const stack: { node: Node; inBlock: boolean }[] = [{ node: tree.rootNode, inBlock: false }];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { node } = entry;
    const span = python ? pythonSpanOf(node) : scriptSpanOf(node);
    if (span !== undefined) spans.push(span);

    const block = entry.inBlock ? undefined : python ? pythonTestOf(node) : scriptTestOf(node);
    if (block !== undefined) testBlocks.push(linesOf(block));

    const inBlock = entry.inBlock || block !== undefined;
    for (const child of node.namedChildren.toReversed()) {
      if (child !== null) stack.push({ node: child, inBlock });
    }
  }
  return { spans, testBlocks };
}

const linesOf = (node: Node): LineBlock => ({
  start: node.startPosition.row + 1,
  end: node.endPosition.row + 1,
});

const multiLine = (node: Node): boolean => node.endPosition.row > node.startPosition.row;

const spanOf = (node: Node, kind: OutlineSpan["kind"], closer: string): OutlineSpan => ({
  kind,
  startLine: node.startPosition.row + 1,
  endLine: node.endPosition.row + 1,
  closer,
});

function scriptSpanOf(node: Node): OutlineSpan | undefined {
  if (!multiLine(node)) return undefined;
  if (node.type === "comment") return spanOf(node, "comment", "*/");
  if (node.type === "string" || node.type === "template_string") {
    return spanOf(node, "string", node.text.slice(-1));
  }
  return undefined;
}

function pythonSpanOf(node: Node): OutlineSpan | undefined {
  if (!multiLine(node) || node.type !== "string") return undefined;

  const triple = node.text.slice(-3);
  const closer = triple === '"""' || triple === "'''" ? triple : node.text.slice(-1);
  return spanOf(node, isDocstring(node) ? "comment" : "string", closer);
}

/** Whether a Python `string` is the first statement of a module, class, or function body. */
function isDocstring(node: Node): boolean {
  const statement = node.parent;
  if (statement?.type !== "expression_statement" || statement.namedChildCount !== 1) return false;

  const body = statement.parent;
  const owner = body?.parent?.type;
  const isBody =
    body?.type === "module" ||
    (body?.type === "block" && (owner === "function_definition" || owner === "class_definition"));
  const first = body?.namedChildren.find((child) => child?.type !== "comment");
  return isBody && first?.id === statement.id;
}

const TEST_CALLEES = new Set(["describe", "it", "test"]);
const TEST_NAMESPACES = new Set(["test", "tests"]);
const CALLBACKS = ["arrow_function", "function_expression", "generator_function"];

/** The node a TypeScript or JavaScript test block covers, when `node` opens one. */
function scriptTestOf(node: Node): Node | undefined {
  if (isTestNamespace(node) || isTestCall(node)) return node;
  return undefined;
}

/** Whether `node` is a `namespace` or `module` named `test` or `tests`. */
function isTestNamespace(node: Node): boolean {
  if (node.type !== "internal_module" && node.type !== "module") return false;

  const name = node.childForFieldName("name");
  return name?.type === "identifier" && TEST_NAMESPACES.has(name.text);
}

/** Whether `node` is a statement calling `describe`, `it`, or `test`, or a chain off one, with a callback. */
function isTestCall(node: Node): boolean {
  const call = node.type === "expression_statement" ? node.firstNamedChild : null;
  if (call?.type !== "call_expression") return false;

  let callee = call.childForFieldName("function");
  while (callee?.type === "member_expression" || callee?.type === "call_expression") {
    callee =
      callee.type === "member_expression"
        ? callee.childForFieldName("object")
        : callee.childForFieldName("function");
  }
  if (callee?.type !== "identifier" || !TEST_CALLEES.has(callee.text)) return false;

  const args = call.childForFieldName("arguments");
  return (args?.descendantsOfType(CALLBACKS).length ?? 0) > 0;
}

/** The node a Python test block covers, decorators included, when `node` opens one. */
function pythonTestOf(node: Node): Node | undefined {
  if (!isPythonTest(node)) return undefined;
  return node.parent?.type === "decorated_definition" ? node.parent : node;
}

/** Whether `node` is a `Test…` class, or a `test_…` function not defined in a class. */
function isPythonTest(node: Node): boolean {
  const name = node.childForFieldName("name")?.text ?? "";
  if (node.type === "class_definition") return /^Test\w*$/.test(name);
  if (node.type !== "function_definition" || !/^test_\w*$/.test(name)) return false;

  let owner = node.parent;
  while (owner && owner.type !== "function_definition" && owner.type !== "class_definition") {
    owner = owner.parent;
  }
  return owner?.type !== "class_definition";
}
