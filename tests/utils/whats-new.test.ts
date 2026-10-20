import { describe, expect, it } from "vitest";
import { dismissWhatsNew, whatsNewAt, whatsNewStateOf } from "../../utils/whats-new";

const DAYS_3 = 3 * 24 * 60 * 60 * 1000;

describe("whatsNewAt", () => {
  it("shows a version on first view and stamps it", () => {
    expect(whatsNewAt({}, "0.4.0", 100)).toEqual({
      shows: true,
      state: { shown: { version: "0.4.0", at: 100 } },
    });
  });

  it("keeps showing a stamped version until 3 days pass, leaving its state as is", () => {
    const state = { shown: { version: "0.4.0", at: 100 } };

    const result = whatsNewAt(state, "0.4.0", 100 + DAYS_3 - 1);

    expect(result.shows).toBe(true);
    expect(result.state).toBe(state);
  });

  it("hides a stamped version once 3 days pass", () => {
    const state = { shown: { version: "0.4.0", at: 100 } };

    expect(whatsNewAt(state, "0.4.0", 100 + DAYS_3).shows).toBe(false);
  });

  it("hides a dismissed version", () => {
    expect(whatsNewAt({ dismissed: "0.4.0" }, "0.4.0", 100).shows).toBe(false);
  });

  it("shows and stamps a newer version after an older one was dismissed", () => {
    expect(whatsNewAt({ dismissed: "0.3.2" }, "0.4.0", 100)).toEqual({
      shows: true,
      state: { dismissed: "0.3.2", shown: { version: "0.4.0", at: 100 } },
    });
  });

  it("restarts the window for a newer version after an older one was shown", () => {
    const state = { shown: { version: "0.3.2", at: 0 } };

    expect(whatsNewAt(state, "0.4.0", DAYS_3 * 2)).toEqual({
      shows: true,
      state: { shown: { version: "0.4.0", at: DAYS_3 * 2 } },
    });
  });
});

describe("dismissWhatsNew", () => {
  it("marks the version dismissed and keeps what was shown", () => {
    const shown = { version: "0.4.0", at: 100 };

    expect(dismissWhatsNew({ shown }, "0.4.0")).toEqual({ dismissed: "0.4.0", shown });
  });
});

describe("whatsNewStateOf", () => {
  it("drops a non-string dismissed", () => {
    expect(whatsNewStateOf({ dismissed: 4 })).toEqual({});
  });

  it.each(["0.4.0", { version: 4, at: 1 }, { version: "0.4.0", at: "1" }, null])(
    "drops a malformed shown: %j",
    (shown) => {
      expect(whatsNewStateOf({ dismissed: "0.3.2", shown })).toEqual({ dismissed: "0.3.2" });
    },
  );

  it.each([null, undefined, "x", 3])("maps %j to an empty state", (saved) => {
    expect(whatsNewStateOf(saved)).toEqual({});
  });

  it("keeps a well-formed state", () => {
    const state = { dismissed: "0.3.2", shown: { version: "0.4.0", at: 1 } };

    expect(whatsNewStateOf(state)).toEqual(state);
  });
});
