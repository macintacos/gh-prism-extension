// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffstatChoice } from "../entrypoints/content/diffstat-view";
import { findFilesPage } from "../entrypoints/content/files-page";
import { showVisit } from "../entrypoints/content/visit";
import type { FileLines, IntentResult, PendingIntent, Placement } from "../utils/intent";
import { loadFixture } from "./fixtures/files-page";
import { landedWith, pendingIntent, whole } from "./fixtures/intent";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

let controller: AbortController;

const sectionKeys = () =>
  [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
    (section) => section.dataset.section,
  );

function sectionToggle(section: string): HTMLButtonElement {
  const toggle = document.querySelector(`.gh-prism-section[data-section="${section}"] h3 button`);
  if (!(toggle instanceof HTMLButtonElement)) throw new Error(`${section} has no header button`);
  return toggle;
}

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

/**
 * Replaces the view `beforeEach` mounted with one that waits on `intent`, in a tab whose header
 * counter last chose `diffstat`.
 */
function remountWith(
  intent: PendingIntent = () => landedWith(),
  diffstat: DiffstatChoice = { view: "breakout" },
): void {
  controller.abort();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showVisit(page, controller.signal, { intent, diffstat });
}

/** Mounts the view with `result` already landed, and lets it render. */
async function landed(result: IntentResult): Promise<void> {
  remountWith(() => Promise.resolve(result));
  await afterDebounce();
}

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showVisit(page, controller.signal, {
    intent: () => landedWith(),
    diffstat: { view: "breakout" },
  });
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

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

  // happy-dom can't parse the stylesheet, so this pins the adjacency its hiding rule keys on.
  it("sits just before GitHub's counter, which the stylesheet hides", async () => {
    await landed(counted);
    expect(counter()?.nextElementSibling).toBe(native());
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
      "Documentation",
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
      ["Documentation", "+6", "−4"],
      ["Generated / lockfiles", "+1,210", "−350"],
    ]);
  });

  it("says each section's lines in words, keeping its numbers and tooltip from being read", async () => {
    await landed(counted);
    expect(pills().map((pill) => pill.querySelector(".sr-only")?.textContent)).toEqual([
      "Implementation: 15 added, 4 removed.",
      "Tests: 20 added, 0 removed.",
      "Documentation: 6 added, 4 removed.",
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
    controller.abort();
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
