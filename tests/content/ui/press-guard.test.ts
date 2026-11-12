// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pressGuard } from "../../../entrypoints/content/ui/press-guard";

describe("pressGuard", () => {
  let visit: AbortController;
  const down = (node: Element) =>
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  const up = (node: Element) =>
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  const button = () => document.body.appendChild(document.createElement("button"));

  beforeEach(() => {
    visit = new AbortController();
  });

  afterEach(() => {
    visit.abort();
    document.body.replaceChildren();
  });

  it("runs the press on the control re-mounted under it", () => {
    const guard = pressGuard(document, visit.signal);
    const onPress = vi.fn();
    const first = button();
    guard(first, "unified", onPress);

    down(first);
    first.remove();
    const second = button();
    guard(second, "unified", onPress);
    up(second);

    expect(onPress).toHaveBeenCalledOnce();
  });

  it("leaves a press alone that ends on the button it started on", () => {
    const guard = pressGuard(document, visit.signal);
    const onPress = vi.fn();
    const only = button();
    guard(only, "unified", onPress);

    down(only);
    up(only);

    expect(onPress).not.toHaveBeenCalled();
  });

  it("ignores a re-mounted control of another key", () => {
    const guard = pressGuard(document, visit.signal);
    const onPress = vi.fn();
    const first = button();
    guard(first, "unified", vi.fn());

    down(first);
    first.remove();
    const second = button();
    guard(second, "split", onPress);
    up(second);

    expect(onPress).not.toHaveBeenCalled();
  });

  it("forgets a press released anywhere else", () => {
    const guard = pressGuard(document, visit.signal);
    const onPress = vi.fn();
    const first = button();
    guard(first, "unified", onPress);

    down(first);
    up(document.body);
    first.remove();
    const second = button();
    guard(second, "unified", onPress);
    up(second);

    expect(onPress).not.toHaveBeenCalled();
  });
});
