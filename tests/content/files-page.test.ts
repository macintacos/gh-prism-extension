// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesPage, FilterMenu, NativeTree } from "../../entrypoints/content/files-page";
import {
  appendToDiffs,
  commitPage,
  copyMenuGroup,
  copyMenuItem,
  coveredTop,
  diffEntryOf,
  findClassicPage,
  findCommitColumnRow,
  findCommitHeader,
  findCommitMessage,
  findDiff,
  findDiffList,
  findDiffstat,
  findFilesPage,
  findFilesToolbar,
  findFilterMenu,
  findFilterOptions,
  findHeaderPage,
  findOverlay,
  findTreeToggle,
  followFilterMenu,
  followOverlay,
  headerOf,
  isPublicRepo,
  isSignedIn,
  mountedDiffs,
  observeDiffs,
  observeTree,
  observeViewed,
  prPage,
  readChangedFiles,
  readViewed,
  reorderable,
  reviewerShieldOf,
  shieldOwner,
  showsViewed,
  treeToggleButtonOf,
  viewedOffered,
  viewedToggleOf,
  viewerLogin,
} from "../../entrypoints/content/files-page";
import conversationFixture from "../fixtures/conversation-page.html?raw";
import {
  addOwnedByGroup,
  byId,
  COMMIT_MESSAGES,
  closeFilterMenu,
  closeOverlay,
  diffList,
  foundPage,
  LAUNCHER_DIFF,
  linkTo,
  loadClassicFixture,
  loadCommitFixture,
  loadFixture,
  loadHeaderFixture,
  loadViewedCommitFilterFixture,
  loadViewedFixture,
  openFilterMenu,
  openOverlay,
  VIEWED_APP_TOML,
  VIEWED_CARGO_LOCK,
  VIEWED_LIB_RS,
} from "../fixtures/files-page";

const PATHS = [
  "config/app.toml",
  "docs/guide.md",
  "src/generated/schema.rs",
  "src/engine.rs",
  "src/helpers.rs",
  "src/lib.rs",
  "src/notes.rs",
  "src/parser.rs",
  "src/render.rs",
  "tests/integration.rs",
  "Cargo.lock",
  "Cargo.toml",
  "README.md",
];

const ENGINE_DIFF = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";

beforeEach(() => {
  loadFixture();
});

describe("findFilesPage", () => {
  it("finds the sidebar, tree, and diff list", () => {
    expect(findFilesPage(document)).toEqual({
      kind: prPage,
      sidebar: byId("pr-file-tree"),
      tree: document.querySelector('ul[role="tree"]'),
      diffs: document.querySelector('[data-testid="diff-content"]'),
    });
  });

  it.each([
    ["the tree", 'ul[role="tree"]'],
    ["the diff list", '[data-testid="diff-content"]'],
  ])("is undefined without %s", (_, selector) => {
    document.querySelector(selector)?.remove();
    expect(findFilesPage(document)).toBeUndefined();
  });

  it("is undefined for classic markup", () => {
    loadClassicFixture("");
    expect(findFilesPage(document)).toBeUndefined();
  });

  it("finds the docked sidebar while the overlay is open", () => {
    const docked = byId("pr-file-tree");
    openOverlay();
    expect(findFilesPage(document)?.sidebar).toBe(docked);
  });
});

describe("findOverlay", () => {
  it("finds the overlay's sidebar and tree while it is open", () => {
    const sidebar = openOverlay();
    expect(findOverlay(foundPage())).toEqual({
      sidebar,
      tree: sidebar.querySelector('ul[role="tree"]'),
    });
  });

  it("is undefined while the overlay is closed", () => {
    expect(findOverlay(foundPage())).toBeUndefined();
  });

  it("is undefined while the overlay's tree has not mounted", () => {
    openOverlay().querySelector('ul[role="tree"]')?.remove();
    expect(findOverlay(foundPage())).toBeUndefined();
  });

  it("is undefined on a commit page", () => {
    loadCommitFixture();
    expect(findOverlay(foundPage())).toBeUndefined();
  });
});

