import { z } from "zod";
import type { ContentType, Snapshot } from "./types";

const title = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(500);
const body = z.string().trim().min(1).max(10_000);
const optionalText = z.string().max(10_000);
const mediaId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

function isSafeTarget(value: string): boolean {
  if (value.startsWith("#")) {
    return /^#[A-Za-z][A-Za-z0-9_-]*$/.test(value);
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return !/[\u0000-\u001f\u007f]/.test(value);
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const target = z.string().max(2_048).refine(isSafeTarget, "Unsafe URL target");
const list = <T extends z.ZodType>(item: T) => z.array(item).max(100);

const linkSchema = z.object({ label: title, target }).strict();
const textItemSchema = z.object({ title, body }).strict();
const seoSchema = z
  .object({
    title,
    description,
    image: z.object({ mediaId, alt: z.string().max(500) }).strict().nullable(),
  })
  .strict();
const sharedSchema = z.object({ primaryMediaId: mediaId.nullable() }).strict();

const homepageDataSchema = z
  .object({
    title,
    description,
    nav: z
      .object({
        brandTitle: title,
        brandSubtitle: description,
        languageSwitchLabel: title,
        links: list(linkSchema),
      })
      .strict(),
    hero: z
      .object({
        eyebrow: title,
        title,
        body,
        primary: linkSchema,
        secondary: linkSchema,
        visual: z
          .object({
            eyebrow: title,
            pills: list(textItemSchema),
            stats: list(z.object({ value: title, label: title }).strict()),
          })
          .strict(),
      })
      .strict(),
    about: z.object({ eyebrow: title, title, body }).strict(),
    capabilities: z
      .object({ eyebrow: title, title, items: list(textItemSchema) })
      .strict(),
    products: z
      .object({ eyebrow: title, title, body, items: list(textItemSchema) })
      .strict(),
    insights: z
      .object({
        eyebrow: title,
        title,
        body,
        emptyMessage: title,
        cardLabel: title,
        ctaLabel: title,
        ctaTarget: target,
      })
      .strict(),
    contact: z
      .object({
        eyebrow: title,
        title,
        cards: list(
          z
            .object({
              title,
              body: optionalText.optional(),
              list: list(z.string().max(500)).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    footer: z
      .object({ title, description: z.string().max(500), note: optionalText })
      .strict(),
    seo: seoSchema,
    primaryMediaAlt: z.string().max(500),
  })
  .strict();

const insightDataSchema = z
  .object({
    title,
    description,
    bodyMarkdown: z.string().min(1).max(200_000),
    author: title,
    displayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    seo: seoSchema,
    primaryMediaAlt: z.string().max(500),
  })
  .strict();

const settingsDataSchema = z
  .object({
    siteName: title,
    companyName: title,
    tagline: description,
    seo: seoSchema,
    primaryMediaAlt: z.string().max(500),
  })
  .strict();

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);

export const localeSchema = z.enum(["vi", "en", "ja"]);

const schemas = {
  homepage: z
    .object({
      type: z.literal("homepage"),
      slug: slugSchema,
      shared: sharedSchema,
      data: homepageDataSchema,
    })
    .strict(),
  insight: z
    .object({
      type: z.literal("insight"),
      slug: slugSchema,
      shared: sharedSchema,
      data: insightDataSchema,
    })
    .strict(),
  settings: z
    .object({
      type: z.literal("settings"),
      slug: slugSchema,
      shared: sharedSchema,
      data: settingsDataSchema,
    })
    .strict(),
} satisfies Record<ContentType, z.ZodType>;

export function validateSnapshot(type: ContentType, input: unknown): Snapshot {
  return schemas[type].parse(input) as Snapshot;
}

export function collectMediaIds(snapshot: Snapshot): string[] {
  const ids = new Set<string>();
  if (snapshot.shared.primaryMediaId) ids.add(snapshot.shared.primaryMediaId);

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.mediaId === "string") ids.add(record.mediaId);
    Object.values(record).forEach(visit);
  };
  visit(snapshot.data);

  if (snapshot.type === "insight") {
    const markdown = (snapshot.data as { bodyMarkdown: string }).bodyMarkdown;
    for (const match of markdown.matchAll(/\/media\/([A-Za-z0-9_-]+)/g)) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return [...ids].sort();
}
