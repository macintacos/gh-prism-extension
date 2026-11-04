import { amoFetch } from "../../scripts/tasks/amo/api";
import { routedFetch } from "./fetch";

/** A route answering `code` with `body`. */
export const status =
  (code: number, body = "") =>
  () =>
    Promise.resolve(new Response(body, { status: code }));

/** An `amoFetch` over `routedFetch(routes)`, with a fixed clock and nonce. */
export const amoWith = (routes: Record<string, () => Promise<Response>>) => {
  const fetch = routedFetch(routes);
  return {
    fetch,
    amo: amoFetch(
      { issuer: "user:1:2", secret: "s3cret" },
      fetch,
      () => 1000,
      () => "nonce",
    ),
  };
};
