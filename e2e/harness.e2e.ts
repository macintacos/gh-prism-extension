import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { launchContext } from "./harness";

test("a browser launch that stalls is abandoned and retried on a fresh profile", async () => {
  const profiles: string[] = [];
  const context = { close: async () => {} };

  const launched = await launchContext((profile) => {
    profiles.push(profile);
    return profiles.length === 1 ? new Promise<never>(() => {}) : Promise.resolve(context);
  }, 50);

  expect(launched).toEqual({ context, profile: profiles[1] });
  expect(new Set(profiles).size).toBe(2);
  await Promise.all(profiles.map((profile) => rm(profile, { recursive: true, force: true })));
});
