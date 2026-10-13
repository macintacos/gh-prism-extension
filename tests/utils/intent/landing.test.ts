import { describe, expect, it } from "vitest";
import type { FileLines, Placement } from "../../../utils/intent/intent";
import {
  type LandedSection,
  landingOf,
  revealLineOf,
  sectionOf,
  sectionsOf,
  totalsOf,
} from "../../../utils/intent/landing";

const split = {
  kind: "split",
  shares: [
    {
      section: "implementation",
      hunks: [undefined, { first: 2, last: 8 }],
      lines: { added: 5, removed: 1 },
    },
    { section: "docs", hunks: [{ first: 22, last: 28 }], lines: { added: 2, removed: 0 } },
  ],
} as const satisfies Placement;
const landing = landingOf({
  ok: true,
  placements: new Map<string, Placement>([
    ["src/notes.rs", { kind: "whole", section: "docs" }],
    ["src/render.rs", split],
  ]),
  lines: new Map<string, FileLines>([
    ["src/parser.rs", { added: 10, removed: 3 }],
    ["src/notes.rs", { added: 4, removed: 4 }],
    ["src/render.rs", { added: 7, removed: 1 }],
    ["tests/integration.rs", { added: 20, removed: 0 }],
    ["config/app.toml", "binary"],
    ["Cargo.lock", { added: 1210, removed: 350 }],
  ]),
});

const files = (...paths: string[]) => paths.map((path) => ({ path }));
const ALL = files(
  "Cargo.lock",
  "config/app.toml",
  "src/render.rs",
  "tests/integration.rs",
  "src/parser.rs",
  "src/notes.rs",
);

/** Where `path` lands across `sections`, as `{ section, share, lines }`, for plain comparison. */
const placesOf = (sections: LandedSection<{ path: string }>[], path: string) =>
  sections.flatMap(({ key, entries }) =>
    entries
      .filter(({ file }) => file.path === path)
      .map(({ share, lines }) => ({ section: key, share, lines })),
  );

describe("sectionOf", () => {
  it("keeps the rule section that claimed a file or hunk, else its path section", () => {
    expect(sectionOf("src/a.rs", "docs")).toEqual("docs");
    expect(sectionOf("src/a.rs")).toEqual("implementation");
    expect(sectionOf("README.md")).toEqual("docs");
  });
});

describe("sectionsOf", () => {
  const sections = sectionsOf(landing, ALL);

  it("lands a file intent doesn't place in its path section, with its whole-diff lines", () => {
    expect(placesOf(sections, "src/parser.rs")).toEqual([
      { section: "implementation", share: undefined, lines: { added: 10, removed: 3 } },
    ]);
  });

  it("lands a file placed whole only in that rule section, whatever its path says", () => {
    expect(placesOf(sections, "src/notes.rs")).toEqual([
      { section: "docs", share: undefined, lines: { added: 4, removed: 4 } },
    ]);
  });

  it("lists a split file once per share, each with the share and its lines", () => {
    const [implementation, docs] = split.shares;
    expect(placesOf(sections, "src/render.rs")).toEqual([
      { section: "implementation", share: implementation, lines: { added: 5, removed: 1 } },
      { section: "docs", share: docs, lines: { added: 2, removed: 0 } },
    ]);
  });

  it("orders sections as SECTIONS does and keeps the files' order within each", () => {
    expect(sections.map(({ key, entries }) => [key, entries.map(({ file }) => file.path)])).toEqual(
      [
        ["implementation", ["src/render.rs", "src/parser.rs"]],
        ["tests", ["tests/integration.rs"]],
        ["docs", ["src/render.rs", "src/notes.rs"]],
        ["config", ["config/app.toml"]],
        ["generated", ["Cargo.lock"]],
      ],
    );
  });

  it("leaves out a section no file lands in", () => {
    const keys = sectionsOf(landing, ALL.slice(1)).map(({ key }) => key);
    expect(keys).toEqual(["implementation", "tests", "docs", "config"]);
  });

  it("lands a binary file in its path section with binary lines", () => {
    expect(placesOf(sections, "config/app.toml")).toEqual([
      { section: "config", share: undefined, lines: "binary" },
    ]);
  });

  it("carries the caller's own file objects", () => {
    expect(sections[4]?.entries[0]?.file).toBe(ALL[0]);
  });

  it.each([
    ["pending", undefined],
    ["commit-filtered", { ok: false, problem: "commit-filtered" } as const],
  ])("puts every file in its path section from paths alone (%s)", (_, result) => {
    const pathOnly = sectionsOf(landingOf(result), ALL);
    expect(placesOf(pathOnly, "src/notes.rs")).toEqual([
      { section: "implementation", share: undefined, lines: undefined },
    ]);
    expect(placesOf(pathOnly, "src/render.rs")).toEqual([
      { section: "implementation", share: undefined, lines: undefined },
    ]);
    expect(placesOf(pathOnly, "Cargo.lock")).toEqual([
      { section: "generated", share: undefined, lines: undefined },
    ]);
  });
});

describe("totalsOf", () => {
  it("sums each section's lines across the diff, whole files and shares alike, skipping binary files", () => {
    expect(totalsOf(landing)).toEqual([
      { section: "implementation", lines: { added: 15, removed: 4 } },
      { section: "tests", lines: { added: 20, removed: 0 } },
      { section: "docs", lines: { added: 6, removed: 4 } },
      { section: "generated", lines: { added: 1210, removed: 350 } },
    ]);
  });

  it("drops a section whose files changed no lines", () => {
    const unchanged = landingOf({
      ok: true,
      placements: new Map(),
      lines: new Map([["src/a.rs", { added: 0, removed: 0 }]]),
    });
    expect(totalsOf(unchanged)).toEqual([]);
  });

  it("gives no totals from paths alone", () => {
    expect(totalsOf(landingOf(undefined))).toEqual([]);
  });
});

describe("revealLineOf", () => {
  it("gives the first head line of the share placed in the section", () => {
    expect(revealLineOf(landing, "src/render.rs", "implementation")).toEqual(2);
    expect(revealLineOf(landing, "src/render.rs", "docs")).toEqual(22);
  });

  it("gives nothing where no share lands in the section", () => {
    expect(revealLineOf(landing, "src/render.rs", "tests")).toEqual(undefined);
    expect(revealLineOf(landing, "src/notes.rs", "docs")).toEqual(undefined);
    expect(revealLineOf(landing, "src/parser.rs", "implementation")).toEqual(undefined);
    expect(revealLineOf(landingOf(undefined), "src/render.rs", "implementation")).toEqual(
      undefined,
    );
  });

  it("gives nothing for a share whose hunks have no head lines", () => {
    const deletion = landingOf({
      ok: true,
      placements: new Map<string, Placement>([
        [
          "src/a.rs",
          {
            kind: "split",
            shares: [
              {
                section: "implementation",
                hunks: [{ first: 1, last: 3 }],
                lines: { added: 3, removed: 0 },
              },
              { section: "docs", hunks: [undefined], lines: { added: 0, removed: 4 } },
            ],
          },
        ],
      ]),
      lines: new Map([["src/a.rs", { added: 3, removed: 4 }]]),
    });
    expect(revealLineOf(deletion, "src/a.rs", "docs")).toEqual(undefined);
  });
});
