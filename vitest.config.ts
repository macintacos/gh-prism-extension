import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  // Vitest stubs CSS imports, ?raw too; the sheets the tests read are opted in.
  test: { css: { include: [/diffs\/order\.css/, /diffstat-view\.css/, /loading-view\.css/] } },
});
