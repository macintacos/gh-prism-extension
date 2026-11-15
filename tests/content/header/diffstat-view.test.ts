// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFileDiffstat,
  findFilesPage,
  headerOf,
  mountedDiffs,
} from "../../../entrypoints/content/files-page";
import {
  type DiffstatChoice,
  type DiffstatOptions,
  showDiffstat,
} from "../../../entrypoints/content/header/diffstat-view";
import type { FileLines, Placement } from "../../../utils/intent/read";
import { foundPage, loadCommitFixture, loadViewedFixture } from "../../fixtures/files-page";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import { afterDebounce, mountsVisit, sectionKeys, sheetsStyling } from "../../fixtures/visit";

const { remountWith, landed, abort } = mountsVisit();

// happy-dom has no Popover API.
const popoversShown = new Set<HTMLElement>();
HTMLElement.prototype.showPopover = function (this: HTMLElement) {
  popoversShown.add(this);
};
HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
  popoversShown.delete(this);
};

function sectionToggle(section: string): HTMLButtonElement {
  const toggle = document.querySelector(`.gh-prism-section[data-section="${section}"] h3 button`);
  if (!(toggle instanceof HTMLButtonElement)) throw new Error(`${section} has no header button`);
  return toggle;
}

describe("the header's lines-changed counter", () => {
  const native = () => {
    const counter = document.querySelector<HTMLElement>(".flex-items-center");
    if (!counter) throw new Error("fixture lacks GitHub's lines-changed counter");
    return counter;
  };
  const counter = () => document.querySelector<HTMLButtonElement>(".gh-prism-diffstat");
  const pills = () => [...document.querySelectorAll<HTMLElement>(".gh-prism-pill")];

  const textsOf = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);
  const pillCounts = () =>
    pills().map((pill) => [
      pill.dataset.section,
      textsOf(pill.querySelectorAll(".gh-prism-pill-count")),
    ]);
  const totalShown = () =>
    textsOf(counter()?.querySelectorAll(".flex-items-center > [aria-hidden]") ?? []);
  const tipOf = (owner: Element | null) => owner?.querySelector(":scope > .gh-prism-tip");

  const split: Placement = {
    kind: "split",
    shares: [
      { section: "implementation", hunks: [], lines: { added: 5, removed: 1 } },
      { section: "docs", hunks: [], lines: { added: 2, removed: 0 } },
    ],
  };

  const counted = landedWith(
    new Map([
      ["src/notes.rs", whole("docs")],
      ["src/render.rs", split],
    ]),
    new Map<string, FileLines>([
      ["src/parser.rs", { added: 10, removed: 3 }],
      ["src/notes.rs", { added: 4, removed: 4 }],
      ["src/render.rs", { added: 7, removed: 1 }],
      ["tests/integration.rs", { added: 20, removed: 0 }],
      ["config/app.toml", "binary"],
      ["Cargo.lock", { added: 1210, removed: 350 }],
    ]),
  );

  it("shows the lines of each section that changed any, in section order", async () => {
    await landed(counted);
    expect(pillCounts()).toEqual([
      ["implementation", ["+15", "−4"]],
      ["tests", ["+20", "−0"]],
      ["docs", ["+6", "−4"]],
      ["generated", ["+1,210", "−350"]],
    ]);
  });

  it("counts Implementation files' comment lines in the docs pill, not Implementation's", async () => {
    await landed(
      landedWith(
        new Map(),
        new Map<string, FileLines>([
          ["src/parser.rs", { added: 10, removed: 3 }],
          ["README.md", { added: 1, removed: 0 }],
        ]),
        new Map([["src/parser.rs", { added: 4, removed: 1 }]]),
      ),
    );
    expect(pillCounts()).toEqual([
      ["implementation", ["+6", "−2"]],
      ["docs", ["+5", "−1"]],
    ]);
  });

  it("styles its pills with its own stylesheet, without the sidebar, until aborted", () => {
    abort();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    const controller = new AbortController();

    showDiffstat(headerOf(page), {
      choice: { view: "breakout" },
      save: () => {},
      signal: controller.signal,
    }).landed?.(counted);
    expect(pills()).not.toHaveLength(0);
    expect(sheetsStyling("gh-prism-pill")).toHaveLength(1);
    expect(sheetsStyling("gh-prism-tip")).toHaveLength(1);

    controller.abort();
    expect(sheetsStyling("gh-prism-pill")).toHaveLength(0);
  });

  it("hides GitHub's counter, just after it, while it stands in", async () => {
    await landed(counted);
    expect(counter()?.nextElementSibling).toBe(native());
    expect(getComputedStyle(native()).display).toBe("none");
  });

  // A pull request's server-rendered header holds a skeleton until GitHub's own diffstat request
  // answers, which on a large pull request can be long after a cached intent lands.
  const skeleton = () =>
    Object.assign(document.createElement("div"), { className: "skeleton__c5fLaY" });

  it("stands in once GitHub's counter replaces its skeleton after intent lands", async () => {
    const github = native();
    const loading = skeleton();
    github.replaceWith(loading);
    await landed(counted);

    loading.replaceWith(github);
    await afterDebounce();

    expect(pills()).toHaveLength(4);
    expect(counter()?.nextElementSibling).toBe(github);
  });

  it("steps aside while GitHub shows its skeleton again, and stands in when its counter returns", async () => {
    await landed(counted);
    const github = native();
    const loading = skeleton();

    github.replaceWith(loading);
    await afterDebounce();
    expect(counter()).toBeNull();

    loading.replaceWith(github);
    await afterDebounce();
    expect(counter()?.nextElementSibling).toBe(github);
  });

  it("switches to GitHub's total when clicked, and back to the sections when clicked again", async () => {
    await landed(counted);

    counter()?.click();
    expect(pills()).toEqual([]);
    expect(totalShown()).toEqual(["+1,604", "-177"]);

    counter()?.click();
    expect(pills()).toHaveLength(4);
    expect(totalShown()).toEqual([]);
  });

  it("opens the next page in the view the tab last chose", async () => {
    const diffstat: DiffstatOptions = { choice: { view: "breakout" }, save: () => {} };
    remountWith(() => Promise.resolve(counted), diffstat);
    await afterDebounce();
    counter()?.click();

    remountWith(() => Promise.resolve(counted), diffstat);
    await afterDebounce();

    expect(pills()).toEqual([]);
    expect(totalShown()).toEqual(["+1,604", "-177"]);
  });

  describe("on the next visit", () => {
    const visitTo = (
      choice: DiffstatChoice,
      intent: Parameters<typeof remountWith>[0],
      pr?: string,
    ) => remountWith(intent, { choice, save: () => {}, pr });

    it("keeps the pull request's breakout up while that visit reads intent", async () => {
      const choice: DiffstatChoice = { view: "breakout" };
      visitTo(choice, () => Promise.resolve(counted), "o/r#1");
      await afterDebounce();

      visitTo(choice, pendingIntent().intent, "o/r#1");

      expect(pills()).toHaveLength(4);
      expect(counter()?.nextElementSibling).toBe(native());
    });

    it("shows that visit's own breakout once its intent lands", async () => {
      const choice: DiffstatChoice = { view: "breakout" };
      visitTo(choice, () => Promise.resolve(counted), "o/r#1");
      await afterDebounce();
      const pending = pendingIntent();
      visitTo(choice, pending.intent, "o/r#1");

      pending.resolve(
        landedWith(new Map(), new Map([["src/parser.rs", { added: 1, removed: 0 }]])),
      );
      await afterDebounce();

      expect(pillCounts()).toEqual([["implementation", ["+1", "−0"]]]);
    });

    it.each([
      ["another pull request", "o/r#2"],
      ["a commit filter", undefined],
    ])("leaves GitHub's counter alone while %s reads intent", async (_, pr) => {
      const choice: DiffstatChoice = { view: "breakout" };
      visitTo(choice, () => Promise.resolve(counted), "o/r#1");
      await afterDebounce();

      visitTo(choice, pendingIntent().intent, pr);

      expect(counter()).toBeNull();
    });

    it("gives GitHub's counter back, then and after, when that visit's read fails", async () => {
      const choice: DiffstatChoice = { view: "breakout" };
      visitTo(choice, () => Promise.resolve(counted), "o/r#1");
      await afterDebounce();

      visitTo(choice, () => Promise.resolve({ ok: false, problem: "failed" }), "o/r#1");
      await afterDebounce();
      expect(counter()).toBeNull();

      visitTo(choice, pendingIntent().intent, "o/r#1");
      expect(counter()).toBeNull();
    });
  });

  it("saves the view each click switches to", async () => {
    const save = vi.fn();
    remountWith(() => Promise.resolve(counted), { choice: { view: "breakout" }, save });
    await afterDebounce();

    counter()?.click();
    counter()?.click();

    expect(save.mock.calls).toEqual([["total"], ["breakout"]]);
  });

  it("titles each pill's tooltip with its section, over what lands there", async () => {
    await landed(counted);

    const tips = pills().map((pill) => [...(tipOf(pill)?.children ?? [])]);
    expect(tips.map(([title]) => title?.textContent)).toEqual([
      "Implementation",
      "Tests",
      "Docs & Comments",
      "Generated / lockfiles",
    ]);
    for (const [, about] of tips) expect(about?.textContent).not.toBe("");
  });

  it("adds up each section's lines into a total in the total's tooltip", async () => {
    await landed(counted);
    counter()?.click();

    const rows = tipOf(counter())?.querySelectorAll(".gh-prism-tip-row, .gh-prism-tip-total") ?? [];
    expect([...rows].map((row) => textsOf(row.querySelectorAll("span")))).toEqual([
      ["Implementation", "+15", "−4"],
      ["Tests", "+20", "−0"],
      ["Docs & Comments", "+6", "−4"],
      ["Generated / lockfiles", "+1,210", "−350"],
      ["Total", "+1,251", "−358"],
    ]);
  });

  it("ends each pill tooltip's title row with gh-prism's mark", async () => {
    await landed(counted);
    for (const pill of pills()) {
      const marks = tipOf(pill)?.querySelectorAll(".gh-prism-mark") ?? [];
      expect(marks).toHaveLength(1);
      expect(marks[0]?.parentElement?.lastElementChild).toBe(marks[0]);
      expect(marks[0]?.parentElement?.querySelector("strong")).not.toBeNull();
    }
  });

  it("ends the total tooltip's last row with gh-prism's mark", async () => {
    await landed(counted);
    counter()?.click();
    const marks = tipOf(counter())?.querySelectorAll(".gh-prism-mark") ?? [];
    expect(marks).toHaveLength(1);
    expect(tipOf(counter())?.lastElementChild?.lastElementChild).toBe(marks[0]);
  });

  it("carries gh-prism's mark only in its tooltips", async () => {
    await landed(counted);
    const marks = [...document.querySelectorAll(".gh-prism-diffstat .gh-prism-mark")];
    expect(marks).toHaveLength(pills().length);
    for (const mark of marks) expect(mark.closest(".gh-prism-tip")).not.toBeNull();
  });

  it("ends the total's tooltip by saying a click splits it by section", async () => {
    await landed(counted);
    counter()?.click();
    expect(tipOf(counter())?.lastElementChild?.textContent).toBe("Click to split by section");
  });

  it("marks each pill, and each row of the total's tooltip, with its section's hue", async () => {
    await landed(counted);

    const huesOf = (nodes: Iterable<HTMLElement>) =>
      [...nodes].map((node) => node.style.getPropertyValue("--gh-prism-hue"));
    const hues = [
      "var(--fgColor-accent)",
      "var(--fgColor-done)",
      "var(--fgColor-attention)",
      "var(--fgColor-muted)",
    ];
    expect(huesOf(pills())).toEqual(hues);

    counter()?.click();
    const rows = tipOf(counter())?.querySelectorAll<HTMLElement>(".gh-prism-tip-row") ?? [];
    expect(huesOf(rows)).toEqual(hues);
  });

  it("says each section's lines in words, keeping its numbers and tooltip from being read", async () => {
    await landed(counted);
    expect(pills().map((pill) => pill.querySelector(".sr-only")?.textContent)).toEqual([
      "Implementation: 15 added, 4 removed.",
      "Tests: 20 added, 0 removed.",
      "Docs & Comments: 6 added, 4 removed.",
      "Generated / lockfiles: 1,210 added, 350 removed.",
    ]);

    for (const pill of pills()) {
      expect(textsOf(pill.querySelectorAll(":scope > :not(.sr-only):not([aria-hidden])"))).toEqual(
        [],
      );
    }
  });

  it("ends each sidebar section's header with the lines its pill shows", async () => {
    await landed(counted);

    const headerCounts = sectionKeys().map((key) => [
      key,
      textsOf(document.querySelectorAll(`[data-section="${key}"] h3 .gh-prism-pill-count`)),
    ]);

    expect(headerCounts).toEqual([
      ["implementation", ["+15", "−4"]],
      ["tests", ["+20", "−0"]],
      ["docs", ["+6", "−4"]],
      ["config", []],
      ["generated", ["+1,210", "−350"]],
    ]);
  });

  it("says each sidebar section's lines in words in its header button's name", async () => {
    await landed(counted);
    expect(sectionToggle("implementation").querySelector(".sr-only")?.textContent).toBe(
      "15 added, 4 removed",
    );
  });

  it("leaves GitHub's counter alone while intent is pending", () => {
    remountWith(pendingIntent().intent);
    expect(counter()).toBeNull();
  });

  it("leaves GitHub's counter alone when intent has no line counts", async () => {
    await landed({ ok: false, problem: "commit-filtered" });
    expect(counter()).toBeNull();
  });

  it("gives GitHub's counter back once aborted", async () => {
    await landed(counted);
    abort();
    expect(counter()).toBeNull();
  });

  it("marks each sidebar section's heading with the icon its pill shows", async () => {
    await landed(counted);
    const iconOf = (owner: Element | null | undefined) =>
      owner?.querySelector(".gh-prism-section-icon path")?.getAttribute("d");
    const headingIcons = sectionKeys().map((key) =>
      iconOf(document.querySelector(`.gh-prism-section[data-section="${key}"] h3`)),
    );
    expect(new Set(headingIcons).size).toBe(5);

    for (const pill of pills()) {
      const heading = document.querySelector(
        `.gh-prism-section[data-section="${pill.dataset.section}"] h3`,
      );
      expect(iconOf(pill)).toBe(iconOf(heading));
    }
  });
});

