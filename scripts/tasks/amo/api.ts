import { createHmac } from "node:crypto";

/** gh-prism's permanent AMO id; keep in sync with `wxt.config.ts`'s gecko id. */
export const ADDON_GUID = "gh-prism@excessive.dev";
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

/** A fetch for paths under `AMO_API`, each call signed with a fresh JWT. */
export function amoFetch(
  credentials: AmoCredentials,
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  now: () => number,
  nonce: () => string,
): AmoFetch {
  return (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `JWT ${amoJwt(credentials, now(), nonce())}`);
    return fetch(`${AMO_API}${path}`, { ...init, headers });
  };
}

export const credentialsRefused = (status: number) =>
  `AMO refused FIREFOX_JWT_ISSUER and FIREFOX_JWT_SECRET (HTTP ${status}); generate new ones at ${AMO_KEYS_PAGE}`;

/** Why AMO can't take a release (or a Firefox-only re-run of `firefoxOnly`), or null. */
export async function checkAmo(amo: AmoFetch, firefoxOnly?: string): Promise<string | null> {
  const addon = `/addons/addon/${ADDON_GUID}/`;
  const { status } = await amo(addon);
  if (status === 401 || status === 403) {
    return credentialsRefused(status);
  }
  if (status === 404) {
    return `AMO has no add-on ${ADDON_GUID} yet; create it once with: gh workflow run amo-listing.yml --ref trunk`;
  }
  if (status !== 200) {
    return `AMO answered HTTP ${status} for ${ADDON_GUID}`;
  }
  if (firefoxOnly === undefined) {
    return null;
  }

  const version = await amo(`${addon}versions/${firefoxOnly}/`);
  if (version.status === 200) {
    return `AMO already has gh-prism ${firefoxOnly}; nothing to re-run`;
  }
  return version.status === 404
    ? null
    : `AMO answered HTTP ${version.status} for version ${firefoxOnly}`;
}
