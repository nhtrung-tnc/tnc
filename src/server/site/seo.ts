import { publishedPath } from "../content/routes";
import type { Locale, Published } from "../content/types";

export interface SeoView {
  title: string;
  description: string;
  canonical: string;
  alternates: Array<{ locale: Locale; href: string }>;
  xDefault: string;
  image: string;
  type: "website" | "article";
  jsonLd: unknown[];
  robots: string;
}

function absolute(origin: string, path: string): string {
  return new URL(path, new URL(origin).origin).toString();
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildSeo(
  content: Published,
  alternates: Published[],
  origin: string,
): SeoView {
  const { snapshot } = content;
  const seo = snapshot.data.seo;
  const path = publishedPath(snapshot.type, content.locale, snapshot.slug);
  const alternateLinks = alternates
    .filter((entry) => entry.itemId === content.itemId)
    .map((entry) => ({
      locale: entry.locale,
      href: absolute(
        origin,
        publishedPath(entry.snapshot.type, entry.locale, entry.snapshot.slug),
      ),
    }))
    .filter(
      (entry, index, all) =>
        all.findIndex(({ locale }) => locale === entry.locale) === index,
    );
  const preferred =
    alternateLinks.find(({ locale }) => locale === "vi") ?? alternateLinks[0];
  const xDefault = snapshot.type === "homepage" ? absolute(origin, "/") : preferred?.href ?? absolute(origin, path);
  const image = seo.image
    ? absolute(origin, `/media/${seo.image.mediaId}`)
    : absolute(origin, "/images/og-default.svg");
  const canonical = absolute(origin, path);
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TNC Handicraft",
    url: new URL(origin).origin,
  };
  const primary =
    snapshot.type === "insight"
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: snapshot.data.title,
          description: seo.description,
          datePublished: snapshot.data.displayDate,
          mainEntityOfPage: canonical,
          inLanguage: content.locale,
          author: { "@type": "Person", name: snapshot.data.author },
          publisher: organization,
          image: [image],
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: snapshot.type === "settings" ? snapshot.data.siteName : snapshot.data.title,
          url: canonical,
          inLanguage: content.locale,
        };
  return {
    title: seo.title,
    description: seo.description,
    canonical,
    alternates: alternateLinks,
    xDefault,
    image,
    type: snapshot.type === "insight" ? "article" : "website",
    jsonLd: [organization, primary],
    robots: "index,follow",
  };
}

export function buildPageSeo(options: {
  title: string;
  description: string;
  path: string;
  locale: Locale;
  origin: string;
  robots?: string;
}): SeoView {
  const canonical = absolute(options.origin, options.path);
  return {
    title: options.title,
    description: options.description,
    canonical,
    alternates: [],
    xDefault: absolute(options.origin, "/"),
    image: absolute(options.origin, "/images/og-default.svg"),
    type: "website",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "TNC Handicraft",
        url: canonical,
        inLanguage: options.locale,
      },
    ],
    robots: options.robots ?? "index,follow",
  };
}
