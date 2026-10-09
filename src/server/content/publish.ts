import { auditStatement } from "../audit";
import { requireRole } from "../auth/policy";
import { AppError } from "../http/errors";
import {
  conflictGuard,
  draftReferenceStatements,
  mediaActiveGuards,
  requireActiveMedia,
} from "./drafts";
import { getDraft } from "./repository";
import { collectMediaIds, validateSharedData, validateSlug, validateSnapshot } from "./schema";
import { publishedPath, redirectStatements } from "./routes";
import type { Actor, Locale, SharedData, Snapshot } from "./types";

async function currentRoute(
  db: D1Database,
  itemId: string,
  locale: Locale,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT path FROM published_routes WHERE item_id = ? AND locale = ?")
    .bind(itemId, locale)
    .first<{ path: string }>();
  return row?.path ?? null;
}

async function affectedPaths(
  db: D1Database,
  itemId: string,
  locale: Locale,
  oldPath: string | null,
  newPath: string,
): Promise<string[]> {
  const alternates = await db
    .prepare("SELECT path FROM published_routes WHERE item_id = ?")
    .bind(itemId)
    .all<{ path: string }>();
  return [
    newPath,
    ...(oldPath ? [oldPath] : []),
    `/${locale}/`,
    `/${locale}/insights/`,
    "/sitemap.xml",
    ...alternates.results.map(({ path }) => path),
  ].filter((path, index, all) => all.indexOf(path) === index);
}

async function conflictOrFailure(
  db: D1Database,
  itemId: string,
  locale: Locale,
  draftVersion: number,
  sharedVersion: number,
): Promise<AppError> {
  try {
    const current = await getDraft(db, itemId, locale);
    if (
      current.version !== draftVersion ||
      current.sharedVersion !== sharedVersion
    ) {
      return new AppError("PUBLISH_CONFLICT", 409, "Draft has changed");
    }
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return error;
  }
  return new AppError("PUBLISH_FAILED", 500, "Publishing failed");
}

export async function publishLocale(
  db: D1Database,
  actor: Actor,
  itemId: string,
  locale: Locale,
  expectedVersion: number,
  expectedSharedVersion: number,
): Promise<{ revisionId: string; affectedPaths: string[] }> {
  requireRole(actor, "admin");
  const draft = await getDraft(db, itemId, locale);
  if (
    draft.version !== expectedVersion ||
    draft.sharedVersion !== expectedSharedVersion
  ) {
    throw new AppError("PUBLISH_CONFLICT", 409, "Draft has changed");
  }
  const snapshot = validateSnapshot(draft.snapshot.type, draft.snapshot);
  const mediaIds = collectMediaIds(snapshot);
  await requireActiveMedia(db, mediaIds);

  const sequence = await db
    .prepare(
      "SELECT COALESCE(MAX(revision_number), 0) + 1 AS number FROM content_revisions WHERE content_locale_id = ?",
    )
    .bind(`${itemId}:${locale}`)
    .first<{ number: number }>();
  const revisionId = crypto.randomUUID();
  const newPath = publishedPath(snapshot.type, locale, snapshot.slug);
  const oldPath = await currentRoute(db, itemId, locale);
  const paths = await affectedPaths(db, itemId, locale, oldPath, newPath);

  try {
    await db.batch([
      conflictGuard(
        db,
        "SELECT draft_version FROM content_locales WHERE content_item_id = ? AND locale = ?",
        itemId,
        locale,
        expectedVersion,
      ),
      conflictGuard(
        db,
        "SELECT shared_version FROM content_items WHERE id = ?",
        itemId,
        expectedSharedVersion,
      ),
      ...mediaActiveGuards(db, mediaIds),
      db
        .prepare(
          `INSERT INTO content_revisions
           (id, content_locale_id, revision_number, data_json, published_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          revisionId,
          `${itemId}:${locale}`,
          sequence?.number ?? 1,
          JSON.stringify(snapshot),
          actor.id,
        ),
      db
        .prepare(
          `INSERT INTO published_routes (locale, path, item_id, revision_id)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(locale, item_id) DO UPDATE SET
             path = excluded.path, revision_id = excluded.revision_id`,
        )
        .bind(locale, newPath, itemId, revisionId),
      db
        .prepare(
          `UPDATE content_locales
           SET published_revision_id = ?, draft_source_revision_id = ?,
               draft_version = draft_version + 1,
               updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE content_item_id = ? AND locale = ?`,
        )
        .bind(revisionId, revisionId, actor.id, itemId, locale),
      ...mediaIds.map((mediaId) =>
        db
          .prepare(
            "INSERT INTO media_references (media_id, owner_kind, owner_id) VALUES (?, 'revision', ?)",
          )
          .bind(mediaId, revisionId),
      ),
      ...redirectStatements(db, actor.id, locale, oldPath, newPath),
      auditStatement(db, actor, "content.publish", `${itemId}:${locale}`),
    ]);
  } catch {
    throw await conflictOrFailure(
      db,
      itemId,
      locale,
      expectedVersion,
      expectedSharedVersion,
    );
  }
  return { revisionId, affectedPaths: paths };
}

export async function saveItemMetadata(
  db: D1Database,
  actor: Actor,
  itemId: string,
  expectedSharedVersion: number,
  slug: string,
  shared: SharedData,
): Promise<number> {
  let safeSlug: string;
  let safeShared: SharedData;
  try {
    safeSlug = validateSlug(slug);
    safeShared = validateSharedData(shared);
  } catch {
    throw new AppError("INVALID_CONTENT", 422, "Item metadata is invalid");
  }
  const drafts = await Promise.all(
    (["vi", "en", "ja"] as Locale[]).map((entry) => getDraft(db, itemId, entry)),
  );
  if (drafts[0]?.sharedVersion !== expectedSharedVersion) {
    throw new AppError("SHARED_CONFLICT", 409, "Shared content has changed");
  }
  const snapshots: Snapshot[] = drafts.map((draft) =>
    validateSnapshot(draft.snapshot.type, {
      ...draft.snapshot,
      slug: safeSlug,
      shared: safeShared,
    }),
  );
  await requireActiveMedia(db, [...new Set(snapshots.flatMap(collectMediaIds))]);
  const mediaIds = [...new Set(snapshots.flatMap(collectMediaIds))];

  try {
    await db.batch([
      conflictGuard(
        db,
        "SELECT shared_version FROM content_items WHERE id = ?",
        itemId,
        expectedSharedVersion,
      ),
      ...mediaActiveGuards(db, mediaIds),
      db
        .prepare(
          `UPDATE content_items SET slug = ?, shared_data_json = ?,
             shared_version = shared_version + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .bind(safeSlug, JSON.stringify(safeShared), itemId),
      db
        .prepare(
          `UPDATE content_locales SET updated_by = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE content_item_id = ?`,
        )
        .bind(actor.id, itemId),
      ...snapshots.flatMap((snapshot, index) =>
        draftReferenceStatements(db, `${itemId}:${drafts[index]!.locale}`, snapshot),
      ),
      auditStatement(db, actor, "content.metadata.save", itemId),
    ]);
  } catch {
    const current = await getDraft(db, itemId, "vi");
    if (current.sharedVersion !== expectedSharedVersion) {
      throw new AppError("SHARED_CONFLICT", 409, "Shared content has changed");
    }
    throw new AppError("METADATA_SAVE_FAILED", 500, "Item metadata could not be saved");
  }
  return expectedSharedVersion + 1;
}
