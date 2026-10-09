import { auditStatement } from "../audit";
import { AppError } from "../http/errors";
import {
  collectMediaIds,
  validateLocaleData,
  validateSharedData,
  validateSnapshot,
} from "./schema";
import { getDraft } from "./repository";
import type {
  Actor,
  Draft,
  Locale,
  LocaleData,
  SharedData,
  Snapshot,
} from "./types";

export function conflictGuard(
  db: D1Database,
  sql: string,
  ...values: unknown[]
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT CASE WHEN COALESCE((${sql}), -1) = ?
       THEN 1 ELSE json_extract('invalid', '$') END`,
    )
    .bind(...values);
}

export async function requireActiveMedia(
  db: D1Database,
  mediaIds: string[],
): Promise<void> {
  for (const id of mediaIds) {
    const row = await db
      .prepare("SELECT status FROM media WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    if (!row || row.status !== "active") {
      throw new AppError("MEDIA_UNAVAILABLE", 422, `Media ${id} is unavailable`);
    }
  }
}

export function draftReferenceStatements(
  db: D1Database,
  ownerId: string,
  snapshot: Snapshot,
): D1PreparedStatement[] {
  return [
    db
      .prepare("DELETE FROM media_references WHERE owner_kind = 'draft' AND owner_id = ?")
      .bind(ownerId),
    ...collectMediaIds(snapshot).map((mediaId) =>
      db
        .prepare(
          "INSERT INTO media_references (media_id, owner_kind, owner_id) VALUES (?, 'draft', ?)",
        )
        .bind(mediaId, ownerId),
    ),
  ];
}

export async function saveDraft(
  db: D1Database,
  actor: Actor,
  itemId: string,
  locale: Locale,
  expectedVersion: number,
  data: LocaleData,
): Promise<Draft> {
  const current = await getDraft(db, itemId, locale);
  if (current.version !== expectedVersion) {
    throw new AppError("DRAFT_CONFLICT", 409, "Draft has changed");
  }
  let snapshot: Snapshot;
  try {
    const safeData = validateLocaleData(current.snapshot.type, data);
    snapshot = validateSnapshot(current.snapshot.type, {
      ...current.snapshot,
      data: safeData,
    });
  } catch {
    throw new AppError("INVALID_CONTENT", 422, "Draft content is invalid");
  }
  const mediaIds = collectMediaIds(snapshot);
  await requireActiveMedia(db, mediaIds);

  try {
    await db.batch([
      conflictGuard(
        db,
        "SELECT draft_version FROM content_locales WHERE content_item_id = ? AND locale = ?",
        itemId,
        locale,
        expectedVersion,
      ),
      db
        .prepare(
          `UPDATE content_locales
           SET draft_data_json = ?, draft_version = draft_version + 1,
               updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE content_item_id = ? AND locale = ?`,
        )
        .bind(JSON.stringify(snapshot.data), actor.id, itemId, locale),
      ...draftReferenceStatements(db, `${itemId}:${locale}`, snapshot),
      auditStatement(db, actor, "draft.save", `${itemId}:${locale}`),
    ]);
  } catch {
    throw new AppError("DRAFT_CONFLICT", 409, "Draft has changed");
  }
  return getDraft(db, itemId, locale);
}

export async function saveShared(
  db: D1Database,
  actor: Actor,
  itemId: string,
  expectedSharedVersion: number,
  shared: SharedData,
): Promise<number> {
  const drafts = await Promise.all(
    (["vi", "en", "ja"] as Locale[]).map((locale) => getDraft(db, itemId, locale)),
  );
  if (drafts[0]?.sharedVersion !== expectedSharedVersion) {
    throw new AppError("SHARED_CONFLICT", 409, "Shared content has changed");
  }
  let safeShared: SharedData;
  let snapshots: Snapshot[];
  try {
    safeShared = validateSharedData(shared);
    snapshots = drafts.map((draft) =>
      validateSnapshot(draft.snapshot.type, {
        ...draft.snapshot,
        shared: safeShared,
      }),
    );
  } catch {
    throw new AppError("INVALID_CONTENT", 422, "Shared content is invalid");
  }
  const allMediaIds = [...new Set(snapshots.flatMap(collectMediaIds))];
  await requireActiveMedia(db, allMediaIds);

  try {
    await db.batch([
      conflictGuard(
        db,
        "SELECT shared_version FROM content_items WHERE id = ?",
        itemId,
        expectedSharedVersion,
      ),
      db
        .prepare(
          `UPDATE content_items
           SET shared_data_json = ?, shared_version = shared_version + 1,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .bind(JSON.stringify(safeShared), itemId),
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
      auditStatement(db, actor, "shared.save", itemId),
    ]);
  } catch {
    throw new AppError("SHARED_CONFLICT", 409, "Shared content has changed");
  }
  return expectedSharedVersion + 1;
}
