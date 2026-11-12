/** GitHub's two Layout choices, as the gear menu names them. */
export type Layout = "split" | "unified";

/** Reads and saves the signed-in account's Layout choice. */
export interface LayoutChoice {
  read(): Promise<Layout>;
  choose(layout: Layout): Promise<void>;
}

/**
 * Runs `body` with the Layout saved before it, then chooses that Layout again whether `body`
 * returned or threw, so a run leaves the account as it found it.
 */
export async function withLayoutRestored<T>(
  layout: LayoutChoice,
  body: (original: Layout) => Promise<T>,
): Promise<T> {
  const original = await layout.read();
  try {
    return await body(original);
  } finally {
    await layout.choose(original);
  }
}
