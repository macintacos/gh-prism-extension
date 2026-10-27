import { defineConfig } from "@playwright/test";

// `.e2e.ts`, not `.spec.ts`: Vitest's default include would collect a spec.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: true,
  // One per CPU on CI's runner; Playwright's default is half the CPUs.
  workers: process.env.CI ? 4 : undefined,
});
