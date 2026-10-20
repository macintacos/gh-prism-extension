// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsNewBlock } from "../../../entrypoints/content/sidebar/whats-new";

const dismiss = vi.fn();
let block: HTMLElement;

const toggle = () => block.querySelector<HTMLButtonElement>(".gh-prism-whats-new-toggle");
const body = () => block.querySelector<HTMLElement>(".gh-prism-whats-new-body");

beforeEach(() => {
  dismiss.mockReset();
  document.body.replaceChildren();
  block = whatsNewBlock(document, { version: "0.4.0", notes: "- Sorts man pages", dismiss });
  document.body.append(block);
});

describe("whatsNewBlock", () => {
  it("starts collapsed", () => {
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.getAttribute("aria-controls")).toBe(body()?.id);
    expect(body()?.inert).toBe(true);
  });

  it("expands when its toggle is clicked", () => {
    toggle()?.click();

    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(body()?.inert).toBe(false);
  });

  it("names the version in its label", () => {
    expect(toggle()?.textContent).toContain("0.4.0");
    expect(block.getAttribute("aria-labelledby")).toBe(block.querySelector("h3")?.id);
  });

  it("leads with an icon and takes the success hue", () => {
    expect(toggle()?.querySelector(".gh-prism-glyph svg")).not.toBeNull();
    expect(block.style.getPropertyValue("--gh-prism-hue")).toBe("var(--fgColor-success)");
  });

  it("removes itself and calls dismiss once when dismissed", () => {
    const button = block.querySelector<HTMLButtonElement>('[aria-label="Dismiss what\'s new"]');
    button?.click();

    expect(block.isConnected).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("holds the rendered notes, then a link to the version's release", () => {
    const content = body();
    expect(content?.querySelector("li")?.textContent).toBe("Sorts man pages");
    const links = [...(content?.querySelectorAll("a") ?? [])];
    expect(links.at(-1)?.href).toMatch(/\/releases\/tag\/v0\.4\.0$/);
  });
});
