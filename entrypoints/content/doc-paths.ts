import { docFileVerdict } from "@/utils/doc-intent";
import type { PrFileDiff } from "@/utils/pr-diff";
import type { PrDataClient } from "@/utils/pr-port";
import type { PrRef } from "@/utils/pr-ref";
import type { PrDataProblem } from "@/utils/pr-source";
import type { FilesRoute } from "./files-page";

/** Why the view keeps path-only sections. */
export type PathOnlyReason = PrDataProblem | "commit-filtered";
/** The paths whose every change is documentation, or why they couldn't be read. */
export type DocPathsResult =
  | { ok: true; paths: ReadonlySet<string> }
  | { ok: false; problem: PathOnlyReason };

async function isDocsOnly(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<boolean> {
  const verdict = docFileVerdict(file);
  if (verdict !== "needs-content") return verdict === "docs";
  const head = await client.fileContent(file.path);
  return head.ok && docFileVerdict(file, head.text) === "docs";
}

/**
 * Paths whose every change is documentation. A file's head text is read only when its patch can't
 * tell; a file whose head can't be read keeps its path section, so only a `files()` failure is
 * returned.
 */
export async function readDocPaths(
  client: Pick<PrDataClient, "files" | "fileContent">,
): Promise<DocPathsResult> {
  const listed = await client.files();
  if (!listed.ok) return listed;
  // ponytail: unbounded concurrency; every ambiguous file reads at once. Cap it with a worker pool if many trip rate-limited.
  const docOnly = await Promise.all(
    listed.files.map(async (file) => ((await isDocsOnly(client, file)) ? file.path : undefined)),
  );
  return { ok: true, paths: new Set(docOnly.filter((path) => path !== undefined)) };
}

/**
 * Doc paths for one Files view. A commit-filtered route connects nothing; otherwise the client
 * is closed when `signal` aborts. Never rejects; once `signal` aborts it may never settle.
 */
export async function docPathsFor(
  route: FilesRoute,
  signal: AbortSignal,
  connect: (pr: PrRef) => PrDataClient,
): Promise<DocPathsResult> {
  if (route.commitFiltered) return { ok: false, problem: "commit-filtered" };
  const client = connect(route.pr);
  signal.addEventListener("abort", () => client.close(), { once: true });
  return readDocPaths(client);
}
