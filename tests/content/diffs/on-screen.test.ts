// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followOnScreen } from "../../../entrypoints/content/diffs/on-screen";
import { readChangedFiles } from "../../../entrypoints/content/files-page";
import type { FileSection } from "../../../entrypoints/content/visit/land";
import { diffList, foundPage, linkTo, loadFixture } from "../../fixtures/files-page";

/** Stands in for happy-dom's IntersectionObserver, which never fires. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.all.push(this);
  }

  static get latest(): FakeObserver {
    const latest = FakeObserver.all.at(-1);
    if (!latest) throw new Error("no IntersectionObserver was created");
    return latest;
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }

  fire(entries: readonly [Element, boolean][]) {
    const records = entries.map(([target, isIntersecting]) => ({ target, isIntersecting }));
    this.callback(records as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const PATHS = ["src/engine.rs", "src/lib.rs", "src/parser.rs"];

const anchorOfPath = (path: string) => linkTo(path).hash.slice(1);

/** Mounts a region for `path`'s diff in its own entry of the diff list. */
function mount(path: string): Element {
  const existing = document.getElementById(anchorOfPath(path));
  if (existing) return existing;
  const region = document.createElement("div");
  region.setAttribute("role", "region");
  region.id = anchorOfPath(path);
  const entry = document.createElement("div");
  entry.append(region);
  diffList().append(entry);
  return region;
}

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

describe("followOnScreen", () => {
  let controller: AbortController;
  let show: ReturnType<typeof vi.fn<(paths: ReadonlySet<string>) => void>>;
  let regions: Element[];

  const shown = () => show.mock.lastCall?.[0];

  beforeEach(() => {
    loadFixture();
    vi.useFakeTimers();
    FakeObserver.all = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    regions = PATHS.map(mount);
    controller = new AbortController();
    show = vi.fn();

    followOnScreen(foundPage(), show, controller.signal).sections?.(treeSections());
  });

  afterEach(() => {
    controller.abort();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the paths of the regions on screen", () => {
    FakeObserver.latest.fire([[regions[0] as Element, true]]);

    expect(shown()).toEqual(new Set(["src/engine.rs"]));
  });

  it("shows the regions on screen before the sections arrive once they do", () => {
    const early = vi.fn<(paths: ReadonlySet<string>) => void>();
    const view = followOnScreen(foundPage(), early, controller.signal);
    FakeObserver.latest.fire([[regions[0] as Element, true]]);
    expect(early).not.toHaveBeenCalled();

    view.sections?.(treeSections());

    expect(early).toHaveBeenLastCalledWith(new Set(["src/engine.rs"]));
  });

  it("drops a region's path once it leaves the screen", () => {
    FakeObserver.latest.fire([[regions[0] as Element, true]]);
    FakeObserver.latest.fire([[regions[0] as Element, false]]);

    expect(shown()).toEqual(new Set());
  });

  it("shows several regions entering at once", () => {
    FakeObserver.latest.fire(regions.map((r) => [r, true]));

    expect(shown()).toEqual(new Set(PATHS));
  });

  it("drops a region's path once GitHub unmounts it", async () => {
    FakeObserver.latest.fire(regions.map((r) => [r, true]));

    regions[1]?.parentElement?.remove();
    await vi.advanceTimersByTimeAsync(50);

    expect(shown()).toEqual(new Set(["src/engine.rs", "src/parser.rs"]));
  });

  it("observes a region GitHub replaces inside its kept entry", async () => {
    const old = regions[2] as Element;
    const replacement = old.cloneNode() as Element;

    old.replaceWith(replacement);
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeObserver.latest.targets.has(replacement)).toBe(true);
    expect(FakeObserver.latest.targets.has(old)).toBe(false);
  });

  it("insets the viewport's top by the band GitHub's sticky chrome covers", () => {
    const header = document.createElement("div");
    header.className = "diffHeaderWrapper__abc";
    header.style.top = "66px";
    regions[0]?.prepend(header);

    window.dispatchEvent(new Event("resize"));

    expect(FakeObserver.latest.options.rootMargin).toBe("-66px 0px 0px 0px");
  });

  it("recreates its observer over the same regions when the covered band changes", () => {
    const first = FakeObserver.latest;
    const header = document.createElement("div");
    header.className = "diffHeaderWrapper__abc";
    regions[0]?.prepend(header);

    header.style.top = "40px";
    window.dispatchEvent(new Event("resize"));

    expect(first.disconnected).toBe(true);
    expect(FakeObserver.latest).not.toBe(first);
    expect(FakeObserver.latest.targets).toEqual(new Set(regions));
  });

  it("insets by the covered band once a header mounts after the start", async () => {
    expect(FakeObserver.latest.options.rootMargin).toBe("-0px 0px 0px 0px");
    const header = document.createElement("div");
    header.className = "diffHeaderWrapper__abc";
    header.style.top = "66px";

    regions[0]?.prepend(header);
    await vi.advanceTimersByTimeAsync(50);

    expect(FakeObserver.latest.options.rootMargin).toBe("-66px 0px 0px 0px");
    expect(FakeObserver.latest.targets).toEqual(new Set(regions));
  });

  it("keeps its observer when a resize leaves the covered band as it was", () => {
    const first = FakeObserver.latest;

    window.dispatchEvent(new Event("resize"));

    expect(FakeObserver.latest).toBe(first);
  });

  it("shows nothing again while the set of paths is unchanged", () => {
    FakeObserver.latest.fire([[regions[0] as Element, true]]);
    FakeObserver.latest.fire([
      [regions[0] as Element, true],
      [regions[1] as Element, false],
    ]);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it("disconnects once its signal aborts", () => {
    const observer = FakeObserver.latest;

    controller.abort();

    expect(observer.disconnected).toBe(true);
  });
});
