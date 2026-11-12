// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuralAnswer } from "../../../entrypoints/content/diffs/structural-files";
import {
  type FileState,
  LOADING_CLASS,
  languageRequestUrl,
  NOTICE_CLASS,
  NOTICE_COPY,
  type NoticeKind,
  noticeOf,
  showStructuralNotices,
} from "../../../entrypoints/content/diffs/structural-notices";
import type { StructuralProblem } from "../../../utils/structural/file-changes";
import { anchorOfTable, mountDiffs, sectionsOf, tableAt } from "../../fixtures/diff-tables";
import prRename from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import prUnified from "../../fixtures/files-page-diff-unified.html?raw";

const OWN = `.${NOTICE_CLASS}, .${LOADING_CLASS}`;
const PROBLEMS: readonly Exclude<StructuralProblem, "not-applicable">[] = [
  "no-access",
  "rate-limited",
  "too-large",
  "failed",
  "unsupported",
];

const flush = () => vi.advanceTimersByTimeAsync(100);

describe("noticeOf", () => {
  it.each(PROBLEMS)("gives the %s problem its own notice", (problem) => {
    expect(noticeOf({ ok: false, problem }, undefined)).toBe(problem);
  });

  it("gives a not-applicable file no notice", () => {
    expect(noticeOf({ ok: false, problem: "not-applicable" }, undefined)).toBeUndefined();
  });

  it("gives an ok answer a notice only when the painter reports a mismatch", () => {
    const ok: StructuralAnswer = {
      ok: true,
      file: { annotations: { old: {}, new: {} }, text: { old: {}, new: {} } },
    };
    expect(noticeOf(ok, undefined)).toBeUndefined();
    expect(noticeOf(ok, "painted")).toBeUndefined();
    expect(noticeOf(ok, "mismatch")).toBe("mismatch");
  });

  it("gives a file with no answer no notice", () => {
    expect(noticeOf(undefined, undefined)).toBeUndefined();
  });
});

describe("NOTICE_COPY", () => {
  it("says each kind in its own single sentence", () => {
    const sentences = Object.values(NOTICE_COPY);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) expect(sentence).toMatch(/^[^.]+\.$/);
  });
});

describe("languageRequestUrl", () => {
  const FORM =
    "https://github.com/macintacos/gh-prism-extension/issues/new?template=language_request.yml";

  it.each([
    { path: "src/main.zig", url: `${FORM}&extensions=.zig` },
    { path: "a.b/Parser.test.KT", url: `${FORM}&extensions=.KT` },
    { path: "lib/vec.c++", url: `${FORM}&extensions=.c%2B%2B` },
  ])("prefills only the extension of $path", ({ path, url }) => {
    expect(languageRequestUrl(path)).toBe(url);
  });

  it.each([
    "Makefile",
    "infra.v2/Dockerfile",
    "config/.env",
    "notes/plan.secret project",
    "a/trailing.",
    `a/b.${"x".repeat(17)}`,
  ])("prefills nothing for %s, which has no plain extension", (path) => {
    expect(languageRequestUrl(path)).toBe(FORM);
  });
});

