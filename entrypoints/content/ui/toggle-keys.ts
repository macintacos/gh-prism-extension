import { isEditable } from "./dom";

/** The keys that toggle the file tree (`\`) and the Conversation panel (`Shift+\`). */
export type ToggleKey = "\\" | "Shift+\\";

/**
 * The toggle key `event` presses, or `undefined` for any other key, a key typed into a field, a
 * key pressed with Alt, Ctrl, or Meta, and a held key's repeats.
 */
export function toggleKeyOf(event: KeyboardEvent): ToggleKey | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return undefined;
  if (isEditable(event.target)) return undefined;
  if (event.key === "\\" && !event.shiftKey) return "\\";
  // Shift+\ types | on US and UK layouts.
  if (event.key === "|" && event.shiftKey) return "Shift+\\";
  return undefined;
}

/** Init for a keydown that `toggleKeyOf` reads as `key`. */
export const toggleKeyInit = (key: ToggleKey): KeyboardEventInit =>
  key === "\\" ? { key: "\\" } : { key: "|", shiftKey: true };
