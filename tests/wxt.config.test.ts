import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConfigEnv, ResolvedPublicFile, Wxt, WxtHooks } from "wxt";
import { GRAMMAR_WASM, RUNTIME_WASM, WASM_DIR } from "../utils/structural/packaged";
import config from "../wxt.config";

const envFor = (browser: string, command: ConfigEnv["command"] = "build"): ConfigEnv => ({
  browser,
  manifestVersion: 3,
  command,
  mode: command === "build" ? "production" : "development",
});

const manifestFor = async (browser: string, command?: ConfigEnv["command"]) => {
  const manifest = config.manifest;
  if (typeof manifest !== "function") throw new Error("manifest must be a function of ConfigEnv");
  return manifest(envFor(browser, command));
};

const viteConfigFor = async (browser: string) => {
  const vite = config.vite;
  if (!vite) throw new Error("vite config missing");
  return vite(envFor(browser));
};

const cssTargetFor = async (browser: string) => (await viteConfigFor(browser)).build?.cssTarget;

const entityDecoderFor = async (browser: string) => {
  const alias = (await viteConfigFor(browser)).resolve?.alias;
  if (!Array.isArray(alias)) throw new Error("resolve.alias must be an array");
  return alias.find((entry) => String(entry.find) === "/^decode-named-character-reference$/")
    ?.replacement;
};

describe("wxt.config", () => {
  it("builds Manifest V3 for every browser", () => {
    expect(config.manifestVersion).toBe(3);
  });

  it("gives the Firefox build its permanent gecko settings", async () => {
    const manifest = await manifestFor("firefox");

    expect(manifest.browser_specific_settings?.gecko).toEqual({
      id: "gh-prism@excessive.dev",
      strict_min_version: "147.0",
      data_collection_permissions: { required: ["none"] },
    });
  });

  it("leaves browser-specific settings out of the Chrome build", async () => {
    const manifest = await manifestFor("chrome");

    expect(manifest.browser_specific_settings).toBeUndefined();
  });

  it("targets each browser's CSS floor", async () => {
    const firefox = await cssTargetFor("firefox");
    const chrome = await cssTargetFor("chrome");

    expect(firefox).toBe("firefox147");
    expect(chrome).toBe("chrome123");
  });

  it("bundles the entity decoder that never assigns innerHTML", async () => {
    const firefox = await entityDecoderFor("firefox");
    const chrome = await entityDecoderFor("chrome");

    expect(firefox).toMatch(/[/\\]decode-named-character-reference[/\\]index\.js$/);
    expect(chrome).toBe(firefox);
    expect(readFileSync(firefox ?? "", "utf8")).not.toContain("innerHTML");
  });

  it("lets each browser's extension pages compile WebAssembly under its default policy", async () => {
    const chrome = await manifestFor("chrome");
    const firefox = await manifestFor("firefox");

    expect(chrome.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    });
    expect(firefox.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; upgrade-insecure-requests;",
    });
  });

  // WXT's dev background reaches the dev server over ws://localhost, which the directive would turn into wss://.
  it("leaves the Firefox dev build's dev-server socket unencrypted", async () => {
    const firefox = await manifestFor("firefox", "serve");

    expect(firefox.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval';",
    });
  });

  it.each([
    ["chrome", ["storage", "declarativeNetRequestWithHostAccess", "offscreen"]],
    ["firefox", ["storage", "declarativeNetRequestWithHostAccess"]],
  ])("asks %s for no permission beyond its install set", async (browser, permissions) => {
    const manifest = await manifestFor(browser);

    expect(manifest.permissions).toEqual(permissions);
    expect(manifest.host_permissions).toEqual([
      "https://github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ]);
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(manifest).not.toHaveProperty("web_accessible_resources");
  });

  it("copies each packaged WebAssembly file into the build", async () => {
    const hooks: Partial<WxtHooks> = config.hooks ?? {};
    const hook = hooks["build:publicAssets"];
    if (!hook) throw new Error("build:publicAssets hook missing");
    const files: ResolvedPublicFile[] = [];

    await hook({} as Wxt, files);

    expect(files.map((file) => file.relativeDest).sort()).toEqual(
      [RUNTIME_WASM, ...Object.values(GRAMMAR_WASM)].map((file) => `${WASM_DIR}/${file}`).sort(),
    );
    for (const file of files)
      expect(existsSync("absoluteSrc" in file ? file.absoluteSrc : "")).toBe(true);
  });
});