describe("followOverlay", () => {
  let controller: AbortController;
  const onOpen = vi.fn<(overlay: NativeTree, closed: AbortSignal) => void>();

  beforeEach(() => {
    controller = new AbortController();
    onOpen.mockReset();
  });

  afterEach(() => controller.abort());

  // MutationObserver callbacks are microtasks.
  const flush = () => Promise.resolve();
  const follow = () => followOverlay(foundPage(), onOpen, { signal: controller.signal });
  const closedOf = (call: number): AbortSignal => {
    const signal = onOpen.mock.calls[call]?.[1];
    if (!signal) throw new Error(`no call ${call}`);
    return signal;
  };

  it("reports an overlay as it opens", async () => {
    follow();
    const sidebar = openOverlay();
    await flush();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(
      { sidebar, tree: sidebar.querySelector('ul[role="tree"]') },
      expect.any(AbortSignal),
    );
  });

  it("reports an overlay already open", () => {
    const sidebar = openOverlay();
    follow();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0]?.[0].sidebar).toBe(sidebar);
  });

  it("stops reporting once its signal aborts", async () => {
    follow();
    controller.abort();
    openOverlay();
    await flush();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("reports again, closing the last, when the overlay's tree is replaced", async () => {
    const sidebar = openOverlay();
    follow();
    const tree = sidebar.querySelector('ul[role="tree"]');
    const replacement = tree?.cloneNode(true);
    if (!tree || !(replacement instanceof Element)) throw new Error("overlay has no tree");
    tree.replaceWith(replacement);
    await flush();
    expect(closedOf(0).aborted).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls[1]?.[0].tree).toBe(replacement);
  });

  it("aborts closed once the overlay closes", async () => {
    openOverlay();
    follow();
    closeOverlay();
    await flush();
    expect(closedOf(0).aborted).toBe(true);
  });

  it("aborts closed once its signal aborts", () => {
    openOverlay();
    follow();
    controller.abort();
    expect(closedOf(0).aborted).toBe(true);
  });

  it.each([
    ["without the tree's sidebar", "#pr-file-tree"],
    ["without its tree", 'ul[role="tree"]'],
  ])("never reports a dialog %s", async (_, missing) => {
    follow();
    openOverlay().closest('[role="dialog"]')?.querySelector(missing)?.remove();
    await flush();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("never reports on a commit page", async () => {
    loadCommitFixture();
    follow();
    document.body.prepend(document.createElement("div"));
    await flush();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("findClassicPage", () => {
  it("finds the classic page's toolbar and its review tools", () => {
    loadClassicFixture("");

    expect(findClassicPage(document)).toEqual({
      toolbar: document.querySelector(".pr-toolbar"),
      reviewTools: document.querySelector(".pr-review-tools"),
    });
  });

  it.each([
    ["the new Files changed page", loadFixture],
    ["a commit page", loadCommitFixture],
  ])("is undefined on %s", (_, load) => {
    load();
    expect(findClassicPage(document)).toBeUndefined();
  });
});

describe("isSignedIn", () => {
  it.each([
    { login: "", signedIn: false },
    { login: "octocat", signedIn: true },
  ])("is $signedIn when GitHub names the viewer '$login'", ({ login, signedIn }) => {
    loadClassicFixture(login);
    expect(isSignedIn(document)).toBe(signedIn);
  });
});

describe("viewerLogin", () => {
  it.each([
    { login: "", expected: undefined },
    { login: "octocat", expected: "octocat" },
  ])("is $expected when GitHub names the viewer '$login'", ({ login, expected }) => {
    loadClassicFixture(login);
    expect(viewerLogin(document)).toBe(expected);
  });
});

describe("reviewerShieldOf", () => {
  beforeEach(() => {
    document.body.innerHTML = conversationFixture;
  });

  it("finds each code-owner shield in the Reviewers sidebar, and no other sidebar button", () => {
    const buttons = document.querySelectorAll("#partial-discussion-sidebar button");
    const shields = [...buttons].map(reviewerShieldOf).filter((shield) => shield !== null);
    expect(shields.map(shieldOwner)).toEqual([
      "@excessive-dev/frontend",
      "@excessive-dev/platform",
    ]);
  });
});

describe("findFilterMenu", () => {
  const ownedItem = (list: Element) =>
    list.querySelector('[role="menuitemradio"][aria-keyshortcuts="o"]');

  it("finds the menu with GitHub's owned-by item when you own a file", () => {
    const list = openFilterMenu("owner");
    const item = ownedItem(list);
    const heading = list.querySelector('[data-component="GroupHeadingWrap"]');
    const group = heading?.closest('[data-component="ActionList.Group"]');

    expect(findFilterMenu(document)).toEqual({
      list,
      divider: list.querySelector('[data-component="ActionList.Divider"]'),
      ownedByYou: { item, group: item?.closest('[data-component="ActionList.Group"]') },
      headedGroup: { group, heading, items: group?.querySelector('ul[role="group"]') },
      item: list.querySelector('[data-component="ActionList.Item"]'),
    });
  });

  it("finds the menu without an owned-by item when you own no file", () => {
    const list = openFilterMenu("notOwner");

    const menu = findFilterMenu(document);

    expect(menu?.list).toBe(list);
    expect(menu?.ownedByYou).toBeUndefined();
  });

  it("is undefined with no menu open", () => {
    expect(findFilterMenu(document)).toBeUndefined();
  });

  it("is undefined when the menu belongs to no filter-row button", () => {
    openFilterMenu("owner").setAttribute("aria-labelledby", "elsewhere");

    expect(findFilterMenu(document)).toBeUndefined();
  });

  it("is undefined when the owned-by group holds another item", () => {
    const item = ownedItem(openFilterMenu("owner"));
    item?.after(document.createElement("li"));
    item?.nextElementSibling?.setAttribute("role", "menuitemcheckbox");

    expect(findFilterMenu(document)).toBeUndefined();
  });

  it.each([
    ["divider", '[data-component="ActionList.Divider"]'],
    ["heading", '[data-component="GroupHeadingWrap"]'],
    ["headed group's list", '[data-component="GroupHeadingWrap"] + ul[role="group"]'],
    ["checkmark", '[data-component="ActionList.Selection"]'],
    ["label", '[data-component="ActionList.Item.Label"]'],
  ])("is undefined without a %s", (_, part) => {
    const list = openFilterMenu("owner");
    for (const el of list.querySelectorAll(part)) el.remove();

    expect(findFilterMenu(document)).toBeUndefined();
  });
});

describe("followFilterMenu", () => {
  let controller: AbortController;
  const onOpen = vi.fn<(menu: FilterMenu, closed: AbortSignal) => void>();

  beforeEach(() => {
    controller = new AbortController();
    onOpen.mockReset();
  });

  afterEach(() => controller.abort());

  const flush = () => Promise.resolve();
  const follow = () => followFilterMenu(document, onOpen, { signal: controller.signal });

  it("reports a menu already open", () => {
    const list = openFilterMenu("owner");

    follow();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0]?.[0].list).toBe(list);
  });

  it("reports a menu as it opens", async () => {
    follow();

    const list = openFilterMenu("notOwner");
    await flush();

    expect(onOpen.mock.calls[0]?.[0].list).toBe(list);
  });

  it("aborts closed once the menu closes", async () => {
    follow();
    openFilterMenu("owner");
    await flush();

    closeFilterMenu();
    await flush();

    expect(onOpen.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it("reports the menu again on reopen", async () => {
    follow();
    openFilterMenu("owner");
    await flush();

    closeFilterMenu();
    await flush();
    openFilterMenu("owner");
    await flush();

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("re-reports an open menu once GitHub's owned-by item appears in it", async () => {
    const list = openFilterMenu("notOwner");
    follow();

    addOwnedByGroup(list);
    await flush();

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls[0]?.[1].aborted).toBe(true);
    expect(onOpen.mock.calls[1]?.[0].ownedByYou).toBeDefined();
  });

  it("stops reporting once its signal aborts", async () => {
    follow();

    controller.abort();
    openFilterMenu("owner");
    await flush();

    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("copyMenuGroup and copyMenuItem", () => {
  const openMenu = (): FilterMenu => {
    openFilterMenu("owner");
    const menu = findFilterMenu(document);
    if (!menu) throw new Error("fixture menu is unrecognized");
    return menu;
  };

  it("copyMenuGroup yields an empty headed group", () => {
    const menu = openMenu();
    const before = menu.list.outerHTML;

    const { group, list } = copyMenuGroup(menu, "Owners");

    expect(group.dataset.component).toBe("ActionList.Group");
    expect(group.querySelector('[data-component="GroupHeadingWrap"]')?.textContent).toBe("Owners");
    expect(group.querySelector('ul[role="group"]')).toBe(list);
    expect(list.getAttribute("aria-label")).toBe("Owners");
    expect(list.children).toHaveLength(0);
    expect(menu.list.outerHTML).toBe(before);
  });

  it("copyMenuItem yields a blank item that keeps GitHub's checkmark", () => {
    const menu = openMenu();
    const before = menu.list.outerHTML;

    const { item, label } = copyMenuItem(menu);

    expect(item.tagName).toBe("LI");
    for (const attr of ["id", "aria-keyshortcuts", "aria-checked"]) {
      expect(item.hasAttribute(attr)).toBe(false);
    }
    expect(label.textContent).toBe("");
    expect(item.querySelector('[data-component="ActionList.Selection"] svg')).not.toBeNull();
    expect(item.querySelector('[data-component="ActionList.TrailingVisual"]')).toBeNull();
    expect(menu.list.outerHTML).toBe(before);
  });
});

describe("isPublicRepo", () => {
  const REPO = { owner: "octocat", repo: "hello-world" };
  const meta = (name: string, content: string) =>
    `<meta name="octolytics-dimension-repository_${name}" content="${content}">`;

  it.each([
    {
      case: "public, its own nwo in another case",
      metas: meta("public", "true") + meta("nwo", "Octocat/Hello-World"),
      isPublic: true,
    },
    {
      case: "private",
      metas: meta("public", "false") + meta("nwo", "octocat/hello-world"),
      isPublic: false,
    },
    { case: "the metas are missing", metas: "", isPublic: false },
    {
      case: "public, another repo's nwo",
      metas: meta("public", "true") + meta("nwo", "octocat/other"),
      isPublic: false,
    },
  ])("is $isPublic when $case", ({ metas, isPublic }) => {
    document.head.innerHTML = metas;
    expect(isPublicRepo(document, REPO)).toBe(isPublic);
  });
});

describe("readChangedFiles", () => {
  const file = (path: string) => {
    const found = readChangedFiles(document).find((f) => f.path === path);
    if (!found) throw new Error(`no changed file ${path}`);
    return found;
  };

  it("lists the shown files in tree order", () => {
    expect(readChangedFiles(document).map((f) => f.path)).toEqual(PATHS);
  });

  it("marks only the current file active", () => {
    expect(
      readChangedFiles(document)
        .filter((f) => f.active)
        .map((f) => f.path),
    ).toEqual(["src/lib.rs"]);
  });

  it("exposes the row's status", () => {
    expect(file("src/helpers.rs").status).toBe("renamed");
  });

  it("exposes the comment visual only where there are comments", () => {
    expect(
      readChangedFiles(document)
        .filter((f) => f.comments)
        .map((f) => f.path),
    ).toEqual(["src/engine.rs"]);
    expect(file("src/engine.rs").comments?.textContent).toBe("1");
  });

  it("carries the row's diff link", () => {
    expect(file("src/engine.rs").link.getAttribute("href")).toMatch(/^#diff-/);
  });
});

describe("observeTree", () => {
  let controller: AbortController;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    onChange.mockReset();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  // MutationObserver callbacks are microtasks; flush them before advancing timers.
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("debounces a burst into one call after the last mutation", async () => {
    const srcRow = byId("src");
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });

    srcRow.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    srcRow.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reacts to the active file changing", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores unwatched attributes", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    byId("src/lib.rs").setAttribute("tabindex", "-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores mutations inside the ignored node", async () => {
    const ignored = document.createElement("nav");
    byId("pr-file-tree").append(ignored);
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal, ignore: ignored });
    ignored.append(document.createElement("a"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops once aborted", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    controller.abort();
    byId("src").append(document.createElement("li"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("observeDiffs", () => {
  let controller: AbortController;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    onChange.mockReset();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("calls once after a diff mounts in the list", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    diffList().append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("calls once after a diff unmounts from the list", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    byId(ENGINE_DIFF).remove();
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores attribute changes inside a diff", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    byId(ENGINE_DIFF).setAttribute("data-collapsed", "true");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops once aborted", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    controller.abort();
    diffList().append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("findDiff", () => {
  it("finds the mounted diff for a file's link", () => {
    expect(findDiff(foundPage(), linkTo("src/engine.rs"))).toBe(byId(ENGINE_DIFF));
  });

  it("is null while a file's diff is unmounted", () => {
    expect(findDiff(foundPage(), linkTo("docs/guide.md"))).toBeNull();
  });

  it("is null for a diff with the same id outside the diff list", () => {
    const stray = document.createElement("div");
    stray.id = "diff-c2a0fff5575ebf83634ea4da334a24d52775bcef6700ed6f9d0bc4e3db79e42a";
    document.body.append(stray);
    expect(findDiff(foundPage(), linkTo("src/helpers.rs"))).toBeNull();
  });
});

describe("findDiffList", () => {
  it("finds the list that holds each file's entry", () => {
    expect(findDiffList(foundPage())).toBe(byId(ENGINE_DIFF).parentElement?.parentElement);
  });
});

describe("diffEntryOf", () => {
  const entryOf = (anchor: string) => {
    const page = foundPage();
    const list = findDiffList(page);
    if (!list) throw new Error("fixture has no diff list");
    return diffEntryOf(page, list, anchor);
  };

  it("finds the list's child that holds a file's diff", () => {
    expect(entryOf(ENGINE_DIFF)).toBe(byId(ENGINE_DIFF).parentElement);
  });

  it("is null when the diff sits deeper than the list's child", () => {
    const diff = byId(ENGINE_DIFF);
    const wrapper = document.createElement("div");
    diff.replaceWith(wrapper);
    wrapper.append(diff);

    expect(entryOf(ENGINE_DIFF)).toBeNull();
  });
});

const filterOptionsButton = (root: ParentNode) => {
  const button = root.querySelector('#diff-file-tree-filter [aria-label="Filter options"]');
  if (!button) throw new Error("fixture has no filter-options button");
  return button;
};

const virtualize = (page: FilesPage) => {
  page.diffs.insertAdjacentHTML("beforeend", '<div data-index="0"><div role="region"></div></div>');
};

describe("the pull request kind", () => {
  const statusOf = (path: string) =>
    readChangedFiles(document).find((f) => f.path === path)?.status;
  const toggleButton = () => {
    const button = document.querySelector('[class*="RegularTreeToggle"]');
    if (!button) throw new Error("fixture has no tree toggle");
    return button;
  };

  it("finds the header's lines-changed counter", () => {
    expect(findDiffstat(headerOf(foundPage()))?.textContent).toContain("+1,604");
  });

  it("finds the filter row's child holding the filter-options button", () => {
    expect(findFilterOptions(foundPage())).toBe(filterOptionsButton(document).parentElement);
  });

  it("finds the docked sidebar's filter options while the overlay is open", () => {
    const dockedFilterOptions = filterOptionsButton(byId("pr-file-tree")).parentElement;
    openOverlay();
    expect(findFilterOptions(foundPage())).toBe(dockedFilterOptions);
  });

  it("finds the toolbar's tree toggle", () => {
    expect(findTreeToggle(foundPage())).toBe(toggleButton().parentElement);
  });

  it("finds the toolbar row holding the tree toggle", () => {
    expect(findFilesToolbar(foundPage())).toBe(toggleButton().closest("section"));
  });

  it("takes the regular tree toggle as collapsing the tree in place", () => {
    expect(treeToggleButtonOf(foundPage(), toggleButton())).toBe(toggleButton());
  });

  it("does not take the narrow layout's toggle as collapsing the tree", () => {
    const narrow = document.querySelector('[class*="MobileTreeToggle"]');
    if (!narrow) throw new Error("fixture has no narrow tree toggle");
    expect(treeToggleButtonOf(foundPage(), narrow)).toBeNull();
  });

  it("selects the diff list entry holding a file's diff", () => {
    expect(document.querySelector(prPage.diffEntry(ENGINE_DIFF))).toBe(
      byId(ENGINE_DIFF).parentElement,
    );
  });

  it("selects its diff list", () => {
    expect(document.querySelector(prPage.diffList)).toBe(
      byId(ENGINE_DIFF).parentElement?.parentElement,
    );
  });

  it("selects each entry holding a diff", () => {
    expect([...document.querySelectorAll(prPage.diffEntries)]).toEqual([
      byId(ENGINE_DIFF).parentElement,
    ]);
  });

  it("reads a row's status from its octicon", () => {
    expect(statusOf("src/helpers.rs")).toBe("renamed");
    expect(statusOf("src/engine.rs")).toBe("modified");
  });

  it("is reorderable until GitHub virtualizes its diffs", () => {
    const page = foundPage();
    expect(reorderable(page)).toBe(true);
    virtualize(page);
    expect(reorderable(page)).toBe(false);
  });
});

describe("the commit kind", () => {
  const diffs = () => byId("diff-content-parent");

  beforeEach(() => {
    loadCommitFixture();
  });

  it("finds the sidebar, tree, and diff list", () => {
    expect(findFilesPage(document)).toEqual({
      kind: commitPage,
      sidebar: byId("diff_file_tree"),
      tree: document.querySelector('ul[role="tree"]'),
      diffs: diffs(),
    });
  });

  it.each([
    ["lists", "feat: order the diffs like the sidebar"],
    ["sha", 'Revert "Use internal Apple codesign action (#14437)"'],
    ["mention", "Refactor CopilotReplacer logic based on PR feedback"],
    ["links", "chore(deps): Bump the codeql-actions group with 2 updates"],
  ] as const)("finds the %s message's box, title, and body", (card, title) => {
    loadCommitFixture(card);
    const box = document.querySelector('[class*="commitMessageContainer__"]');
    expect(findCommitMessage(foundPage())).toEqual({
      box,
      title: box?.firstElementChild?.firstElementChild,
      body: document.querySelector(".extended-commit-description-container"),
    });
    expect(findCommitMessage(foundPage())?.title.textContent).toBe(title);
    expect(findCommitMessage(foundPage())?.body).not.toBeNull();
  });

  it("finds a subject-only message's title with no body", () => {
    loadCommitFixture("subject");
    const message = findCommitMessage(foundPage());
    expect(message?.title.textContent).toBe("Replace msgpack with a minimal node ID encoder");
    expect(message?.body).toBeNull();
  });

  it("finds no message box while the page has none", () => {
    expect(findCommitMessage(foundPage())).toBeUndefined();
  });

  it("finds a message box only on a commit's page", () => {
    loadFixture();
    expect(findCommitMessage(foundPage())).toBeUndefined();
    document.body.insertAdjacentHTML("afterbegin", COMMIT_MESSAGES.sha);
    expect(findCommitMessage(foundPage())).toBeUndefined();
  });

  it("reads the commit's parent from the card's row naming its parents and SHA", () => {
    loadCommitFixture("sha");

    const header = findCommitHeader(foundPage());

    expect(header?.row).toBe(document.querySelector('[class*="commitBranchContainer__"] > pre'));
    expect(header?.parent).toBe("9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b");
  });

  // Trimmed from github.com/cli/cli/commit/0cf1092 and octocat/Hello-World/commit/553c207.
  it.each([
    [
      "a merge's first parent",
      '2 parents <a data-hotkey="p" href="/cli/cli/commit/9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b">9eb4db2</a> + <a data-hotkey="o" href="/cli/cli/commit/189706bccb1686c68fb73c5bd9013358320a9e71">189706b</a>',
      "9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b",
    ],
    ["no parent for a root commit", "0 parents <!-- -->", undefined],
  ])("reads %s", (_, parents, parent) => {
    loadCommitFixture("sha");
    const row = document.querySelector('[class*="commitBranchContainer__"] > pre');
    if (!row) throw new Error("fixture has no parents row");
    row.innerHTML = `${parents} commit <span class="fgColor-default">0cf1092</span>`;

    expect(findCommitHeader(foundPage())).toEqual({ row, parent });
  });

  it("finds no parents row while the page has none, or on a pull request's page", () => {
    expect(findCommitHeader(foundPage())).toBeUndefined();

    loadFixture();
    document.body.insertAdjacentHTML("afterbegin", COMMIT_MESSAGES.sha);
    expect(findCommitHeader(foundPage())).toBeUndefined();
  });

  it("finds the row its message column joins", () => {
    expect(findCommitColumnRow(foundPage())).toBe(
      document.querySelector('[class*="PageLayout-PageLayoutContent"]'),
    );
  });

  it("finds no row for a message column on a pull request's page", () => {
    loadFixture();
    expect(findCommitColumnRow(foundPage())).toBeUndefined();
  });

  it("finds no row for a message column while the page has none", () => {
    const row = document.querySelector('[class*="PageLayout-PageLayoutContent"]');
    row?.replaceWith(...row.childNodes);
    expect(findCommitColumnRow(foundPage())).toBeUndefined();
  });

  it("finds the header's lines-changed counter", () => {
    expect(findDiffstat(headerOf(foundPage()))?.textContent).toContain("+165");
  });

  it("finds the filter row's child holding the filter-options button", () => {
    expect(findFilterOptions(foundPage())).toBe(filterOptionsButton(document).parentElement);
  });

  it("finds no toolbar row for a Conversation button on a commit's page", () => {
    expect(findFilesToolbar(foundPage())).toBeUndefined();
  });

  it("finds the toolbar's tree toggle, not the copy inside the sidebar", () => {
    expect(findTreeToggle(foundPage())).toBe(
      document.querySelector('#diff-content-parent [aria-controls="diff_file_tree"]')
        ?.parentElement,
    );
  });

  it("takes the in-place toggle, not the narrow layout's, as collapsing the tree", () => {
    const [narrow, regular] = diffs().querySelectorAll('[aria-controls="diff_file_tree"]');
    if (!narrow || !regular) throw new Error("fixture has no tree toggles");
    expect(treeToggleButtonOf(foundPage(), regular)).toBe(regular);
    expect(treeToggleButtonOf(foundPage(), narrow)).toBeNull();
  });

  it("selects the diff list entry holding a file's diff", () => {
    expect(document.querySelector(commitPage.diffEntry(LAUNCHER_DIFF))).toBe(
      document.querySelector('[role="region"]')?.parentElement,
    );
  });

  it("selects its diff list", () => {
    expect(document.querySelector(commitPage.diffList)).toBe(
      document.querySelector('[role="region"]')?.parentElement?.parentElement,
    );
  });

  it("selects each entry holding a diff", () => {
    expect([...document.querySelectorAll(commitPage.diffEntries)]).toEqual(
      [...diffs().querySelectorAll('[role="region"]')].map((region) => region.parentElement),
    );
  });

  it("appends to its diff list ahead of the comments", () => {
    const node = document.createElement("div");
    appendToDiffs(foundPage(), node);
    expect(node.nextElementSibling).toBe(byId("comments"));
  });

  it("reads a row's status from its octicon", () => {
    expect(readChangedFiles(document).find((f) => f.path === "bin/caret-launcher")?.status).toBe(
      "modified",
    );
  });

  it("is reorderable until GitHub virtualizes its diffs", () => {
    const page = foundPage();
    expect(reorderable(page)).toBe(true);
    virtualize(page);
    expect(reorderable(page)).toBe(false);
  });

  it("finds a file's diff, which has no id, by its header's link", () => {
    expect(findDiff(foundPage(), linkTo("bin/caret-launcher"))).toBe(
      document.querySelector('[role="region"]'),
    );
  });

  it("finds its diff list", () => {
    expect(findDiffList(foundPage())).toBe(
      document.querySelector('[role="region"]')?.parentElement?.parentElement,
    );
  });

  it("finds the entry that holds a file's diff", () => {
    const region = document.querySelector('[role="region"]');
    const page = foundPage();
    const list = findDiffList(page);
    if (!list) throw new Error("commit fixture lacks its diff list");

    expect(diffEntryOf(page, list, LAUNCHER_DIFF)).toBe(region?.parentElement);
  });

  it("finds no diff for a file whose diff is unmounted", () => {
    expect(findDiff(foundPage(), linkTo("src/adapters/opencode/paths.ts"))).toBeNull();
  });
});

describe("mountedDiffs", () => {
  const agreesWithFindDiff = () => {
    const page = foundPage();
    const mounted = mountedDiffs(page);
    const expected = new Map(
      readChangedFiles(page.sidebar).flatMap((file) => {
        const diff = findDiff(page, file.link);
        return diff ? [[file.link.hash.slice(1), diff] as const] : [];
      }),
    );

    expect(mounted.size).toBeGreaterThan(0);
    expect(mounted).toEqual(expected);
  };

  it("keys each mounted region of a pull request by its file's anchor", () => {
    loadFixture();
    agreesWithFindDiff();
  });

  it("keys each mounted region of a commit by its file's anchor", () => {
    loadCommitFixture();
    agreesWithFindDiff();
  });
});

describe("coveredTop", () => {
  it("is the sticky file header's top", () => {
    loadFixture();
    const region = byId(ENGINE_DIFF);
    const header = document.createElement("div");
    header.className = "diffHeaderWrapper__abc";
    header.style.top = "66px";
    region.prepend(header);

    expect(coveredTop(foundPage())).toBe(66);
  });

  it("is 0 with no file header mounted", () => {
    loadFixture();
    for (const header of document.querySelectorAll('[class*="diffHeaderWrapper__"]'))
      header.remove();

    expect(coveredTop(foundPage())).toBe(0);
  });
});

const toggleIn = (anchor: string): Element => {
  const toggle = byId(anchor).querySelector('button[aria-label$="Viewed"]');
  if (!toggle) throw new Error(`no Viewed toggle in #${anchor}`);
  return toggle;
};

describe("the signed-in Viewed fixtures", () => {
  it("are Files pages with diff entries", () => {
    for (const load of [loadViewedFixture, loadViewedCommitFilterFixture]) {
      load();

      expect(findFilesPage(document)?.kind).toBe(prPage);
      expect(document.querySelectorAll(prPage.diffEntries).length).toBeGreaterThan(0);
    }
  });
});

describe("readViewed", () => {
  it("reads each mounted header's Viewed toggle", () => {
    loadViewedFixture();

    expect(readViewed(foundPage())).toEqual(
      new Map([
        [VIEWED_APP_TOML, true],
        [VIEWED_LIB_RS, false],
        [VIEWED_CARGO_LOCK, false],
      ]),
    );
  });

  it("is empty on pages without Viewed toggles", () => {
    expect(readViewed(foundPage())).toEqual(new Map());

    loadViewedCommitFilterFixture();

    expect(readViewed(foundPage())).toEqual(new Map());
  });

  it("leaves out a region whose header has no toggle", () => {
    loadViewedFixture();
    toggleIn(VIEWED_LIB_RS).remove();

    expect(readViewed(foundPage()).has(VIEWED_LIB_RS)).toBe(false);
  });
});

describe("viewedOffered", () => {
  const counter = () => document.querySelector('[class*="ProgressContainer__"]');

  it("decides Viewed page-wide", () => {
    loadViewedFixture();
    expect(viewedOffered(foundPage())).toBe(true);

    counter()?.remove();
    expect(viewedOffered(foundPage())).toBe(true);

    loadViewedFixture();
    for (const region of diffList().querySelectorAll('[role="region"]')) region.remove();
    expect(viewedOffered(foundPage())).toBe(true);

    loadViewedCommitFilterFixture();
    expect(viewedOffered(foundPage())).toBe(false);

    loadFixture();
    expect(viewedOffered(foundPage())).toBe(false);

    loadCommitFixture();
    expect(viewedOffered(foundPage())).toBe(false);
  });
});

describe("observeViewed", () => {
  let controller: AbortController;
  const onChange = vi.fn();
  const flip = (el: Element) =>
    el.setAttribute("aria-pressed", el.getAttribute("aria-pressed") === "true" ? "false" : "true");

  beforeEach(() => {
    loadViewedFixture();
    controller = new AbortController();
    onChange.mockReset();
    observeViewed(diffList(), onChange, { signal: controller.signal });
  });

  afterEach(() => {
    controller.abort();
  });

  it("reports a Viewed toggle flipping", async () => {
    flip(toggleIn(VIEWED_APP_TOML));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalled();
  });

  it("ignores attribute changes other than a Viewed toggle", async () => {
    const segmented = byId(VIEWED_CARGO_LOCK).querySelector(
      "button[aria-pressed]:not([aria-label])",
    );
    if (!segmented) throw new Error("no segmented-control button");

    flip(segmented);
    byId(VIEWED_LIB_RS).setAttribute("data-collapsed", "true");
    const region = document.createElement("div");
    region.setAttribute("role", "region");
    diffList().append(region);
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();

    controller.abort();
    flip(toggleIn(VIEWED_APP_TOML));
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("viewedToggleOf", () => {
  beforeEach(() => {
    loadViewedFixture();
  });

  it("finds the Viewed toggle in a file's mounted header from its tree link", () => {
    expect(viewedToggleOf(foundPage(), linkTo("src/lib.rs"))).toBe(toggleIn(VIEWED_LIB_RS));
  });

  it("finds an unloaded diff's header toggle, past its other pressable buttons", () => {
    expect(viewedToggleOf(foundPage(), linkTo("Cargo.lock"))).toBe(toggleIn(VIEWED_CARGO_LOCK));
  });

  it("is null once the file's diff unmounts", () => {
    byId(VIEWED_LIB_RS).remove();

    expect(viewedToggleOf(foundPage(), linkTo("src/lib.rs"))).toBeNull();
  });
});

describe("showsViewed", () => {
  it("reads whether a toggle shows its file viewed", () => {
    loadViewedFixture();

    expect(showsViewed(toggleIn(VIEWED_APP_TOML))).toBe(true);
    expect(showsViewed(toggleIn(VIEWED_LIB_RS))).toBe(false);
  });
});

describe("findHeaderPage", () => {
  it("finds a pull request's header and the counter in it", () => {
    loadHeaderFixture();
    const page = findHeaderPage(document);

    expect(page?.slot).toBe(document.querySelector(prPage.diffstatSlot));
    expect(page && findDiffstat(page)?.textContent).toBe("+36 -10");
  });

  it("is undefined without the header's counter slot", () => {
    document.body.innerHTML = "<main></main>";

    expect(findHeaderPage(document)).toBeUndefined();
  });
});
