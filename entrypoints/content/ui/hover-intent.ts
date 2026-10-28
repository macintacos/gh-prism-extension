/** Opens and closes a card beside a trigger the way GitHub's hovercard does, one card at a time. */

// GitHub's hovercard closes 110–130 ms after the pointer leaves; wait longer, so the two never show
// together.
const OPEN_DELAY_MS = 200;
// Time to carry the pointer from the trigger into the card.
const CLOSE_DELAY_MS = 150;

/** A card shown beside its trigger. It counts as closed once it leaves the document. */
export interface Card {
  readonly element: HTMLElement;
  /** Removes the card and whatever it set up; safe to call twice. */
  readonly close: () => void;
}

/** Where a hover card's triggers are, and what each one shows. */
export interface HoverCard {
  /** The trigger `target` sits in, or `null`. */
  readonly triggerOf: (target: Element) => HTMLElement | null;
  /**
   * Shows `trigger`'s card, or nothing. A card that resolves after the pointer or focus has moved
   * on is closed at once.
   */
  readonly show: (trigger: HTMLElement) => Card | undefined | Promise<Card | undefined>;
}

/** Where the pointer or focus moved from or to, for a pointer or focus event. */
const relatedOf = (event: Event): EventTarget | null =>
  event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;

/** Whether `target` is `node` or inside it. */
const within = (node: Node, target: EventTarget | null) =>
  target instanceof Node && node.contains(target);

/** Adds the shadow roots whose triggers the card follows. */
export interface HoverIntent {
  /**
   * Follows hover and focus inside `shadow` too: a move between two of its nodes never reaches
   * the document.
   */
  readonly follow: (shadow: ShadowRoot) => void;
}

/**
 * Until `signal` aborts, shows a trigger's card 200 ms after the pointer rests on it, or at once
 * when it takes focus. Closes the card 150 ms after the pointer leaves trigger and card, and at
 * once on Escape or focus leaving both. Follows triggers in `doc`, and in each shadow root passed
 * to the returned `follow`.
 */
export function followHoverIntent(
  doc: Document,
  signal: AbortSignal,
  { triggerOf, show }: HoverCard,
): HoverIntent {
  let open: { readonly trigger: HTMLElement; readonly card: Card } | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped by every open or cancel, so a card that settles late shows nothing stale.
  let attempt = 0;

  const isOpen = (trigger: HTMLElement) =>
    open?.trigger === trigger && open.card.element.isConnected;
  const triggerAt = (target: EventTarget | null) =>
    target instanceof Element ? triggerOf(target) : null;
  const inOpenCard = (target: EventTarget | null) =>
    !!open?.card.element.isConnected &&
    target instanceof Node &&
    (open.trigger.contains(target) || open.card.element.contains(target));

  const cancelOpen = () => {
    clearTimeout(openTimer);
    attempt++;
  };
  const close = () => {
    clearTimeout(closeTimer);
    open?.card.close();
    open = undefined;
  };
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_DELAY_MS);
  };

  /** Shows `trigger`'s card after `delay` ms, or in this task when `delay` is 0. */
  const openAfter = (trigger: HTMLElement, delay: number) => {
    if (isOpen(trigger)) return;
    cancelOpen();
    const thisAttempt = attempt;
    const keep = (card: Card | undefined) => {
      if (thisAttempt !== attempt) {
        card?.close();
        return;
      }
      if (!card) return;
      close();
      open = { trigger, card };
    };
    // A card shown in this task is kept in it, so a focus move right after it can close it.
    const openNow = () => {
      const shown = show(trigger);
      if (shown instanceof Promise) void shown.then(keep);
      else keep(shown);
    };
    // In this task: a click's focus opens before its pointerup, so the click's light dismiss
    // can't land first.
    if (delay === 0) openNow();
    else openTimer = setTimeout(openNow, delay);
  };

  signal.addEventListener("abort", () => {
    cancelOpen();
    close();
  });

  const follow = (root: Document | ShadowRoot) => {
    // Each listener reads its own root's view of the event: a move inside a shadow root reaches
    // the document as its host, which is never a trigger.
    root.addEventListener(
      "pointerover",
      (event) => {
        if (inOpenCard(event.target)) {
          clearTimeout(closeTimer);
          return;
        }
        const trigger = triggerAt(event.target);
        if (trigger && !within(trigger, relatedOf(event))) openAfter(trigger, OPEN_DELAY_MS);
      },
      { signal },
    );
    root.addEventListener(
      "pointerout",
      (event) => {
        const trigger = triggerAt(event.target);
        if (trigger && !within(trigger, relatedOf(event))) cancelOpen();
        if (inOpenCard(event.target) && !inOpenCard(relatedOf(event))) closeSoon();
      },
      { signal },
    );
    root.addEventListener(
      "focusin",
      ({ target }) => {
        const trigger = triggerAt(target);
        if (trigger) openAfter(trigger, 0);
      },
      { signal },
    );
    root.addEventListener(
      "focusout",
      (event) => {
        if (triggerAt(event.target)) cancelOpen();
        if (inOpenCard(event.target) && !inOpenCard(relatedOf(event))) close();
      },
      { signal },
    );
    root.addEventListener(
      "keydown",
      (event) => {
        if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;
        cancelOpen();
        close();
      },
      { signal },
    );
  };

  follow(doc);
  return { follow };
}
