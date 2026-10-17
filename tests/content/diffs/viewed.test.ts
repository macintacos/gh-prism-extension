// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followViewed, visitViewed } from "../../../entrypoints/content/diffs/viewed";
import { readChangedFiles } from "../../../entrypoints/content/files-page";
import type { FileSection } from "../../../entrypoints/content/visit/land";
import type { ViewedSeed } from "../../../utils/github/pr-ref";
import {
  byId,
  diffList,
  foundPage,
  loadFixture,
  loadViewedCommitFilterFixture,
  loadViewedFixture,
  VIEWED_APP_TOML,
  VIEWED_LIB_RS,
} from "../../fixtures/files-page";

const digestOf = (anchor: string) => anchor.replace(/^diff-/, "");

const seedViewing = (anchor: string, offered = true): ViewedSeed => ({
  offered,
  viewed: new Map([[digestOf(anchor), true]]),
});

const treeSections = (): FileSection[] => [
  {
    key: "core",
    entries: readChangedFiles(document).map((file) => ({
      file,
      section: "core",
      lines: undefined,
    })),
  } as unknown as FileSection,
];

/** Takes `anchor`'s diff entry out of the diff list, as GitHub does when it unmounts a diff. */
function unmount(anchor: string): Element {
  const entry = byId(anchor).parentElement;
  if (!entry) throw new Error(`#${anchor} has no entry`);
  entry.remove();
  return entry;
}

const pressToggle = (root: ParentNode, pressed: boolean) => {
  const toggle = root.querySelector('button[aria-label$="Viewed"]');
  toggle?.setAttribute("aria-pressed", String(pressed));
  toggle?.setAttribute("aria-label", pressed ? "Viewed" : "Not Viewed");
};

describe("visitViewed", () => {
  it("keys a seed's states by diff anchor, offered as the seed says", () => {
    const viewed = visitViewed(seedViewing(VIEWED_APP_TOML, false));

    expect(viewed.offered).toBe(false);
    expect(viewed.byAnchor).toEqual(new Map([[VIEWED_APP_TOML, true]]));
  });

  it("starts empty and not offered without a seed", () => {
    const viewed = visitViewed(undefined);

    expect(viewed.offered).toBe(false);
    expect(viewed.byAnchor.size).toBe(0);
  });
});

describe("followViewed", () => {
  let controller: AbortController;
  let show: ReturnType<typeof vi.fn<(paths: ReadonlySet<string>) => void>>;

  const shown = () => show.mock.lastCall?.[0];
  const follow = (seed: ViewedSeed | undefined, viewed = visitViewed(seed)) => {
    followViewed(foundPage(), viewed, show, controller.signal).sections?.(treeSections());
    return viewed;
  };

  beforeEach(() => {
    loadViewedFixture();
    vi.useFakeTimers();
    controller = new AbortController();
    show = vi.fn();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("shows an unmounted file's real state from the seed", () => {
    unmount(VIEWED_APP_TOML);

    follow(seedViewing(VIEWED_APP_TOML));

    expect(shown()).toEqual(new Set(["config/app.toml"]));
  });

  it("falls back to header reads without a seed", async () => {
    const lib = unmount(VIEWED_LIB_RS);

    follow(undefined);
    expect(shown()).toEqual(new Set(["config/app.toml"]));

    pressToggle(lib, true);
    diffList().append(lib);
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(new Set(["config/app.toml", "src/lib.rs"]));

    lib.remove();
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toEqual(new Set(["config/app.toml", "src/lib.rs"]));
  });

  it("follows GitHub's Viewed toggle", async () => {
    follow(undefined);

    pressToggle(byId(VIEWED_LIB_RS), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toEqual(new Set(["config/app.toml", "src/lib.rs"]));

    pressToggle(byId(VIEWED_LIB_RS), false);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toEqual(new Set(["config/app.toml"]));
  });

  it("shares a visit's state across its pages", () => {
    const viewed = follow(undefined);
    controller.abort();

    loadViewedFixture();
    unmount(VIEWED_APP_TOML);
    controller = new AbortController();
    show = vi.fn();
    follow(undefined, viewed);

    expect(shown()).toEqual(new Set(["config/app.toml"]));
  });

  it("dims nothing where the page offers no Viewed", () => {
    loadFixture();
    follow(seedViewing(VIEWED_APP_TOML, false));
    controller.abort();

    loadViewedCommitFilterFixture();
    controller = new AbortController();
    follow(undefined);
    controller.abort();

    controller = new AbortController();
    follow(seedViewing(VIEWED_LIB_RS, false));

    for (const [paths] of show.mock.calls) expect(paths.size).toBe(0);
  });
});
