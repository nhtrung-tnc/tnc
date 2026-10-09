import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: cloudflare(),
  output: "server",
  outDir: "./dist",
  publicDir: "./astro-public",
  session: false,
});
