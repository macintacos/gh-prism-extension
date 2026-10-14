import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest(), tailwindcss()],
  // Vitest stubs CSS imports, ?raw and ?inline too; the sheets the tests read are opted in.
  test: { css: { include: [/diffs\/order\.css/, /diffstat-view\.css/, /loading-view\.css/] } },
});