describe("showStructuralNotices", () => {
  let controller: AbortController;
  let states: Map<string, FileState>;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    states = new Map();
  });

  afterEach(() => {
    controller.abort();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.head.replaceChildren();
  });

  const mount = (diffs: HTMLElement) => {
    const notices = showStructuralNotices(diffs, controller.signal, (path) => states.get(path));
    notices.sections?.(sectionsOf(diffs), new Set());
    return notices;
  };

  const show = async (diffs: HTMLElement) => {
    const notices = mount(diffs);
    await flush();
    return notices;
  };

  it("shows a notice kind's sentence directly before its table, unannounced, leaving the table as it was", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const rows = [...table.rows];
    states.set(anchorOfTable(table), "too-large");

    await show(diffs);

    expect(diffs.querySelectorAll(OWN)).toHaveLength(1);
    const notice = table.previousElementSibling;
    expect(notice?.tagName).toBe("P");
    expect(notice?.classList.contains(NOTICE_CLASS)).toBe(true);
    expect(notice?.textContent).toBe(NOTICE_COPY["too-large"]);
    expect(notice?.hasAttribute("role")).toBe(false);
    expect(notice?.hasAttribute("aria-live")).toBe(false);
    expect(tableAt(diffs)).toBe(table);
    expect([...table.rows]).toEqual(rows);
  });

  it("follows an unsupported file's sentence with a link that asks for its language in a new tab", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const sections = sectionsOf(diffs).map((section) => ({
      ...section,
      entries: section.entries.map((entry) => ({
        ...entry,
        file: { ...entry.file, path: "src/shader.zig" },
      })),
    }));
    states.set("src/shader.zig", "unsupported");

    const notices = showStructuralNotices(diffs, controller.signal, (path) => states.get(path));
    notices.sections?.(sections, new Set());
    await flush();

    const notice = table.previousElementSibling;
    const link = notice?.querySelector("a");
    expect(notice?.firstChild?.textContent).toBe(NOTICE_COPY.unsupported);
    expect(notice?.textContent).toBe(`${NOTICE_COPY.unsupported} ${link?.textContent}`);
    expect(link?.href).toBe(
      "https://github.com/macintacos/gh-prism-extension/issues/new?template=language_request.yml&extensions=.zig",
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(" ")).toContain("noreferrer");
  });

  it.each<NoticeKind>(["too-large", "rate-limited", "no-access", "failed", "mismatch"])(
    "gives a %s notice no link",
    async (kind) => {
      const diffs = mountDiffs(prSplit);
      states.set(anchorOfTable(tableAt(diffs)), kind);

      await show(diffs);

      expect(tableAt(diffs).previousElementSibling?.querySelector("a")).toBeNull();
    },
  );

  it("mutates nothing on a pass with nothing changed", async () => {
    const diffs = mountDiffs(prSplit);
    states.set(anchorOfTable(tableAt(diffs)), "failed");
    const notices = await show(diffs);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(diffs, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    notices.refresh();
    await flush();

    observer.disconnect();
    expect(records).toEqual([]);
  });

  it("shows nothing for an undefined state, and removes a notice whose state turns undefined", async () => {
    const diffs = mountDiffs(prSplit);
    const notices = await show(diffs);
    expect(diffs.querySelector(OWN)).toBeNull();

    const path = anchorOfTable(tableAt(diffs));
    states.set(path, "too-large");
    notices.refresh();
    await flush();
    expect(diffs.querySelectorAll(OWN)).toHaveLength(1);

    states.delete(path);
    notices.refresh();
    await flush();
    expect(diffs.querySelector(OWN)).toBeNull();
  });

  it("shows a notice once more on a table GitHub mounts anew", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    states.set(anchorOfTable(table), "rate-limited");
    await show(diffs);

    const card = table.parentElement;
    if (!card) throw new Error("no card");
    const fresh = table.cloneNode(true);
    card.replaceChildren();
    await flush();
    card.append(fresh);
    await flush();

    expect(diffs.querySelectorAll(OWN)).toHaveLength(1);
    expect(fresh.previousSibling).toBe(diffs.querySelector(`.${NOTICE_CLASS}`));
  });

  it("leaves no notice behind when the table gives way to the rich view", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    states.set(anchorOfTable(table), "failed");
    await show(diffs);

    table.replaceWith(document.createElement("div"));
    await flush();

    expect(diffs.querySelector(OWN)).toBeNull();
  });

  it("shows no notice while the diffs read Unified", async () => {
    const diffs = mountDiffs(prUnified);
    states.set(anchorOfTable(tableAt(diffs)), "unsupported");

    await show(diffs);

    expect(diffs.querySelector(OWN)).toBeNull();
  });

  it("shows a one-sided three-column file's notice beside a Split table", async () => {
    const diffs = mountDiffs(prSplit, prRename);
    const oneSided = tableAt(diffs, 1);
    states.set(anchorOfTable(oneSided), "unsupported");

    await show(diffs);

    expect(oneSided.previousElementSibling?.classList.contains(NOTICE_CLASS)).toBe(true);
  });

  describe("loading", () => {
    const loadingOf = (table: Element) =>
      table.previousElementSibling?.classList.contains(LOADING_CLASS)
        ? table.previousElementSibling
        : null;

    it("holds the loading line back until a request has been pending 150 ms", async () => {
      const diffs = mountDiffs(prSplit);
      const table = tableAt(diffs);
      states.set(anchorOfTable(table), "pending");
      mount(diffs);
      vi.advanceTimersToNextFrame();

      await vi.advanceTimersByTimeAsync(149);
      expect(diffs.querySelector(OWN)).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      vi.advanceTimersToNextFrame();
      const line = loadingOf(table);
      expect(line?.getAttribute("aria-hidden")).toBe("true");
    });

    it("starts the hold over when a pending file's table is mounted again", async () => {
      const diffs = mountDiffs(prSplit);
      const table = tableAt(diffs);
      states.set(anchorOfTable(table), "pending");
      mount(diffs);
      vi.advanceTimersToNextFrame();
      await vi.advanceTimersByTimeAsync(50);

      const card = table.parentElement;
      if (!card) throw new Error("no card");
      table.remove();
      await flush();
      card.append(table);
      await vi.advanceTimersByTimeAsync(140);
      expect(diffs.querySelector(OWN)).toBeNull();

      await vi.advanceTimersByTimeAsync(150);
      expect(loadingOf(table)).not.toBeNull();
    });

    it("shows the line only on a pending file whose own table is drawn in Split", async () => {
      const diffs = mountDiffs(prSplit, prRename);
      const split = tableAt(diffs, 0);
      const oneSided = tableAt(diffs, 1);
      states.set(anchorOfTable(split), "pending");
      states.set(anchorOfTable(oneSided), "pending");

      await show(diffs);
      await vi.advanceTimersByTimeAsync(200);

      expect(loadingOf(split)).not.toBeNull();
      expect(loadingOf(oneSided)).toBeNull();
    });

    it("never shows the line for a request that settles within 150 ms", async () => {
      const diffs = mountDiffs(prSplit);
      const path = anchorOfTable(tableAt(diffs));
      states.set(path, "pending");
      const notices = mount(diffs);
      await vi.advanceTimersByTimeAsync(100);

      states.delete(path);
      notices.refresh();
      await vi.advanceTimersByTimeAsync(500);

      expect(diffs.querySelector(OWN)).toBeNull();
    });

    it("swaps the line for the file's notice once its state leaves pending", async () => {
      const diffs = mountDiffs(prSplit);
      const table = tableAt(diffs);
      const path = anchorOfTable(table);
      states.set(path, "pending");
      const notices = await show(diffs);
      await vi.advanceTimersByTimeAsync(200);
      expect(loadingOf(table)).not.toBeNull();

      states.set(path, "mismatch" satisfies NoticeKind);
      notices.refresh();
      await flush();

      expect(diffs.querySelectorAll(OWN)).toHaveLength(1);
      expect(table.previousElementSibling?.textContent).toBe(NOTICE_COPY.mismatch);
    });
  });

  it("removes every node and its sheet on abort, and a pending hold adds nothing after", async () => {
    const diffs = mountDiffs(prSplit, prRename);
    const before = document.head.querySelectorAll("style").length;
    states.set(anchorOfTable(tableAt(diffs, 0)), "pending");
    states.set(anchorOfTable(tableAt(diffs, 1)), "unsupported");
    await show(diffs);
    expect(document.head.querySelectorAll("style").length).toBe(before + 1);
    expect(diffs.querySelectorAll(OWN)).toHaveLength(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(500);

    expect(diffs.querySelector(OWN)).toBeNull();
    expect(document.head.querySelectorAll("style").length).toBe(before);
  });
});
