import { createHmac } from "node:crypto";

/** gh-prism's permanent AMO id; keep in sync with `wxt.config.ts`'s gecko id and `release.yml`'s `FIREFOX_EXTENSION_ID`. */
export const ADDON_GUID = "gh-prism@excessive.dev";
export const ADDON_PATH = `/addons/addon/${ADDON_GUID}/`;
export const AMO_API = "https://addons.mozilla.org/api/v5";
export const AMO_PAGE = "https://addons.mozilla.org/firefox/addon/gh-prism/";
export const AMO_KEYS_PAGE = "https://addons.mozilla.org/developers/addon/api/key/";

export interface AmoCredentials {
  issuer: string;
  secret: string;
}

export type AmoFetch = (path: string, init?: RequestInit) => Promise<Response>;

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An HS256 JWT for AMO's API, valid for 60 seconds from `iatSeconds` (AMO allows 300). */
export function amoJwt(credentials: AmoCredentials, iatSeconds: number, jti: string): string {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    iss: credentials.issuer,
    jti,
    iat: iatSeconds,
    exp: iatSeconds + 60,
  });
  const signature = createHmac("sha256", credentials.secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** A fetch for paths under `AMO_API`, each call signed with a fresh JWT; `nowSeconds` returns seconds since the epoch. */
export function amoFetch(
  credentials: AmoCredentials,
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  nowSeconds: () => number,
  nonce: () => string,
): AmoFetch {
  return (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `JWT ${amoJwt(credentials, nowSeconds(), nonce())}`);
    return fetch(`${AMO_API}${path}`, { ...init, headers });
  };
}

const credentialsRefused = (status: number) =>
  `AMO refused FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET (HTTP ${status}); generate new ones at ${AMO_KEYS_PAGE}`;

/** Whether AMO lists gh-prism's add-on, or why AMO couldn't say. */
export async function addonStatus(
  amo: AmoFetch,
): Promise<{ listed: boolean } | { problem: string }> {
  const { status } = await amo(ADDON_PATH);
  if (status === 200 || status === 404) return { listed: status === 200 };
  return {
    problem:
      status === 401 || status === 403
        ? credentialsRefused(status)
        : `AMO answered HTTP ${status} for ${ADDON_GUID}`,
  };
}

/** Why AMO can't take a release (or a Firefox-only re-run of `firefoxOnly`), or null. */
export async function checkAmo(amo: AmoFetch, firefoxOnly?: string): Promise<string | null> {
  const addon = await addonStatus(amo);
  if ("problem" in addon) return addon.problem;
  if (!addon.listed) {
    return `AMO has no add-on ${ADDON_GUID} yet; create it once with: gh workflow run amo-listing.yml --ref trunk`;
  }
  if (firefoxOnly === undefined) {
    return null;
  }

  const version = await amo(`${ADDON_PATH}versions/${firefoxOnly}/`);
  if (version.status === 200) {
    return `AMO already has gh-prism ${firefoxOnly}; nothing to re-run`;
  }
  return version.status === 404
    ? null
    : `AMO answered HTTP ${version.status} for version ${firefoxOnly}`;
}
