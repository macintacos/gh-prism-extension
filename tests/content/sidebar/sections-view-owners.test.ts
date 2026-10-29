// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { codeOwnerOf, type PrCodeOwners } from "../../../utils/github/code-owners";
import { outline } from "../../fixtures/file-list";
import { byId, openOverlay } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  hostOf,
  nativeLink,
  patchShadowActiveElement,
  press,
  renderSplit,
  rowIn,
  shieldOf,
  withCommentLines,
} from "../../fixtures/sections-view";
import large from "../../fixtures/team-members-large.json?raw";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  rowsIn,
  sectionKeys,
  view,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

patchShadowActiveElement();

// happy-dom has no Popover API: these stand in for the calls the popover makes, closing with a
// `beforetoggle` and then a `toggle` to `closed`, at once, where a browser queues `toggle`.
const shownPopovers = new WeakSet<HTMLElement>();
HTMLElement.prototype.showPopover = function (this: HTMLElement) {
  shownPopovers.add(this);
};
HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
  if (!shownPopovers.delete(this)) return;
  for (const type of ["beforetoggle", "toggle"]) {
    this.dispatchEvent(Object.assign(new Event(type), { newState: "closed" }));
  }
};

const { remountWith, abort } = mountsVisit();

/** A pull request whose paths each have the owners of the tokens `byPath` lists. */
const tokensOf = (byPath: Readonly<Record<string, readonly string[]>>): PrCodeOwners =>
  new Map(
    Object.entries(byPath).map(([path, tokens]) => [
      path,
      { owners: tokens.map(codeOwnerOf), ownedByViewer: false },
    ]),
  );

/** A pull request whose `owned` paths each have `@o/team`, and whose `unowned` paths have none. */
const ownersOf = (owned: readonly string[], unowned: readonly string[] = []): PrCodeOwners =>
  tokensOf(
    Object.fromEntries([
      ...owned.map((path) => [path, ["@o/team"]]),
      ...unowned.map((path) => [path, []]),
    ]),
  );

const shieldsIn = (listing: string) => [
  ...(hostOf(listing).shadowRoot?.querySelectorAll<HTMLElement>("[data-item-shield]") ?? []),
];
const shieldedIn = (listing: string) =>
  shieldsIn(listing).map((shield) => shield.dataset.itemShield);
/** The paths whose shield `listing`'s style rules reveal, once each. */
const revealedIn = (listing: string) => [
  ...new Set(
    [...(hostOf(listing).shadowRoot?.querySelectorAll("style") ?? [])].flatMap((style) =>
      [...(style.textContent ?? "").matchAll(/\[data-item-shield="((?:\\.|[^"])+)"\]/g)].map(
        ([, path]) => path?.replaceAll("\\", ""),
      ),
    ),
  ),
];
const allShielded = () => sectionKeys().flatMap((section) => shieldedIn(section ?? ""));

/** Mounts a visit landing `result` whose code owners settle as `owners`, and lets both land. */
async function landedOwned(owners: PrCodeOwners | undefined, result = landedWith()): Promise<void> {
  remountWith(() => Promise.resolve(result), undefined, { codeOwners: Promise.resolve(owners) });
  await afterDebounce();
}

/** Mounts a visit whose code owners stay pending until the returned function settles them. */
function remountPending(): (owners: PrCodeOwners) => void {
  let resolve: (owners: PrCodeOwners) => void = () => {};
  remountWith(undefined, undefined, { codeOwners: new Promise((settle) => (resolve = settle)) });
  return (owners) => resolve(owners);
}

