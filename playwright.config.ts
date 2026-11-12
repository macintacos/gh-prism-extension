import { defineConfig } from "@playwright/test";

// `.e2e.ts`, not `.spec.ts`: Vitest's default include would collect a spec.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  fullyParallel: true,
  // One per CPU on CI's runner; Playwright's default is half the CPUs.
  workers: process.env.CI ? 4 : undefined,
  // CI's runner stalls for seconds at a time under 4 workers: past expect's 5 s default.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  projects: [
    // `mise run e2e` installs no headless shell, which is what a `page` fixture launches by default.
    { name: "chromium", use: { browserName: "chromium", channel: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
