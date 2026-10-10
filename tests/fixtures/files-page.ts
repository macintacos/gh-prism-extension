// The `?raw` import is required: `readFileSync` throws under happy-dom.
import fixture from "./files-page.html?raw";

/** Replaces `document.body` with the Files changed markup. */
export function loadFixture(): void {
  document.body.innerHTML = fixture;
}

/** The fixture element with `id`; throws when the fixture lacks it. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el;
}