describe("showSections", () => {
  describe("the code owners shield", () => {
    it("gives an owned file's row one shield and an unowned file's none", async () => {
      await landedOwned(ownersOf(["src/engine.rs"], ["src/parser.rs"]));

      expect(shieldedIn("implementation")).toEqual(["src/", "src/engine.rs"]);
    });

    it("appears when ownership resolves after the sections land", async () => {
      const resolve = remountPending();
      await afterDebounce();
      expect(shieldedIn("implementation")).toEqual([]);

      resolve(ownersOf(["src/engine.rs"]));
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/", "src/engine.rs"]);
    });

    it("appears when ownership resolves before the sections land", async () => {
      let land: () => void = () => {};
      const intent = new Promise<void>((settle) => (land = settle)).then(() => landedWith());
      remountWith(() => intent, undefined, {
        codeOwners: Promise.resolve(ownersOf(["src/engine.rs"])),
      });
      await afterDebounce();

      land();
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/", "src/engine.rs"]);
    });

    it("draws nothing for a commit or a failed read", async () => {
      await landedOwned(undefined);

      expect(allShielded()).toEqual([]);
    });

    it("draws nothing in a repository without CODEOWNERS", async () => {
      await landedOwned(ownersOf([]));

      expect(allShielded()).toEqual([]);
    });

    it("draws nothing once its page has gone", async () => {
      const resolve = remountPending();
      await afterDebounce();
      const host = hostOf("implementation");

      remountWith();
      resolve(ownersOf(["src/engine.rs"]));
      await afterDebounce();

      expect(host.shadowRoot?.querySelector("[data-item-shield]") ?? null).toBeNull();
      expect(allShielded()).toEqual([]);
    });

    it("shields a split file's row in every section", async () => {
      await landedOwned(ownersOf(["src/render.rs"]), renderSplit([{ first: 2, last: 8 }]));

      expect(shieldedIn("implementation")).toEqual(["src/", "src/render.rs"]);
      expect(shieldedIn("docs")).toEqual(["src/", "src/render.rs"]);
    });

    it("shields a file's comment-lines entry too", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]), withCommentLines());

      expect(shieldedIn("implementation")).toEqual(["src/", "src/engine.rs"]);
      expect(shieldedIn(COMMENT_LINES)).toEqual(["src/", "src/engine.rs"]);
    });

    it("appears in a section built after ownership landed", async () => {
      await landedOwned(ownersOf(["docs/intro.md"]));
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();

      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(shieldedIn("docs")).toEqual(["docs/", "docs/intro.md"]);
    });

    it("lands without moving a file, a count, a folder, or the sidebar's scroll", async () => {
      const { FileTree } = await import("@pierre/trees");
      const resolve = remountPending();
      await afterDebounce();
      clickAt(rowIn("implementation", "src/generated/"));
      await afterDebounce();
      const sidebar = byId("pr-file-tree");
      sidebar.scrollTop = 40;
      const snapshot = () => ({
        sections: sectionKeys(),
        files: sectionKeys().map((section) => filesIn(section ?? "")),
        counter: document.querySelector(".gh-prism-diffstat")?.textContent,
        scrollTop: sidebar.scrollTop,
        folder: rowIn("implementation", "src/generated/").getAttribute("aria-expanded"),
        folderName: rowIn("implementation", "src/generated/").getAttribute("aria-label"),
      });
      const before = snapshot();
      const resetPaths = vi.spyOn(FileTree.prototype, "resetPaths");

      resolve(ownersOf(["src/engine.rs", "src/generated/schema.rs", "README.md"]));
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/", "src/generated/", "src/engine.rs"]);
      expect(snapshot()).toEqual(before);
      expect(before.folder).toBe("false");
      expect(resetPaths).not.toHaveBeenCalled();
      resetPaths.mockRestore();
    });

    it("shields owned rows on a pull request that offers no Viewed boxes", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]));

      expect(hostOf("implementation").shadowRoot?.querySelector("[data-item-checkbox]")).toBeNull();
      expect(shieldedIn("implementation")).toEqual(["src/", "src/engine.rs"]);
    });

    it("puts only the focused row's shield in the tab order", async () => {
      const owned = ["src/engine.rs", "src/helpers.rs", "src/render.rs"];
      await landedOwned(ownersOf(owned));
      const rows = rowsIn("implementation");

      rows[0]?.focus();
      if (rows[0]) press(rows[0], "End");
      await afterDebounce();

      expect(
        shieldsIn("implementation")
          .filter((shield) => shield.tabIndex === 0)
          .map((shield) => shield.dataset.itemShield),
      ).toEqual([rows.at(-1)?.dataset.itemPath]);
    });

    it("leaves the row's accessible name as it was", async () => {
      await landedOwned(undefined);
      const name = rowIn("implementation", "src/engine.rs").getAttribute("aria-label");

      await landedOwned(ownersOf(["src/engine.rs"]));

      expect(rowIn("implementation", "src/engine.rs").getAttribute("aria-label")).toBe(name);
    });

    it("writes a listing's reveal rules for its own owned files only", async () => {
      await landedOwned(ownersOf(["src/engine.rs", "README.md"]));

      expect(revealedIn("implementation")).toEqual(["src/engine.rs", "src/"]);
    });

    it("writes the reveal rule of an owned file added to a listing", async () => {
      await landedOwned(ownersOf(["src/added.rs"]));

      addNativeFile("src/added.rs", "src/engine.rs");
      await afterDebounce();

      expect(revealedIn("implementation")).toEqual(["src/added.rs", "src/"]);
    });

    it("shields only the rows an owner filter keeps", async () => {
      remountWith(() => Promise.resolve(landedWith()), undefined, {
        owner: "@o/frontend",
        codeOwners: Promise.resolve(
          tokensOf({ "src/lib.rs": ["@o/frontend"], "src/engine.rs": ["@o/platform"] }),
        ),
      });
      await afterDebounce();

      expect(revealedIn("implementation")).toEqual(["src/lib.rs", "src/"]);
      expect(shieldedIn("implementation")).toEqual(["src/", "src/lib.rs"]);
    });

    it("shows only the next pull request's owners after moving to it", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]));

      await landedOwned(ownersOf(["src/parser.rs"]));

      expect(shieldedIn("implementation")).toEqual(["src/", "src/parser.rs"]);
    });

    describe("a folder's shield", () => {
      it("is one button on the row of a folder holding an owned file", async () => {
        await landedOwned(ownersOf(["src/engine.rs"]));

        const shields = shieldsIn("implementation").filter(
          (shield) => shield.dataset.itemShield === "src/",
        );
        expect(shields).toHaveLength(1);
        expect(shields[0]?.tagName).toBe("BUTTON");
      });

      it("shows on every folder row above an owned file", async () => {
        await landedOwned(ownersOf(["src/generated/schema.rs"]));

        expect(shieldedIn("implementation")).toEqual([
          "src/",
          "src/generated/",
          "src/generated/schema.rs",
        ]);
      });

      it("is missing from a folder whose files have no owners", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"], "config/app.toml": [] }));

        expect(shieldedIn("config")).toEqual([]);
      });

      it("covers a flattened chain's deepest folder", async () => {
        addNativeFile("a/b/c/file.rs", "src/engine.rs");
        await landedOwned(ownersOf(["a/b/c/file.rs"]));

        expect(shieldedIn("implementation")).toContain("a/b/c/");
        expect(shieldedIn("implementation")).not.toContain("a/");
      });

      it("is in the tab order only on the focused folder row", async () => {
        await landedOwned(ownersOf(["src/generated/schema.rs"]));
        const rows = rowsIn("implementation");

        rows[0]?.focus();
        await afterDebounce();

        expect(
          shieldsIn("implementation")
            .filter((shield) => shield.tabIndex === 0)
            .map((shield) => shield.dataset.itemShield),
        ).toEqual(["src/"]);
      });
    });
  });

  describe("the code owners popover", () => {
    const popovers = () => [...document.querySelectorAll<HTMLElement>(".gh-prism-owners")];
    const dialogs = () => [
      ...document.querySelectorAll<HTMLDialogElement>(".gh-prism-owners-dialog"),
    ];
    const dialogTitle = (dialog: HTMLDialogElement | undefined) =>
      document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")?.textContent;
    /** Focuses `shield`, which opens its popover at once. */
    const focusOpen = async (shield: HTMLElement) => {
      shield.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
      await vi.advanceTimersByTimeAsync(0);
    };

    it("lists every owner, linking teams and users in a new tab", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team", "@someone", "dev@example.com"] }));

      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      const [popover] = popovers();
      expect(popovers()).toHaveLength(1);
      expect(view()?.contains(popover ?? null)).toBe(true);
      expect([...(popover?.querySelectorAll("li") ?? [])].map((item) => item.textContent)).toEqual([
        "@o/team",
        "@someone",
        "dev@example.com",
      ]);
      const links = [...(popover?.querySelectorAll("a") ?? [])];
      expect(links.map((link) => [link.href, link.target, link.rel])).toEqual([
        ["https://github.com/orgs/o/teams/team", "_blank", "noopener noreferrer"],
        ["https://github.com/someone", "_blank", "noopener noreferrer"],
      ]);
    });

    it("shows an owner's token as text, never markup", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/<img src=x>"] }));

      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      expect(popovers()[0]?.querySelector("li")?.textContent).toBe("@o/<img src=x>");
      expect(popovers()[0]?.querySelector("img")).toBeNull();
    });

    it("opens without revealing, selecting, or jumping to the file", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      const hash = location.hash;
      const reveal = vi.spyOn(nativeLink("src/engine.rs"), "click");

      await focusOpen(shieldOf("implementation", "src/engine.rs"));
      await afterDebounce();

      expect(reveal).not.toHaveBeenCalled();
      expect(rowIn("implementation", "src/engine.rs").getAttribute("aria-selected")).not.toBe(
        "true",
      );
      expect(location.hash).toBe(hash);
    });

    it("marks its shield expanded until it closes", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      const engine = shieldOf("implementation", "src/engine.rs");

      await focusOpen(engine);
      expect(engine.getAttribute("aria-expanded")).toBe("true");

      popovers()[0]?.hidePopover();
      expect(popovers()).toEqual([]);
      expect(engine.hasAttribute("aria-expanded")).toBe(false);
    });

    it("hints that a click on its shield opens more", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));

      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      expect(popovers()[0]?.querySelector(".gh-prism-owners-hint")?.textContent).toBeTruthy();
    });

    it("closes, clearing its shield, when the view moves into the overlay", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      const engine = shieldOf("implementation", "src/engine.rs");
      await focusOpen(engine);

      openOverlay();
      await afterDebounce();

      expect(popovers()).toEqual([]);
      expect(engine.hasAttribute("aria-expanded")).toBe(false);
    });

    it("closes on a scroll outside it", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      document.dispatchEvent(new Event("scroll"));

      expect(popovers()).toEqual([]);
    });

    it("returns focus inside it to the file's row as a scroll outside it closes it", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));
      popovers()[0]?.querySelector("a")?.focus();

      document.dispatchEvent(new Event("scroll"));

      expect(popovers()).toEqual([]);
      expect(hostOf("implementation").shadowRoot?.activeElement).toBe(
        rowIn("implementation", "src/engine.rs"),
      );
    });

    it("stays open on a scroll inside it", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      popovers()[0]?.dispatchEvent(new Event("scroll"));

      expect(popovers()).toHaveLength(1);
    });

    it("stops listening for scrolls once closed", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));
      popovers()[0]?.hidePopover();
      const hide = vi.spyOn(HTMLElement.prototype, "hidePopover");

      document.dispatchEvent(new Event("scroll"));

      expect(hide).not.toHaveBeenCalled();
      hide.mockRestore();
    });

    it("closes on Escape and returns focus to the file's row", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));
      const [popover] = popovers();
      if (!popover) throw new Error("no popover");

      press(popover, "Escape");

      expect(popovers()).toEqual([]);
      expect(hostOf("implementation").shadowRoot?.activeElement).toBe(
        rowIn("implementation", "src/engine.rs"),
      );
    });

    describe("on hover and focus", () => {
      const engine = () => shieldOf("implementation", "src/engine.rs");
      const pointerAt = (type: "pointerover" | "pointerout", target: Element, related: Element) =>
        target.dispatchEvent(
          new PointerEvent(type, { bubbles: true, composed: true, relatedTarget: related }),
        );
      const focusIn = () => document.activeElement;

      it("opens once the pointer rests on the shield, leaving focus where it was", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
        const focused = focusIn();

        pointerAt("pointerover", engine(), rowIn("implementation", "src/engine.rs"));
        await vi.advanceTimersByTimeAsync(199);
        const beforeDelay = popovers().length;
        await vi.advanceTimersByTimeAsync(1);

        expect(beforeDelay).toBe(0);
        expect(popovers()).toHaveLength(1);
        expect(engine().getAttribute("aria-expanded")).toBe("true");
        expect(focusIn()).toBe(focused);
      });

      it("opens at once when the shield takes focus", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));

        engine().dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
        await vi.advanceTimersByTimeAsync(0);

        expect(popovers()).toHaveLength(1);
      });

      it("closes once the pointer has left shield and popover", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
        pointerAt("pointerover", engine(), rowIn("implementation", "src/engine.rs"));
        await vi.advanceTimersByTimeAsync(200);
        const openBeforeLeaving = popovers().length;

        pointerAt("pointerout", engine(), rowIn("implementation", "src/engine.rs"));
        await vi.advanceTimersByTimeAsync(150);

        expect(openBeforeLeaving).toBe(1);
        expect(popovers()).toEqual([]);
        expect(engine().hasAttribute("aria-expanded")).toBe(false);
      });

      it("gives way to the details dialog when its shield is clicked", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
        pointerAt("pointerover", engine(), rowIn("implementation", "src/engine.rs"));
        await vi.advanceTimersByTimeAsync(200);
        const hoverOpened = popovers().length;

        clickAt(engine(), { detail: 1 });

        expect(hoverOpened).toBe(1);
        expect(popovers()).toEqual([]);
        expect(dialogs()).toHaveLength(1);
      });

      it("closes on Escape", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
        pointerAt("pointerover", engine(), rowIn("implementation", "src/engine.rs"));
        await vi.advanceTimersByTimeAsync(200);
        const openBeforeEscape = popovers().length;

        press(engine(), "Escape");

        expect(openBeforeEscape).toBe(1);
        expect(popovers()).toEqual([]);
      });
    });

    describe("a folder's popover", () => {
      const owned = () =>
        landedOwned(
          tokensOf({
            "src/engine.rs": ["@o/team"],
            "src/generated/schema.rs": ["@o/other"],
            "src/lib.rs": [],
          }),
        );
      const src = () => shieldOf("implementation", "src/");
      const LISTED_UNDER_SRC = [
        "generated/",
        "  schema.rs@o/other",
        "engine.rs@o/team",
        "helpers.rs",
        "lib.rs",
        "notes.rs",
        "parser.rs",
        "render.rs",
      ];

      it("lists every file the section shows under the folder, with its owners", async () => {
        await owned();

        await focusOpen(src());

        const [popover] = popovers();
        expect(popovers()).toHaveLength(1);
        expect(popover?.querySelector(".gh-prism-owners-hint")?.textContent).toBeTruthy();
        expect(popover?.getAttribute("aria-label")).toBe("Code owners of files in src");
        expect(outline(popover?.querySelector("ul"))).toEqual(LISTED_UNDER_SRC);
        const links = [...(popover?.querySelectorAll("a") ?? [])];
        expect(links.map((link) => [link.href, link.target, link.rel])).toEqual([
          ["https://github.com/orgs/o/teams/other", "_blank", "noopener noreferrer"],
          ["https://github.com/orgs/o/teams/team", "_blank", "noopener noreferrer"],
        ]);
      });

      it("shows paths and tokens as text, never markup", async () => {
        addNativeFile("src/<img src=x>.rs", "src/engine.rs");
        await landedOwned(tokensOf({ "src/<img src=x>.rs": ["@o/<b>x</b>"] }));

        await focusOpen(src());

        expect(outline(popovers()[0]?.querySelector("ul"))).toContain("<img src=x>.rs@o/<b>x</b>");
        expect(popovers()[0]?.querySelector("img, b")).toBeNull();
      });

      it("lists a flattened chain's files relative to its deepest folder", async () => {
        addNativeFile("a/b/c/file.rs", "src/engine.rs");
        await landedOwned(ownersOf(["a/b/c/file.rs"]));

        await focusOpen(shieldOf("implementation", "a/b/c/"));

        expect(outline(popovers()[0]?.querySelector("ul"))).toEqual(["file.rs@o/team"]);
      });

      it("opens its details without toggling, selecting, or revealing its folder", async () => {
        await owned();
        const hash = location.hash;
        const selected = () =>
          rowsIn("implementation")
            .filter((row) => row.getAttribute("aria-selected") === "true")
            .map((row) => row.dataset.itemPath);
        const before = selected();
        const expanded = rowIn("implementation", "src/").getAttribute("aria-expanded");

        clickAt(src());
        press(src(), "Enter");
        press(src(), " ");
        await afterDebounce();

        expect(rowIn("implementation", "src/").getAttribute("aria-expanded")).toBe(expanded);
        expect(selected()).toEqual(before);
        expect(location.hash).toBe(hash);
      });

      it("opens once the pointer rests on its shield and closes once it leaves", async () => {
        await owned();
        const over = (type: "pointerover" | "pointerout") =>
          src().dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              relatedTarget: rowIn("implementation", "src/"),
            }),
          );

        over("pointerover");
        await vi.advanceTimersByTimeAsync(199);
        const beforeDelay = popovers().length;
        await vi.advanceTimersByTimeAsync(1);
        const opened = popovers().length;
        over("pointerout");
        await vi.advanceTimersByTimeAsync(150);

        expect([beforeDelay, opened]).toEqual([0, 1]);
        expect(popovers()).toEqual([]);
      });

      it("opens at once when its shield takes focus", async () => {
        await owned();

        src().dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
        await vi.advanceTimersByTimeAsync(0);

        expect(popovers()).toHaveLength(1);
      });

      it("opens a dialog of its files, relative to it, with their owners, on a click", async () => {
        await owned();

        clickAt(src(), { detail: 1 });

        const [dialog] = dialogs();
        expect(dialogs()).toHaveLength(1);
        expect(dialogTitle(dialog)).toBe("Code owners of files in src");
        expect(outline(dialog?.querySelector("ul"))).toEqual(LISTED_UNDER_SRC);
        expect(popovers()).toEqual([]);
      });

      it("closes a file's popover as it opens, and the reverse", async () => {
        await owned();

        await focusOpen(shieldOf("implementation", "src/engine.rs"));
        await focusOpen(src());
        const afterFolder = popovers().map((popover) => popover.getAttribute("aria-label"));
        await focusOpen(shieldOf("implementation", "src/engine.rs"));

        expect(afterFolder).toEqual(["Code owners of files in src"]);
        expect(popovers().map((popover) => popover.getAttribute("aria-label"))).toEqual([
          "Code owners of engine.rs",
        ]);
      });
    });

    it("goes when its page does", async () => {
      await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
      await focusOpen(shieldOf("implementation", "src/engine.rs"));

      abort();

      expect(popovers()).toEqual([]);
    });

    describe("a file's details dialog", () => {
      const engine = () => shieldOf("implementation", "src/engine.rs");

      it("opens on a click of its shield, listing the file's owners", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team", "@someone"] }));
        await focusOpen(engine());

        clickAt(engine(), { detail: 1 });

        const [dialog] = dialogs();
        expect(dialogs()).toHaveLength(1);
        expect(dialog?.open).toBe(true);
        expect(dialogTitle(dialog)).toBe("Code owners of engine.rs");
        expect(
          [...(dialog?.querySelector("ul")?.querySelectorAll("li") ?? [])].map(
            (item) => item.textContent,
          ),
        ).toEqual(["@o/team", "@someone"]);
        expect(popovers()).toEqual([]);
      });

      it.each(["Enter", " "] as const)("opens on %j on its shield", async (key) => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));

        press(engine(), key);

        expect(dialogs().map(dialogTitle)).toEqual(["Code owners of engine.rs"]);
      });

      it("excerpts each owning team's members, linking the rest", async () => {
        const members = JSON.parse(large);
        remountWith(() => Promise.resolve(landedWith()), undefined, {
          codeOwners: Promise.resolve(tokensOf({ "src/engine.rs": ["@o/team", "@octocat"] })),
          teamMembers: async (team) => (team === "@o/team" ? members : undefined),
        });
        await afterDebounce();

        clickAt(engine(), { detail: 1 });
        await vi.advanceTimersByTimeAsync(0);

        const links = [...(dialogs()[0]?.querySelectorAll("a") ?? [])].map((a) => a.textContent);
        expect(links.filter((text) => text?.startsWith("@member-"))).toHaveLength(15);
        expect(links).toContain("See all 214 members");
        expect(dialogs()[0]?.querySelectorAll("section")).toHaveLength(1);
      });

      it("moves focus to the file's row before opening, and back to it on close", async () => {
        await landedOwned(tokensOf({ "src/engine.rs": ["@o/team"] }));
        const row = rowIn("implementation", "src/engine.rs");
        let focusedOnOpen: Element | null | undefined;
        const showModal = vi
          .spyOn(HTMLDialogElement.prototype, "showModal")
          .mockImplementation(function (this: HTMLDialogElement) {
            focusedOnOpen = hostOf("implementation").shadowRoot?.activeElement;
            this.setAttribute("open", "");
          });
        clickAt(engine(), { detail: 1 });
        showModal.mockRestore();
        row.blur();

        dialogs()[0]?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

        expect(focusedOnOpen).toBe(row);
        expect(dialogs()).toEqual([]);
        expect(hostOf("implementation").shadowRoot?.activeElement).toBe(row);
        expect(popovers()).toEqual([]);
      });
    });
  });
});
