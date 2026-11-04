import { describe, expect, it } from "vitest";
import type { ConfigEnv } from "wxt";
import config from "../wxt.config";

const envFor = (browser: string): ConfigEnv => ({
  browser,
  manifestVersion: 3,
  command: "build",
  mode: "production",
});

const manifestFor = async (browser: string) => {
  const manifest = config.manifest;
  if (typeof manifest !== "function") throw new Error("manifest must be a function of ConfigEnv");
  return manifest(envFor(browser));
};

const cssTargetFor = async (browser: string) => {
  const vite = config.vite;
  if (!vite) throw new Error("vite config missing");
  const viteConfig = await vite(envFor(browser));
  return viteConfig.build?.cssTarget;
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
});
