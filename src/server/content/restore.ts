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
import { collectMediaIds, validateSnapshot } from "./schema";
import type { Actor, Draft, Locale, Snapshot } from "./types";

export async function restoreRevision(
  db: D1Database,
  actor: Actor,
  itemId: string,
  locale: Locale,
  revisionId: string,
  expectedVersion: number,
  expectedSharedVersion: number,
): Promise<Draft> {
  requireRole(actor, "admin");
  const current = await getDraft(db, itemId, locale);
  if (
    current.version !== expectedVersion ||
    current.sharedVersion !== expectedSharedVersion
  ) {
    throw new AppError("RESTORE_CONFLICT", 409, "Draft has changed");
  }
  const revision = await db
    .prepare(
      `SELECT r.data_json
       FROM content_revisions r
       JOIN content_locales l ON l.id = r.content_locale_id
       WHERE r.id = ? AND l.content_item_id = ? AND l.locale = ?`,
    )
    .bind(revisionId, itemId, locale)
    .first<{ data_json: string }>();
  if (!revision) {
    throw new AppError("REVISION_NOT_FOUND", 404, "Revision was not found");
  }
  const restored = validateSnapshot(current.snapshot.type, JSON.parse(revision.data_json));
  const drafts = await Promise.all(
    (["vi", "en", "ja"] as Locale[]).map((entry) => getDraft(db, itemId, entry)),
  );
  const snapshots: Snapshot[] = drafts.map((draft) =>
    validateSnapshot(draft.snapshot.type, {
      ...draft.snapshot,
      slug: restored.slug,
      shared: restored.shared,
      data: draft.locale === locale ? restored.data : draft.snapshot.data,
    }),
  );
  await requireActiveMedia(db, [...new Set(snapshots.flatMap(collectMediaIds))]);
  const mediaIds = [...new Set(snapshots.flatMap(collectMediaIds))];

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
          `UPDATE content_items SET slug = ?, shared_data_json = ?,
             shared_version = shared_version + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .bind(restored.slug, JSON.stringify(restored.shared), itemId),
      db
        .prepare(
          `UPDATE content_locales SET updated_by = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE content_item_id = ?`,
        )
        .bind(actor.id, itemId),
      db
        .prepare(
          `UPDATE content_locales SET draft_data_json = ?,
             draft_version = draft_version + 1, draft_source_revision_id = ?,
             updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE content_item_id = ? AND locale = ?`,
        )
        .bind(JSON.stringify(restored.data), revisionId, actor.id, itemId, locale),
      ...snapshots.flatMap((snapshot, index) =>
        draftReferenceStatements(db, `${itemId}:${drafts[index]!.locale}`, snapshot),
      ),
      auditStatement(db, actor, "content.restore", `${itemId}:${locale}`),
    ]);
  } catch {
    const latest = await getDraft(db, itemId, locale);
    if (
      latest.version !== expectedVersion ||
      latest.sharedVersion !== expectedSharedVersion
    ) {
      throw new AppError("RESTORE_CONFLICT", 409, "Draft has changed");
    }
    throw new AppError("RESTORE_FAILED", 500, "Revision could not be restored");
  }
  return getDraft(db, itemId, locale);
}
