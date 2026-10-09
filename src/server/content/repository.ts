import type {
  Actor,
  ContentType,
  Draft,
  HomepageData,
  InsightData,
  Locale,
  LocaleData,
  SettingsData,
  SharedData,
} from "./types";
import { auditStatement } from "../audit";
import { AppError } from "../http/errors";
import { validateSnapshot, validateSlug } from "./schema";

const LOCALES: Locale[] = ["vi", "en", "ja"];

interface DraftRow {
  item_id: string;
  type: ContentType;
  slug: string;
  shared_data_json: string;
  shared_version: number;
  locale: Locale;
  draft_data_json: string;
  draft_version: number;
  published_revision_id: string | null;
}

export interface DraftStatus {
  itemId: string;
  type: ContentType;
  slug: string;
  locale: Locale;
  version: number;
  updatedBy: string;
  updatedAt: string;
  publishedRevisionId: string | null;
}

function initialSeo() {
  return { title: "Draft", description: "Draft", image: null };
}

function initialData(type: ContentType): LocaleData {
  if (type === "insight") {
    return {
      title: "Draft",
      description: "Draft",
      bodyMarkdown: "Draft",
      author: "TNC Handicraft",
      displayDate: "2026-10-09",
      seo: initialSeo(),
      primaryMediaAlt: "",
    } satisfies InsightData;
  }
  if (type === "settings") {
    return {
      siteName: "TNC Handicraft",
      companyName: "TNC Handicraft",
      tagline: "Draft",
      seo: initialSeo(),
      primaryMediaAlt: "",
    } satisfies SettingsData;
  }
  return {
    title: "Draft",
    description: "Draft",
    nav: {
      brandTitle: "TNC Handicraft",
      brandSubtitle: "Draft",
      languageSwitchLabel: "Language",
      links: [],
    },
    hero: {
      eyebrow: "Draft",
      title: "Draft",
      body: "Draft",
      primary: { label: "Draft", target: "/" },
      secondary: { label: "Draft", target: "/" },
      visual: { eyebrow: "Draft", pills: [], stats: [] },
    },
    about: { eyebrow: "Draft", title: "Draft", body: "Draft" },
    capabilities: { eyebrow: "Draft", title: "Draft", items: [] },
    products: { eyebrow: "Draft", title: "Draft", body: "Draft", items: [] },
    insights: {
      eyebrow: "Draft",
      title: "Draft",
      body: "Draft",
      emptyMessage: "Draft",
      cardLabel: "Draft",
      ctaLabel: "Draft",
      ctaTarget: "/",
    },
    contact: { eyebrow: "Draft", title: "Draft", cards: [] },
    footer: { title: "TNC Handicraft", description: "Draft", note: "" },
    seo: initialSeo(),
    primaryMediaAlt: "",
  } satisfies HomepageData;
}

export async function createItem(
  db: D1Database,
  actor: Actor,
  type: ContentType,
  slug: string,
): Promise<string> {
  let safeSlug: string;
  try {
    safeSlug = validateSlug(slug);
  } catch {
    throw new AppError("INVALID_CONTENT", 422, "Slug is invalid");
  }
  const itemId = crypto.randomUUID();
  const shared: SharedData = { primaryMediaId: null };
  const data = initialData(type);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO content_items
           (id, type, slug, shared_data_json, created_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(itemId, type, safeSlug, JSON.stringify(shared), actor.id),
      ...LOCALES.map((locale) =>
        db
          .prepare(
            `INSERT INTO content_locales
             (id, content_item_id, locale, draft_data_json, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(`${itemId}:${locale}`, itemId, locale, JSON.stringify(data), actor.id),
      ),
      auditStatement(db, actor, "content.create", itemId),
    ]);
  } catch {
    throw new AppError("CONTENT_CONFLICT", 409, "Slug or singleton content already exists");
  }
  return itemId;
}

export async function getDraft(
  db: D1Database,
  itemId: string,
  locale: Locale,
): Promise<Draft> {
  const row = await db
    .prepare(
      `SELECT i.id AS item_id, i.type, i.slug, i.shared_data_json, i.shared_version,
              l.locale, l.draft_data_json, l.draft_version, l.published_revision_id
       FROM content_items i
       JOIN content_locales l ON l.content_item_id = i.id
       WHERE i.id = ? AND l.locale = ?`,
    )
    .bind(itemId, locale)
    .first<DraftRow>();
  if (!row) throw new AppError("DRAFT_NOT_FOUND", 404, "Draft was not found");

  const snapshot = validateSnapshot(row.type, {
    type: row.type,
    slug: row.slug,
    shared: JSON.parse(row.shared_data_json),
    data: JSON.parse(row.draft_data_json),
  });
  return {
    itemId: row.item_id,
    locale: row.locale,
    version: row.draft_version,
    sharedVersion: row.shared_version,
    snapshot,
    publishedRevisionId: row.published_revision_id,
  };
}

export async function listDrafts(db: D1Database): Promise<DraftStatus[]> {
  const rows = await db
    .prepare(
      `SELECT i.id AS item_id, i.type, i.slug, l.locale, l.draft_version,
              l.updated_by, l.updated_at, l.published_revision_id
       FROM content_items i
       JOIN content_locales l ON l.content_item_id = i.id
       ORDER BY l.updated_at DESC, i.id, l.locale`,
    )
    .all<{
      item_id: string;
      type: ContentType;
      slug: string;
      locale: Locale;
      draft_version: number;
      updated_by: string;
      updated_at: string;
      published_revision_id: string | null;
    }>();
  return rows.results.map((row) => ({
    itemId: row.item_id,
    type: row.type,
    slug: row.slug,
    locale: row.locale,
    version: row.draft_version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    publishedRevisionId: row.published_revision_id,
  }));
}
