import { describe, expect, it } from "vitest";
import { hiddenKeyOf, hiddenKeysOf, isHidden, withHidden } from "../../utils/hidden-commits";

const FULL = "189706bccb1686c68fb73c5bd9013358320a9e71";
const commit = (headSha: string, repo = "cli") =>
  hiddenKeyOf({ kind: "commit", owner: "cli", repo, headSha });

describe("isHidden", () => {
  it("finds a commit hidden by its full SHA when visited by an abbreviated one, and back", () => {
    expect(isHidden([commit(FULL)], commit("189706b"))).toBe(true);
    expect(isHidden([commit("189706b")], commit(FULL))).toBe(true);
  });

  it("finds a commit whatever the case of its owner, repository, or SHA", () => {
    const visited = hiddenKeyOf({ kind: "commit", owner: "CLI", repo: "Cli", headSha: "189706B" });

    expect(isHidden([commit(FULL)], visited)).toBe(true);
  });

  it("tells apart another commit, and the same SHA in another repository", () => {
    const hidden = [commit(FULL)];

    expect(isHidden(hidden, commit("80256c3"))).toBe(false);
    expect(isHidden(hidden, commit("189706b", "go-gh"))).toBe(false);
  });
});

describe("withHidden", () => {
  it("adds a hidden commit last, once, whichever SHA names it", () => {
    const hidden = withHidden([commit("80256c3"), commit("189706b")], commit(FULL), true);

    expect(hidden).toEqual([commit("80256c3"), commit(FULL)]);
  });

  it("drops a commit shown again, whichever SHA names it", () => {
    expect(withHidden([commit("189706b"), commit("80256c3")], commit(FULL), false)).toEqual([
      commit("80256c3"),
    ]);
  });

  it("keeps the newest 100 commits, dropping the oldest", () => {
    const keys = Array.from({ length: 100 }, (_, n) => commit(n.toString(16).padStart(7, "0")));

    const hidden = withHidden(keys, commit("abcdef0"), true);

    expect(hidden).toHaveLength(100);
    expect(hidden[0]).toBe(commit("0000001"));
    expect(hidden.at(-1)).toBe(commit("abcdef0"));
  });
});

describe("hiddenKeysOf", () => {
  it("keeps only stored keys that name a repository and a SHA", () => {
    const saved = [commit(FULL), 7, "cli/cli@", "cli/cli@not-a-sha", "nope", commit("80256c3")];

    expect(hiddenKeysOf(saved)).toEqual([commit(FULL), commit("80256c3")]);
  });

  it("reads anything but a list as none hidden", () => {
    expect(hiddenKeysOf({ "cli/cli@189706b": true })).toEqual([]);
    expect(hiddenKeysOf(undefined)).toEqual([]);
  });
});
