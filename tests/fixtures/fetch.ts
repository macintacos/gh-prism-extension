import { vi } from "vitest";

/** A fetch mock answering each URL from `routes`, and every other URL with a 500. */
export function routedFetch(routes: Record<string, () => Promise<Response>>) {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const route = routes[String(input)];
    return route ? route() : Promise.resolve(new Response("", { status: 500 }));
  });
}

/** Routes whose responses wait until each callback in `release` runs. */
export function heldResponses(): {
  release: (() => void)[];
  held: (body: string) => () => Promise<Response>;
} {
  const release: (() => void)[] = [];
  const held = (body: string) => () =>
    new Promise<Response>((resolve) => release.push(() => resolve(new Response(body))));
  return { release, held };
}
