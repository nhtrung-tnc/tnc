import { AppError } from "../http/errors";
import { validateSnapshot } from "../content/schema";
import type { ContentType, Locale, Published } from "../content/types";

interface PublishedRow {
  item_id: string;
  locale: Locale;
  revision_id: string;
  published_at: string;
  type: ContentType;
  data_json: string;
}

function mapPublished(row: PublishedRow): Published {
  let input: unknown;
  try {
    input = JSON.parse(row.data_json);
  } catch {
    throw new AppError("INVALID_REVISION", 500, "Published revision is invalid");
  }
  return {
    itemId: row.item_id,
    locale: row.locale,
    revisionId: row.revision_id,
    publishedAt: row.published_at,
    snapshot: validateSnapshot(row.type, input),
  };
}

const publishedSelect = `
  SELECT pr.item_id, pr.locale, pr.revision_id, r.published_at,
         i.type, r.data_json
  FROM published_routes pr
  JOIN content_items i ON i.id = pr.item_id
  JOIN content_locales l
    ON l.content_item_id = pr.item_id AND l.locale = pr.locale
  JOIN content_revisions r
    ON r.id = pr.revision_id
   AND r.content_locale_id = l.id
   AND l.published_revision_id = r.id`;

export async function getPublished(
  db: D1Database,
  locale: Locale,
  path: string,
): Promise<Published | null> {
  const row = await db
    .prepare(`${publishedSelect} WHERE pr.locale = ? AND pr.path = ?`)
    .bind(locale, path)
    .first<PublishedRow>();
  return row ? mapPublished(row) : null;
}

export async function listPublished(
  db: D1Database,
  locale: Locale,
): Promise<Published[]> {
  const rows = await db
    .prepare(`${publishedSelect} WHERE pr.locale = ? ORDER BY r.published_at DESC, pr.path`)
    .bind(locale)
    .all<PublishedRow>();
  return rows.results.map(mapPublished);
}

export async function listItemPublications(
  db: D1Database,
  itemId: string,
): Promise<Published[]> {
  const rows = await db
    .prepare(`${publishedSelect} WHERE pr.item_id = ? ORDER BY pr.locale`)
    .bind(itemId)
    .all<PublishedRow>();
  return rows.results.map(mapPublished);
}

export async function resolveRedirect(
  db: D1Database,
  locale: Locale,
  path: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT new_path FROM redirects WHERE locale = ? AND old_path = ?")
    .bind(locale, path)
    .first<{ new_path: string }>();
  return row?.new_path ?? null;
}
