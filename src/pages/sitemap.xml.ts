import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { publishedPath } from "../server/content/routes";
import { locales } from "../server/site/fallback";
import { listPublished } from "../server/site/queries";
import { publicCacheHeaders } from "../server/site/cache";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const GET: APIRoute = async () => {
  try {
    const publications = (await Promise.all(locales.map((locale) => listPublished(env.DB, locale)))).flat();
    const urls = publications
      .filter(({ snapshot }) => snapshot.type === "homepage" || snapshot.type === "insight")
      .map((entry) => new URL(publishedPath(entry.snapshot.type, entry.locale, entry.snapshot.slug), env.SITE_ORIGIN).toString())
      .filter((value, index, all) => all.indexOf(value) === index);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${xml(url)}</loc></url>`).join("")}</urlset>`;
    const headers = publicCacheHeaders();
    headers.set("Content-Type", "application/xml; charset=utf-8");
    return new Response(body, { headers });
  } catch {
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
};
