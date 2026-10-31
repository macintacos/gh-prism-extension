// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { toggleKeyOf } from "../../../entrypoints/content/ui/toggle-keys";

const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  let key: ReturnType<typeof toggleKeyOf>;
  target.addEventListener("keydown", (seen) => (key = toggleKeyOf(seen as KeyboardEvent)), {
    once: true,
  });
  target.dispatchEvent(event);
  return key;
};

describe("toggleKeyOf", () => {
  it("reads \\ alone as the tree's key", () => {
    expect(press({ key: "\\" })).toBe("\\");
  });

  it("reads Shift with |, which Shift+\\ types on US and UK layouts, as the Conversation's key", () => {
    expect(press({ key: "|", shiftKey: true })).toBe("Shift+\\");
  });

  it("leaves \\ with Shift held to the layout that types it", () => {
    expect(press({ key: "\\", shiftKey: true })).toBeUndefined();
  });

  it.each(["altKey", "ctrlKey", "metaKey"])("ignores either key with %s held", (modifier) => {
    expect(press({ key: "\\", [modifier]: true })).toBeUndefined();
    expect(press({ key: "|", shiftKey: true, [modifier]: true })).toBeUndefined();
  });

  it("ignores a held key's repeats", () => {
    expect(press({ key: "\\", repeat: true })).toBeUndefined();
    expect(press({ key: "|", shiftKey: true, repeat: true })).toBeUndefined();
  });

  it("leaves a key typed into a field to the field", () => {
    const field = document.body.appendChild(document.createElement("textarea"));
    expect(press({ key: "\\" }, field)).toBeUndefined();
    expect(press({ key: "|", shiftKey: true }, field)).toBeUndefined();
    field.remove();
  });
});
