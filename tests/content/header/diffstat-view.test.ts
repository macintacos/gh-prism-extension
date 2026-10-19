// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import {
  type DiffstatChoice,
  showDiffstat,
} from "../../../entrypoints/content/header/diffstat-view";
import type { FileLines, Placement } from "../../../utils/intent/read";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import { afterDebounce, mountsVisit, sectionKeys, sheetsStyling } from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

const { remountWith, landed, abort } = mountsVisit();

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

    showDiffstat(page, { choice: { view: "breakout" }, signal: controller.signal }).landed?.(
      counted,
    );
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
    const choice: DiffstatChoice = { view: "breakout" };
    remountWith(() => Promise.resolve(counted), choice);
    await afterDebounce();
    counter()?.click();

    remountWith(() => Promise.resolve(counted), choice);
    await afterDebounce();

    expect(pills()).toEqual([]);
    expect(totalShown()).toEqual(["+1,604", "-177"]);
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

  it("lists each section's lines in the total's tooltip", async () => {
    await landed(counted);
    counter()?.click();

    const rows = [...(tipOf(counter())?.children ?? [])];
    expect(rows.map((row) => textsOf(row.querySelectorAll("span")))).toEqual([
      ["Implementation", "+15", "−4"],
      ["Tests", "+20", "−0"],
      ["Docs & Comments", "+6", "−4"],
      ["Generated / lockfiles", "+1,210", "−350"],
    ]);
  });

  it("tints each pill, and each row of the total's tooltip, with its section's hue", async () => {
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
    const rows = tipOf(counter())?.querySelectorAll<HTMLElement>(":scope > *") ?? [];
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
