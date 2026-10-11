import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  // Vitest stubs CSS imports, ?raw too; the diff order lives in its stylesheet.
  test: { css: { include: [/diff-order\.css/] } },
});
