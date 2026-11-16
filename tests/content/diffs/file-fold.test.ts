// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foldFiles } from "../../../entrypoints/content/diffs/file-fold";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import { loadViewedFixture, VIEWED_APP_TOML, VIEWED_LIB_RS } from "../../fixtures/files-page";

/** An animation the test settles by hand. */
interface HeldAnimation {
  readonly target: Element;
  readonly keyframes: Keyframe[];
  playbackRate: number;
  cancelled: boolean;
  readonly finished: Promise<unknown>;
  finish(): void;
  reverse(): void;
  cancel(): void;
}

function held(target: Element, keyframes: Keyframe[]): HeldAnimation {
  let settle = () => {};
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    target,
    keyframes,
    playbackRate: 1,
    cancelled: false,
    finished,
    finish: settle,
    reverse() {
      this.playbackRate *= -1;
    },
    cancel() {
      this.cancelled = true;
    },
  };
}

describe("foldFiles", () => {
  let controller: AbortController;
  let animations: HeldAnimation[];
  // The clicks GitHub's own handler on each chevron saw, by diff anchor.
  let reached: Map<string, number>;

  const region = (anchor: string) => {
    const found = document.getElementById(anchor);
    if (!found) throw new Error(`fixture has no ${anchor}`);
    return found;
  };
  const chevronOf = (anchor: string) => {
    const found = region(anchor).querySelector('[class*="diff-file-header__"] button');
    if (!found) throw new Error(`${anchor}'s header has no chevron`);
    return found;
  };
  const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  const settle = async () => {
    for (const animation of animations) animation.finish();
    await vi.runAllTimersAsync();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    loadViewedFixture();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture is not a Files changed page");
    animations = [];
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value(this: Element, keyframes: Keyframe[]) {
        const animation = held(this, keyframes);
        animations.push(animation);
        return animation;
      },
    });
    reached = new Map();
    for (const anchor of [VIEWED_APP_TOML, VIEWED_LIB_RS]) {
      chevronOf(anchor).addEventListener("click", () =>
        reached.set(anchor, (reached.get(anchor) ?? 0) + 1),
      );
    }
    controller = new AbortController();
    foldFiles(page, controller.signal);
  });

  afterEach(() => {
    controller.abort();
    Reflect.deleteProperty(Element.prototype, "animate");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("holds a chevron click on an open file until its diff folds shut, then passes it on once", async () => {
    const body = region(VIEWED_LIB_RS).lastElementChild;

    click(chevronOf(VIEWED_LIB_RS));

    expect(reached.get(VIEWED_LIB_RS)).toBeUndefined();
    const fold = animations.find((animation) => animation.target === body);
    expect(fold?.keyframes.at(-1)).toMatchObject({ height: "0px" });
    expect(animations.some((animation) => animation.target.matches("svg"))).toBe(true);

    await settle();

    expect(reached.get(VIEWED_LIB_RS)).toBe(1);
    expect(animations.every((animation) => animation.cancelled)).toBe(true);
  });

  it("turns the fold around on a second click, and passes nothing on once it is open again", async () => {
    click(chevronOf(VIEWED_LIB_RS));
    click(chevronOf(VIEWED_LIB_RS));

    expect(animations.every((animation) => animation.playbackRate === -1)).toBe(true);

    await settle();

    expect(reached.get(VIEWED_LIB_RS)).toBeUndefined();
    expect(animations.every((animation) => animation.cancelled)).toBe(true);
  });

  it("lets a click on a collapsed file through, then folds the diff GitHub adds open", async () => {
    const added = document.createElement("div");
    chevronOf(VIEWED_APP_TOML).addEventListener("click", () =>
      region(VIEWED_APP_TOML).append(added),
    );

    click(chevronOf(VIEWED_APP_TOML));

    expect(reached.get(VIEWED_APP_TOML)).toBe(1);

    await vi.runAllTimersAsync();

    const fold = animations.find((animation) => animation.target === added);
    expect(fold?.keyframes[0]).toMatchObject({ height: "0px" });
  });

  it("lets an Alt-click through, which GitHub applies to every file", async () => {
    click(chevronOf(VIEWED_LIB_RS), { altKey: true });
    await vi.runAllTimersAsync();

    expect(reached.get(VIEWED_LIB_RS)).toBe(1);
    expect(animations).toEqual([]);
  });

  it("lets a click through under reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);

    click(chevronOf(VIEWED_LIB_RS));
    await vi.runAllTimersAsync();

    expect(reached.get(VIEWED_LIB_RS)).toBe(1);
    expect(animations).toEqual([]);
  });

  it("clips a diff under a stuck header up to it instead, from the window's bottom edge", async () => {
    const header = region(VIEWED_LIB_RS).firstElementChild;
    const body = region(VIEWED_LIB_RS).lastElementChild;
    if (!header || !body) throw new Error("src/lib.rs's diff lacks its header or body");
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 60, 800, 42));
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -900, 800, 2000));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);

    click(chevronOf(VIEWED_LIB_RS));

    const clip = animations.find((animation) => animation.target === body);
    expect(clip?.keyframes).toEqual([
      { clipPath: "inset(0 0 300px 0)" },
      { clipPath: "inset(0 0 998px 0)" },
    ]);

    await settle();

    expect(reached.get(VIEWED_LIB_RS)).toBe(1);
  });

  it("lets every click through once its signal aborts", async () => {
    controller.abort();

    click(chevronOf(VIEWED_LIB_RS));
    await vi.runAllTimersAsync();

    expect(reached.get(VIEWED_LIB_RS)).toBe(1);
    expect(animations).toEqual([]);
  });
});
