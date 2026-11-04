const REQUIRED = ["bun.lock", "package.json", "README.md", "LICENSE", "mise.lock"];

/** What's wrong with a sources zip's entries, given the files git tracks. */
export const sourcesZipProblems = (
  entries: readonly string[],
  tracked: readonly string[],
): string[] => {
  const files = new Set(entries.filter((entry) => !entry.endsWith("/")));
  const known = new Set(tracked);

  const untracked = [...files].filter((file) => !known.has(file));
  const required = [...REQUIRED, ...tracked.filter((path) => path.startsWith("patches/"))];
  const missing = required.filter((path) => !files.has(path));

  return [
    ...(untracked.length > 0
      ? [`sources zip holds files git doesn't track: ${untracked.join(", ")}`]
      : []),
    ...(missing.length > 0 ? [`sources zip lacks: ${missing.join(", ")}`] : []),
  ];
};
