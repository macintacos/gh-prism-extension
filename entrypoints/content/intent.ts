import { docFileVerdict, scanHeadText } from "@/utils/doc-intent";
import { changesOnlyInlineTests, inlineTestRuleApplies } from "@/utils/inline-tests";
import type { PrFileDiff } from "@/utils/pr-diff";
import type { PrDataClient } from "@/utils/pr-port";
import type { PrRef } from "@/utils/pr-ref";
import type { PrDataProblem } from "@/utils/pr-source";
import type { SectionKey } from "@/utils/sections";
import type { FilesRoute } from "./files-page";

/** Why the view keeps path-only sections. */
export type PathOnlyReason = PrDataProblem | "commit-filtered";
/** The sections intent can place a file in, whatever its path says. */
export type IntentSection = Extract<SectionKey, "docs" | "tests">;
/**
 * The docs and tests overrides: each file whose every change is documentation or inline-test code,
 * keyed by path to its section. A file absent from `overrides` keeps its path section.
 */
export type IntentResult =
  | { ok: true; overrides: ReadonlyMap<string, IntentSection> }
  | { ok: false; problem: PathOnlyReason };

/**
 * The section a file's changes place it in, or `undefined` to keep its path section. The head text
 * is read only when the patch can't settle the docs verdict or the inline-test rule could apply.
 */
async function sectionFromContent(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<IntentSection | undefined> {
  const docs = docFileVerdict(file);
  if (docs === "docs") return "docs";
  const testable = inlineTestRuleApplies(file);
  if (docs === "path" && !testable) return undefined;
  const content = await client.fileContent(file.path);
  if (!content.ok) return undefined;
  const head = scanHeadText(file.path, content.text);
  if (head === undefined) return undefined;
  if (docs === "needs-content" && docFileVerdict(file, head) === "docs") return "docs";
  return testable && changesOnlyInlineTests(file, head) ? "tests" : undefined;
}

/**
 * The docs and tests overrides for one Files view. A file whose head can't be read keeps its path
 * section, so only a `files()` failure makes the result not ok.
 */
export async function readIntent(
  client: Pick<PrDataClient, "files" | "fileContent">,
): Promise<IntentResult> {
  const listed = await client.files();
  if (!listed.ok) return listed;
  // ponytail: unbounded concurrency; every ambiguous file reads at once. Cap it with a worker pool if many trip rate-limited.
  const sections = await Promise.all(
    listed.files.map(async (file) => ({
      path: file.path,
      section: await sectionFromContent(client, file),
    })),
  );
  const overrides = new Map<string, IntentSection>();
  for (const { path, section } of sections) {
    if (section !== undefined) overrides.set(path, section);
  }
  return { ok: true, overrides };
}

/**
 * Section overrides for one Files view. A commit-filtered route connects nothing; otherwise the
 * client is closed when `signal` aborts. Never rejects; once `signal` aborts it may never settle.
 */
export async function intentFor(
  route: FilesRoute,
  signal: AbortSignal,
  connect: (pr: PrRef) => PrDataClient,
): Promise<IntentResult> {
  if (route.commitFiltered) return { ok: false, problem: "commit-filtered" };
  const client = connect(route.pr);
  signal.addEventListener("abort", () => client.close(), { once: true });
  return readIntent(client);
}
