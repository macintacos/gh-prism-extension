// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { visitViewed } from "../../../entrypoints/content/diffs/viewed";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import css from "../../../entrypoints/content/sidebar/sections-view.css?raw";
import { showVisit } from "../../../entrypoints/content/visit/land";
import { byId } from "../../fixtures/files-page";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  commentLinesRoot,
  commentLinesToggle,
  countIn,
  filesOf,
  hostOf,
  partTexts,
  patchShadowActiveElement,
  press,
  rowIn,
  rowsOf,
  sectionToggle,
  viewed,
  withCommentLines,
} from "../../fixtures/sections-view";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  progressBar,
  rowsIn,
  sectionKeys,
  sheetsStyling,
  treeHost,
  view,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

// Spied so tests can reach the hooks of the sidebar showVisit mounted.
vi.mock(import("../../../entrypoints/content/sidebar/sections-view"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, showSections: vi.fn(original.showSections) };
});

patchShadowActiveElement();

const { remountWith, landed, abort } = mountsVisit();

describe("showSections", () => {
  it("lists the files in a tree per non-empty section, in section and native-tree order", () => {
    expect(sectionKeys().map((section) => [section, filesIn(section ?? "")])).toEqual([
      [
        "implementation",
        [
          "src/generated/schema.rs",
          "src/engine.rs",
          "src/helpers.rs",
          "src/lib.rs",
          "src/notes.rs",
          "src/parser.rs",
          "src/render.rs",
        ],
      ],
      ["tests", ["tests/integration.rs"]],
      ["docs", ["docs/guide.md", "README.md"]],
      ["config", ["config/app.toml", "Cargo.toml"]],
      ["generated", ["Cargo.lock"]],
    ]);
  });

  it("tints each section with its hue", () => {
    const hues = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map((section) => [
        section.dataset.section,
        section.style.getPropertyValue("--gh-prism-hue"),
      ]),
    );

    expect(hues).toEqual({
      implementation: "var(--fgColor-accent)",
      tests: "var(--fgColor-done)",
      docs: "var(--fgColor-attention)",
      config: "var(--fgColor-sponsors)",
      generated: "var(--fgColor-muted)",
    });
  });

  it("counts each section's files", () => {
    const counts = [...document.querySelectorAll(".gh-prism-section")].map(
      (section) => section.querySelector(".gh-prism-counter")?.textContent,
    );
    expect(counts).toEqual(["7", "1", "2", "2", "1"]);
  });

  it("flattens a directory chain that holds no files of its own into one row", async () => {
    await landed(landedWith(new Map([["src/generated/schema.rs", whole("tests")]])));
    expect(rowsIn("tests").map((row) => row.getAttribute("aria-label"))).toEqual([
      "src / generated",
      "schema.rs",
      "tests",
      "integration.rs",
    ]);
  });

  it("renders a flattened row's folders as whole units around a hidden ellipsis, and every row a full-name copy", async () => {
    const chain = "managed/dot_config/opencode/skills/sentry-cli";
    addNativeFile(`${chain}/SKILL.md`, "docs/guide.md");
    await afterDebounce();

    const folder = rowsIn("docs").find((row) => row.getAttribute("aria-label")?.includes(" / "));
    const file = rowIn("docs", `${chain}/SKILL.md`);
    const units = [...(folder?.querySelectorAll("[data-item-flattened-subitems] > *") ?? [])];
    const deepest = units.pop();
    expect(units.map((unit) => unit.textContent)).toEqual([
      "managed",
      "/…",
      "/dot_config",
      "/opencode",
      "/skills",
    ]);
    expect(units[1]?.matches("[data-item-flattened-ellipsis][aria-hidden=true]")).toBe(true);
    expect(deepest?.getAttribute("data-item-flattened-subitem")).toMatch(/sentry-cli\/?$/);
    expect(
      [...units.slice(2), deepest].every((unit) =>
        unit?.firstElementChild?.matches("[data-item-flattened-separator]"),
      ),
    ).toBe(true);
    expect(folder?.querySelector("[data-full-name][aria-hidden=true]")?.textContent).toBe(
      "managed/dot_config/opencode/skills/sentry-cli",
    );
    expect(folder?.getAttribute("aria-label")).toBe(
      "managed / dot_config / opencode / skills / sentry-cli",
    );
    expect(file.querySelector("[data-full-name]")?.textContent).toBe("SKILL.md");
    expect(file.getAttribute("aria-label")).toMatch(/^SKILL\.md/);
  });

  it("names each section by its header", () => {
    const sections = [...document.querySelectorAll(".gh-prism-section")];
    expect(sections).toHaveLength(5);

    for (const section of sections) {
      const header = section.querySelector("h3");
      expect(header).not.toBeNull();
      expect(document.getElementById(section.getAttribute("aria-labelledby") ?? "")).toBe(header);
    }

    expect(
      [...document.querySelectorAll(".gh-prism-section-label")].map(
        (label) => label.firstChild?.textContent,
      ),
    ).toEqual(["Implementation", "Tests", "Docs & Comments", "Config", "Generated / lockfiles"]);
  });

  it("sits just before the native tree", () => {
    expect(document.querySelector('ul[role="tree"]')?.previousElementSibling).toBe(view());
  });

  it("injects its stylesheet into the document head until aborted", () => {
    const stylesheet = () => document.head.querySelector("style");
    expect(stylesheet()?.textContent).toBe(css);
    abort();
    expect(stylesheet()).toBeNull();
  });

  it("keeps one view when the sidebar comes back holding a stale one", () => {
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    const fresh = new AbortController();
    showVisit(page, fresh.signal, {
      intent: () => landedWith(),
      diffstat: { choice: { view: "breakout" }, save: () => {} },
      viewed: visitViewed(undefined),
      teamMembers: async () => undefined,
    });
    expect(document.querySelectorAll(".gh-prism-sections")).toHaveLength(1);
    expect(document.querySelectorAll(".gh-prism-sections .gh-prism-mark")).toHaveLength(1);

    fresh.abort();
  });

  it("ends in one gh-prism mark", () => {
    expect(view()?.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
    expect(view()?.lastElementChild?.querySelector(".gh-prism-mark")).not.toBeNull();
  });

  it("adds a file that joins the native tree, with its status, to its section's tree", async () => {
    addNativeFile("docs/intro.md", "docs/guide.md");
    await afterDebounce();

    expect(filesIn("docs")).toEqual(["docs/guide.md", "docs/intro.md", "README.md"]);
    expect(rowIn("docs", "docs/intro.md").dataset.itemGitStatus).toBe("modified");
    expect(document.querySelector('[data-section="docs"] .gh-prism-counter')?.textContent).toBe(
      "3",
    );
  });

  it("puts a section that gains its first file in section order", async () => {
    byId("docs/guide.md").remove();
    byId("README.md").remove();
    await afterDebounce();
    addNativeFile("docs/intro.md", "config/app.toml");
    await afterDebounce();

    expect(sectionKeys()).toEqual(["implementation", "tests", "docs", "config", "generated"]);
  });

  it("drops a section, and clears its tree, once its last file leaves the native tree", async () => {
    const generated = treeHost("generated");
    byId("Cargo.lock").remove();
    await afterDebounce();

    expect(sectionKeys()).not.toContain("generated");
    expect(generated.shadowRoot?.querySelector('[data-type="item"]')).toBeNull();
  });

  it("sizes each tree to its visible rows, following a collapse", async () => {
    const heightOfRows = (section: string) => {
      const rows = rowsIn(section);
      return `${rows.length * Number.parseFloat(rows[0]?.style.minHeight ?? "")}px`;
    };
    expect(treeHost("implementation").style.height).toBe(heightOfRows("implementation"));

    clickAt(rowIn("implementation", "src/"));
    await afterDebounce();

    expect(rowsIn("implementation")).toHaveLength(1);
    expect(treeHost("implementation").style.height).toBe(heightOfRows("implementation"));
  });

  it("keeps a collapsed directory collapsed when its tree's files change", async () => {
    clickAt(rowIn("implementation", "src/generated/"));
    await afterDebounce();
    byId("src/notes.rs").remove();
    await afterDebounce();

    expect(rowIn("implementation", "src/generated/").getAttribute("aria-expanded")).toBe("false");
    expect(filesIn("implementation")).toEqual([
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/parser.rs",
      "src/render.rs",
    ]);
  });

  it("draws each directory as a folder", () => {
    const icon = rowIn("implementation", "src/").querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("implementation").shadowRoot?.querySelector(
      `symbol${icon?.getAttribute("href")}`,
    );
    expect(symbol?.id).toMatch(/folder/);
  });

  it("draws each file with its type's icon", async () => {
    addNativeFile("src/app.tsx", "src/lib.rs");
    await afterDebounce();

    const icon = rowIn("implementation", "src/app.tsx").querySelector(
      '[data-item-section="icon"] svg',
    );

    expect(icon?.getAttribute("data-icon-token")).toBe("react");
  });

  it("draws a manifest with its ecosystem's icon", () => {
    const use = rowIn("config", "Cargo.toml").querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("config").shadowRoot?.querySelector(
      `symbol${use?.getAttribute("href")}`,
    );

    expect(symbol?.id).toBe("file-tree-builtin-rust");
  });

  it("draws a Java file with gh-prism's Java icon", async () => {
    addNativeFile("src/Main.java", "src/lib.rs");
    await afterDebounce();

    const use = rowIn("implementation", "src/Main.java").querySelector(
      '[data-item-section="icon"] use',
    );
    const symbol = treeHost("implementation").shadowRoot?.querySelector(
      `symbol${use?.getAttribute("href")}`,
    );

    expect(symbol?.id).toBe("gh-prism-java");
  });

  it("draws a TOML file with gh-prism's TOML icon", () => {
    const use = rowIn("config", "config/app.toml").querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("config").shadowRoot?.querySelector(
      `symbol${use?.getAttribute("href")}`,
    );

    expect(symbol?.id).toBe("gh-prism-toml");
  });

  it.each([
    ["bunfig.toml", "file-tree-builtin-bun"],
    [".prettierrc.toml", "file-tree-builtin-prettier"],
  ])("draws %s with its tool's icon", async (path, icon) => {
    addNativeFile(path, "Cargo.toml");
    await afterDebounce();

    const use = rowIn("config", path).querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("config").shadowRoot?.querySelector(
      `symbol${use?.getAttribute("href")}`,
    );

    expect(symbol?.id).toBe(icon);
  });

  describe("a section's header", () => {
    const expanded = (section: string) => sectionToggle(section).getAttribute("aria-expanded");

    it("hides and shows its section's tree when clicked", () => {
      expect(expanded("docs")).toBe("true");
      expect(filesOf("docs").contains(treeHost("docs"))).toBe(true);

      sectionToggle("docs").click();

      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);

      sectionToggle("docs").click();

      expect(expanded("docs")).toBe("true");
      expect(filesOf("docs").inert).toBe(false);
    });

    it("starts the Generated section collapsed and the rest expanded", () => {
      expect(expanded("generated")).toBe("false");
      expect(filesOf("generated").inert).toBe(true);
      expect(expanded("implementation")).toBe("true");

      sectionToggle("generated").click();

      expect(expanded("generated")).toBe("true");
    });

    it.each(["Enter", " "] as const)("toggles its section, keeping focus, on %j", (key) => {
      const toggle = sectionToggle("tests");
      toggle.focus();
      press(toggle, key);

      expect(expanded("tests")).toBe("false");
      expect(document.activeElement).toBe(toggle);
    });

    it("keeps its section collapsed while the native tree changes", async () => {
      sectionToggle("docs").click();
      addNativeFile("docs/intro.md", "docs/guide.md");
      await afterDebounce();

      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);
      expect(filesIn("docs")).toContain("docs/intro.md");
    });

    it("keeps a collapsed section collapsed when it empties and comes back", async () => {
      sectionToggle("docs").click();
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);
    });

    it("collapses and expands its section without rebuilding the tree", async () => {
      const { FileTree } = await import("@pierre/trees");
      const render = vi.spyOn(FileTree.prototype, "render");
      const resetPaths = vi.spyOn(FileTree.prototype, "resetPaths");
      const cleanUp = vi.spyOn(FileTree.prototype, "cleanUp");
      const rows = rowsIn("implementation");
      sectionToggle("implementation").click();
      sectionToggle("implementation").click();
      await afterDebounce();

      expect(render).not.toHaveBeenCalled();
      expect(resetPaths).not.toHaveBeenCalled();
      expect(cleanUp).not.toHaveBeenCalled();
      expect(rowsIn("implementation")).toEqual(rows);

      render.mockRestore();
      resetPaths.mockRestore();
      cleanUp.mockRestore();
    });
  });

  it("renders file names as text", async () => {
    const path = "docs/<img src=x onerror=alert(1)>.md";
    addNativeFile(path, "docs/guide.md");
    await afterDebounce();

    expect(treeHost("docs").shadowRoot?.querySelector("img")).toBeNull();
    expect(rowIn("docs", path).getAttribute("aria-label")).toBe("<img src=x onerror=alert(1)>.md");
  });

  it("removes itself, clears its trees, and stops rendering once aborted", async () => {
    const implementation = treeHost("implementation");
    abort();

    expect(view()).toBeNull();
    expect(implementation.shadowRoot?.querySelector('[data-type="item"]')).toBeNull();

    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();

    expect(view()).toBeNull();
  });

  it.each([
    ["octicon-file-added", "added"],
    ["octicon-file-removed", "deleted"],
    ["octicon-file-moved", "renamed"],
    ["octicon-file-diff", "modified"],
  ])("marks a file whose native icon is %s as %s", (octicon, status) => {
    byId("src/parser.rs").querySelector("svg.octicon")?.setAttribute("class", `octicon ${octicon}`);
    remountWith();

    expect(rowIn("implementation", "src/parser.rs").dataset.itemGitStatus).toBe(status);
  });

  describe("the comment-lines sub-section", () => {
    beforeEach(async () => {
      await landed(withCommentLines());
    });

    const expanded = () => commentLinesToggle().getAttribute("aria-expanded");
    const filesUnder = () => {
      const files = document.getElementById(
        commentLinesToggle().getAttribute("aria-controls") ?? "",
      );
      if (!files) throw new Error("the comment-lines header button controls nothing");
      return files;
    };
    const fileRows = () =>
      rowsOf(COMMENT_LINES)
        .filter((row) => row.dataset.itemType === "file")
        .map((row) => row.dataset.itemPath);

    it("starts collapsed, at the end of Docs & Comments", () => {
      expect(expanded()).toBe("false");
      expect(filesUnder().inert).toBe(true);
      expect(filesOf("docs").lastElementChild).toBe(commentLinesRoot());
    });

    it("shows and hides its files when its header is clicked", () => {
      commentLinesToggle().click();

      expect(expanded()).toBe("true");
      expect(filesUnder().inert).toBe(false);
      expect(filesUnder().contains(hostOf(COMMENT_LINES))).toBe(true);

      commentLinesToggle().click();

      expect(expanded()).toBe("false");
      expect(filesUnder().inert).toBe(true);
    });

    it("is hidden while Docs & Comments is collapsed", () => {
      commentLinesToggle().click();
      sectionToggle("docs").click();

      expect(commentLinesRoot()?.closest("[inert]")).toBe(filesOf("docs"));
    });

    it("heads its files with their count and the comment lines they add and remove", () => {
      expect(countIn(commentLinesToggle())).toBe("2");
      expect(
        commentLinesToggle().querySelector(".gh-prism-line-totals .sr-only")?.textContent,
      ).toBe("5 added, 1 removed");
    });

    it("lists each file with its comment lines, marked Partial", () => {
      commentLinesToggle().click();

      expect(fileRows()).toEqual(["src/engine.rs", "src/parser.rs"]);
      expect(partTexts(COMMENT_LINES, "src/engine.rs")).toEqual(["1", "Partial", "+3", "−1"]);
      expect(partTexts(COMMENT_LINES, "src/parser.rs")).toEqual(["Partial", "+2", "−0"]);
    });

    it("counts its viewed files in its header once any file is Viewed", () => {
      viewed("src/engine.rs");

      expect(countIn(commentLinesToggle())).toBe("1/2");
    });

    it("leaves its files out of Docs & Comments' own counts", () => {
      expect(countIn(sectionToggle("docs"))).toBe("2");

      viewed("src/engine.rs");

      expect(countIn(sectionToggle("docs"))).toBe("0/2");
    });

    it("is all a Docs & Comments with no files of its own lists", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await landed(withCommentLines());

      expect(filesIn("docs")).toEqual([]);
      expect(countIn(commentLinesToggle())).toBe("2");
    });

    it("isn't shown when no file has comment lines", async () => {
      await landed(landedWith(new Map(), new Map([["src/engine.rs", { added: 9, removed: 3 }]])));

      expect(sectionKeys()).toContain("docs");
      expect(commentLinesRoot()).toBeNull();
    });
  });

  describe("while intent is pending", () => {
    it("shows a busy, indeterminate progress bar and no sections", () => {
      remountWith(pendingIntent().intent);
      expect(view()?.getAttribute("aria-busy")).toBe("true");
      expect(progressBar()?.hasAttribute("aria-valuenow")).toBe(false);
      expect(sectionKeys()).toEqual([]);
    });

    it("keeps its gh-prism mark below the progress bar", () => {
      remountWith(pendingIntent().intent);
      expect(view()?.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
      expect(view()?.lastElementChild?.querySelector(".gh-prism-mark")).not.toBeNull();
    });

    it("carries the progress bar's stylesheet in the bar itself", () => {
      remountWith(pendingIntent().intent);
      expect(
        sheetsStyling("gh-prism-spectrum").some((sheet) => progressBar()?.contains(sheet)),
      ).toBe(true);
    });

    it("bands the spectrum with every section's hue, in section order", () => {
      remountWith(pendingIntent().intent);
      const spectrum = view()?.querySelector<HTMLElement>(".gh-prism-spectrum");
      expect(spectrum?.style.getPropertyValue("--gh-prism-spectrum")).toBe(
        "linear-gradient(90deg, var(--fgColor-accent) 0% 20%, var(--fgColor-done) 20% 40%, var(--fgColor-attention) 40% 60%, var(--fgColor-sponsors) 60% 80%, var(--fgColor-muted) 80% 100%)",
      );
    });

    it("reports how many of the diff's files intent has checked", () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.progress({ checked: 3, total: 13 });

      expect(progressBar()?.getAttribute("aria-valuenow")).toBe("3");
      expect(progressBar()?.getAttribute("aria-valuemax")).toBe("13");
    });

    it("keeps loading through changes to the native tree", async () => {
      remountWith(pendingIntent().intent);
      byId("src/lib.rs").removeAttribute("aria-current");
      await afterDebounce();

      expect(progressBar()).not.toBeNull();
      expect(sectionKeys()).toEqual([]);
    });

    it("reveals the sections, intent's moves included, once it settles", async () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.resolve(
        landedWith(
          new Map([
            ["src/parser.rs", whole("docs")],
            ["src/notes.rs", whole("docs")],
          ]),
        ),
      );
      await afterDebounce();

      expect(view()?.hasAttribute("aria-busy")).toBe(false);
      expect(progressBar()).toBeNull();
      expect(view()?.hasAttribute("data-reveal")).toBe(true);
      expect(filesIn("docs")).toEqual([
        "docs/guide.md",
        "src/notes.rs",
        "src/parser.rs",
        "README.md",
      ]);
      expect(filesIn("implementation")).not.toContain("src/parser.rs");
      expect(document.querySelector(".gh-prism-notice")).toBeNull();
    });

    it.each([
      {
        problem: "commit-filtered",
        copy: "Grouped by path. Docstring-only and inline-test changes are detected when viewing all commits.",
      },
      {
        problem: "no-access",
        copy: "Grouped by path. Sign in to GitHub to detect docstring-only and inline-test changes.",
      },
    ] as const)(
      "reveals path sections under a notice when the intent is $problem",
      async ({ problem, copy }) => {
        const pending = pendingIntent();
        remountWith(pending.intent);
        pending.resolve({ ok: false, problem });
        await afterDebounce();

        expect(filesIn("implementation")).toContain("src/parser.rs");
        expect(view()?.firstElementChild?.classList.contains("gh-prism-notice")).toBe(true);
        expect(view()?.firstElementChild?.textContent).toBe(copy);
      },
    );

    it("reveals path sections under a notice when intent rejects, and logs why", async () => {
      const failure = new Error("intent broke");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      remountWith(() => Promise.reject(failure));
      await afterDebounce();

      expect(view()?.hasAttribute("aria-busy")).toBe(false);
      expect(filesIn("implementation")).toContain("src/parser.rs");
      expect(view()?.firstElementChild?.classList.contains("gh-prism-notice")).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);

      consoleError.mockRestore();
    });

    it("builds nothing when the intent settles after abort", async () => {
      const { FileTree } = await import("@pierre/trees");
      const render = vi.spyOn(FileTree.prototype, "render");
      const pending = pendingIntent();
      remountWith(pending.intent);
      abort();
      pending.resolve(landedWith(new Map([["src/parser.rs", whole("docs")]])));
      await afterDebounce();

      expect(view()).toBeNull();
      expect(render).not.toHaveBeenCalled();

      render.mockRestore();
    });
  });

  describe("under a what's-new block", () => {
    /** Mounts on a pending intent, prepends a stand-in block, and returns the block and intent. */
    const mountUnderBlock = () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      const block = document.createElement("section");
      block.className = "gh-prism-whats-new";
      view()?.prepend(block);
      return { block, pending };
    };
    const childClasses = () => [...(view()?.children ?? [])].map((child) => child.classList[0]);

    it("keeps the block first, then the notice, the sections, and the mark", async () => {
      const { pending } = mountUnderBlock();
      pending.resolve({ ok: false, problem: "no-access" });
      await afterDebounce();

      expect(childClasses()).toEqual([
        "gh-prism-whats-new",
        "gh-prism-notice",
        ...sectionKeys().map(() => "gh-prism-section"),
        "gh-prism-sections-mark",
      ]);
    });

    it("keeps the block first above the sections when there is no notice", async () => {
      const { pending } = mountUnderBlock();
      pending.resolve(landedWith());
      await afterDebounce();

      expect(view()?.firstElementChild?.classList.contains("gh-prism-whats-new")).toBe(true);
      expect(sectionKeys()).toEqual(["implementation", "tests", "docs", "config", "generated"]);
      expect(countIn(sectionToggle("docs"))).toBe("2");
    });

    it("leaves the notice first when the block is gone before landing", async () => {
      const { block, pending } = mountUnderBlock();

      block.remove();
      pending.resolve({ ok: false, problem: "no-access" });
      await afterDebounce();

      expect(view()?.firstElementChild?.classList.contains("gh-prism-notice")).toBe(true);
    });
  });

  it("renders at once, without a reveal, when there is no intent to wait for", () => {
    expect(view()?.hasAttribute("aria-busy")).toBe(false);
    expect(view()?.hasAttribute("data-reveal")).toBe(false);
    expect(progressBar()).toBeNull();
    expect(sectionKeys()).toHaveLength(5);
  });
});
