import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", env.SITE_ORIGIN)}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