describe("each file header's lines-changed counter", () => {
  const LAUNCHER = "bin/caret-launcher";
  const LAUNCHER_TEST = "test/core/commands/install/launcher.test.ts";

  let controller = new AbortController();
  beforeEach(() => {
    abort();
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  type Shown = Pick<DiffstatOptions, "pr"> & {
    readonly choice?: DiffstatChoice;
    save?: () => void;
  };
  function show(
    load: () => void,
    { choice = { view: "breakout" }, save = () => {}, pr }: Shown = {},
  ) {
    load();
    const page = foundPage();
    return showDiffstat(headerOf(page), {
      choice,
      save,
      pr,
      files: page,
      signal: controller.signal,
    });
  }

  const rows = () =>
    [...mountedDiffs(foundPage()).values()].map((region) => findFileDiffstat(region));
  const standIns = () => [
    ...document.querySelectorAll<HTMLButtonElement>(".gh-prism-file-diffstat"),
  ];
  const pageCounter = () =>
    document.querySelector<HTMLButtonElement>(".gh-prism-diffstat:not(.gh-prism-file-diffstat)");
  const pillsOf = (owner: Element | undefined) =>
    [...(owner?.querySelectorAll<HTMLElement>(":scope > .gh-prism-pill") ?? [])].map((pill) => [
      pill.dataset.section,
      [...pill.querySelectorAll(".gh-prism-pill-count")].map((node) => node.textContent),
    ]);

  const commit = landedWith(
    new Map([[LAUNCHER_TEST, whole("tests")]]),
    new Map<string, FileLines>([
      [LAUNCHER, { added: 36, removed: 8 }],
      [LAUNCHER_TEST, { added: 39, removed: 0 }],
      ["src/adapters/opencode/paths.ts", { added: 100, removed: 50 }],
    ]),
  );

  it("shows a file all in one section as one pill with that file's own lines", () => {
    show(loadCommitFixture).landed(commit);
    expect(pillsOf(rows()[1]?.firstElementChild ?? undefined)).toEqual([["tests", ["+39", "−0"]]]);
  });

  it("shows a pill per section a file's lines land in, its comment lines under Docs & Comments", () => {
    show(loadCommitFixture).landed(
      landedWith(
        new Map(),
        new Map<string, FileLines>([[LAUNCHER, { added: 36, removed: 8 }]]),
        new Map([[LAUNCHER, { added: 6, removed: 1 }]]),
      ),
    );
    expect(pillsOf(standIns()[0])).toEqual([
      ["implementation", ["+30", "−7"]],
      ["docs", ["+6", "−1"]],
    ]);
  });

  it("shows a pill per share of a split file", () => {
    const split: Placement = {
      kind: "split",
      shares: [
        { section: "implementation", hunks: [], lines: { added: 30, removed: 8 } },
        { section: "tests", hunks: [], lines: { added: 6, removed: 0 } },
      ],
    };
    show(loadCommitFixture).landed(
      landedWith(new Map([[LAUNCHER, split]]), new Map([[LAUNCHER, { added: 36, removed: 8 }]])),
    );
    expect(pillsOf(standIns()[0])).toEqual([
      ["implementation", ["+30", "−8"]],
      ["tests", ["+6", "−0"]],
    ]);
  });

  it("switches every counter on the page from a click on any one, saving each switch", () => {
    const save = vi.fn();
    show(loadCommitFixture, { save }).landed(commit);
    const views = () => [pageCounter(), ...standIns()].map((button) => button?.dataset.view);

    standIns()[0]?.click();
    expect(views()).toEqual(["total", "total", "total"]);

    pageCounter()?.click();
    expect(views()).toEqual(["breakout", "breakout", "breakout"]);
    expect(save.mock.calls).toEqual([["total"], ["breakout"]]);
  });

  it("shows GitHub's own counts in the total view, and the pills again on the way back", () => {
    show(loadCommitFixture).landed(commit);
    const [launcher] = standIns();

    launcher?.click();
    expect(
      [...(launcher?.querySelectorAll(":scope > [aria-hidden]:not(.gh-prism-tip)") ?? [])].map(
        (node) => node.textContent,
      ),
    ).toEqual(["+36", "-8"]);
    expect(launcher?.querySelector(":scope > .gh-prism-tip .gh-prism-tip-total")?.textContent).toBe(
      "Total+36−8",
    );

    launcher?.click();
    expect(pillsOf(launcher)).toEqual([["implementation", ["+36", "−8"]]]);
  });

  it("keeps GitHub's squares out of the counter, last in their row, in either view", () => {
    show(loadCommitFixture).landed(commit);
    const squaresLast = () =>
      rows().every((row) => row?.lastElementChild?.querySelector('[data-testid$=" diffstat"]'));

    expect(squaresLast()).toBe(true);

    standIns()[0]?.click();

    expect(squaresLast()).toBe(true);
    for (const button of standIns())
      expect(button.querySelector('[data-testid$=" diffstat"]')).toBeNull();
  });

  it("leaves a file with no counts row, or only binary lines, with GitHub's counts", () => {
    show(loadViewedFixture).landed(
      landedWith(
        new Map(),
        new Map<string, FileLines>([
          ["config/app.toml", { added: 3, removed: 1 }],
          ["src/lib.rs", { added: 12, removed: 4 }],
          ["Cargo.lock", "binary"],
        ]),
      ),
    );
    expect(
      rows().map((row) => row?.firstElementChild?.classList.contains("gh-prism-file-diffstat")),
    ).toEqual([undefined, true, false]);
  });

  it("stands in again, in the current view, when GitHub re-renders a file header's counts", async () => {
    show(loadCommitFixture).landed(commit);
    standIns()[0]?.click();
    const [row] = rows();
    const fresh = row?.cloneNode(true);
    if (!(fresh instanceof Element)) throw new Error("no counts row");
    const replaced = row?.querySelector<HTMLElement>(".gh-prism-file-diffstat");
    fresh.querySelector(".gh-prism-file-diffstat")?.remove();

    row?.replaceWith(fresh);
    await afterDebounce();

    expect(fresh.firstElementChild?.getAttribute("data-view")).toBe("total");
    expect(standIns()).toHaveLength(2);

    standIns()[0]?.click();

    expect(replaced?.dataset.view).toBe("total");
  });

  it("shows the pull request's held breakout while intent is pending, then the landed one", () => {
    const choice: DiffstatChoice = { view: "breakout" };
    const libLines = (added: number) =>
      landedWith(new Map(), new Map([["src/lib.rs", { added, removed: 4 }]]));
    show(loadViewedFixture, { choice, pr: "o/r#1" }).landed(libLines(12));
    controller.abort();
    controller = new AbortController();

    const view = show(loadViewedFixture, { choice, pr: "o/r#1" });
    view.pending();
    expect(pillsOf(standIns()[0])).toEqual([["implementation", ["+12", "−4"]]]);

    view.landed(libLines(9));
    expect(pillsOf(standIns()[0])).toEqual([["implementation", ["+9", "−4"]]]);
  });

  it("leaves every file header's counts alone when intent fails", () => {
    show(loadCommitFixture).landed({ ok: false, problem: "failed" });
    expect(standIns()).toEqual([]);
  });

  it("gives every file header's counts back, with the stylesheet, once aborted", () => {
    show(loadCommitFixture).landed(commit);
    controller.abort();
    expect(standIns()).toEqual([]);
    expect(sheetsStyling("gh-prism-file-diffstat")).toHaveLength(0);
  });

  describe("tooltip, in the top layer", () => {
    const popover = () => document.querySelector<HTMLElement>("body > [popover]");
    const shownTip = () => {
      const node = popover();
      return node && popoversShown.has(node) ? node : null;
    };
    const point = (type: string, target: Element | null | undefined, relatedTarget?: Element) =>
      target?.dispatchEvent(new PointerEvent(type, { bubbles: true, relatedTarget }));

    it("titles a hovered file pill's tooltip with its section", () => {
      show(loadCommitFixture).landed(commit);

      point("pointerover", standIns()[1]?.querySelector(".gh-prism-pill svg"));

      expect(shownTip()?.querySelector("strong")?.textContent).toBe("Tests");
      expect(shownTip()?.getAttribute("aria-hidden")).toBe("true");
    });

    it("hides once the pointer leaves the pill", () => {
      show(loadCommitFixture).landed(commit);
      const pill = standIns()[1]?.querySelector(".gh-prism-pill");
      point("pointerover", pill);

      point("pointerout", pill, document.body);

      expect(shownTip()).toBeNull();
    });

    it.each([
      ["hovered", (button: HTMLElement) => point("pointerover", button)],
      ["keyboard-focused", (button: HTMLElement) => button.focus()],
    ])("shows the breakdown while a total view is %s", (_, reach) => {
      show(loadCommitFixture, { choice: { view: "total" } }).landed(commit);
      const [launcher] = standIns();
      if (!launcher) throw new Error("no stand-in");

      reach(launcher);

      expect(shownTip()?.querySelector(".gh-prism-tip-total")?.textContent).toBe("Total+36−8");
    });

    it("goes with the stand-ins once aborted", () => {
      show(loadCommitFixture).landed(commit);

      controller.abort();

      expect(popover()).toBeNull();
    });
  });

  it("is a button whose pills say their lines in words, numbers hidden from screen readers", () => {
    show(loadCommitFixture).landed(commit);
    const [launcher] = standIns();

    expect(launcher?.tagName).toBe("BUTTON");
    expect(launcher?.querySelector(".sr-only")?.textContent).toBe(
      "Implementation: 36 added, 8 removed.",
    );
    for (const count of launcher?.querySelectorAll(".gh-prism-pill-count") ?? [])
      expect(count.closest("[aria-hidden]")).not.toBeNull();
  });

  it("hides GitHub's count spans after it, and not the squares", () => {
    show(loadCommitFixture).landed(commit);
    const [row] = rows();

    expect(sheetsStyling("gh-prism-file-diffstat")).toHaveLength(1);
    for (const span of row?.querySelectorAll(":scope > span") ?? [])
      expect(getComputedStyle(span).display).toBe("none");
    expect(getComputedStyle(row?.lastElementChild ?? document.body).display).not.toBe("none");
  });
});
