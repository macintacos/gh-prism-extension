// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { codeOwnerOf, type FileOwners, type PrCodeOwners } from "../../../utils/github/code-owners";
import { byId } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  hostOf,
  patchShadowActiveElement,
  press,
  renderSplit,
  rowIn,
  withCommentLines,
} from "../../fixtures/sections-view";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  rowsIn,
  sectionKeys,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

patchShadowActiveElement();

const { remountWith } = mountsVisit();

/** A pull request whose `owned` paths each have `@o/team`, and whose `unowned` paths have none. */
const ownersOf = (owned: readonly string[], unowned: readonly string[] = []): PrCodeOwners => ({
  byPath: new Map<string, FileOwners>([
    ...owned.map(
      (path) => [path, { owners: [codeOwnerOf("@o/team")], ownedByViewer: false }] as const,
    ),
    ...unowned.map((path) => [path, { owners: [], ownedByViewer: false }] as const),
  ]),
  reviewers: [],
});

const shieldsIn = (listing: string) => [
  ...(hostOf(listing).shadowRoot?.querySelectorAll<HTMLElement>("[data-item-shield]") ?? []),
];
const shieldedIn = (listing: string) =>
  shieldsIn(listing).map((shield) => shield.dataset.itemShield);
const allShielded = () => sectionKeys().flatMap((section) => shieldedIn(section ?? ""));

/** Mounts a visit landing `result` whose code owners settle as `owners`, and lets both land. */
async function landedOwned(owners: PrCodeOwners | undefined, result = landedWith()): Promise<void> {
  remountWith(() => Promise.resolve(result), undefined, Promise.resolve(owners));
  await afterDebounce();
}

describe("showSections", () => {
  describe("the code owners shield", () => {
    it("gives an owned file's row one shield and an unowned file's none", async () => {
      await landedOwned(ownersOf(["src/engine.rs"], ["src/parser.rs"]));

      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
    });

    it("appears when ownership resolves after the sections land", async () => {
      let resolve: (owners: PrCodeOwners) => void = () => {};
      remountWith(undefined, undefined, new Promise((settle) => (resolve = settle)));
      await afterDebounce();
      expect(shieldedIn("implementation")).toEqual([]);

      resolve(ownersOf(["src/engine.rs"]));
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
    });

    it("appears when ownership resolves before the sections land", async () => {
      let land: () => void = () => {};
      const intent = new Promise<void>((settle) => (land = settle)).then(() => landedWith());
      remountWith(() => intent, undefined, Promise.resolve(ownersOf(["src/engine.rs"])));
      await afterDebounce();

      land();
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
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
      let resolve: (owners: PrCodeOwners) => void = () => {};
      remountWith(undefined, undefined, new Promise((settle) => (resolve = settle)));
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

      expect(shieldedIn("implementation")).toEqual(["src/render.rs"]);
      expect(shieldedIn("docs")).toEqual(["src/render.rs"]);
    });

    it("shields a file's comment-lines entry too", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]), withCommentLines());

      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
      expect(shieldedIn(COMMENT_LINES)).toEqual(["src/engine.rs"]);
    });

    it("appears in a section built after ownership landed", async () => {
      await landedOwned(ownersOf(["docs/intro.md"]));
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();

      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(shieldedIn("docs")).toEqual(["docs/intro.md"]);
    });

    it("lands without moving a file, a count, a folder, or the sidebar's scroll", async () => {
      const { FileTree } = await import("@pierre/trees");
      let resolve: (owners: PrCodeOwners) => void = () => {};
      remountWith(undefined, undefined, new Promise((settle) => (resolve = settle)));
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
      });
      const before = snapshot();
      const resetPaths = vi.spyOn(FileTree.prototype, "resetPaths");

      resolve(ownersOf(["src/engine.rs", "src/generated/schema.rs", "README.md"]));
      await afterDebounce();

      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
      expect(snapshot()).toEqual(before);
      expect(before.folder).toBe("false");
      expect(resetPaths).not.toHaveBeenCalled();
      resetPaths.mockRestore();
    });

    it("shields owned rows on a pull request that offers no Viewed boxes", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]));

      expect(hostOf("implementation").shadowRoot?.querySelector("[data-item-checkbox]")).toBeNull();
      expect(shieldedIn("implementation")).toEqual(["src/engine.rs"]);
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

    it("shows only the next pull request's owners after moving to it", async () => {
      await landedOwned(ownersOf(["src/engine.rs"]));

      await landedOwned(ownersOf(["src/parser.rs"]));

      expect(shieldedIn("implementation")).toEqual(["src/parser.rs"]);
    });
  });
});
