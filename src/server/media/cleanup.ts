import { auditStatement } from "../audit";
import { requireRole } from "../auth/policy";
import { conflictGuard } from "../content/drafts";
import type { Actor } from "../content/types";
import { AppError } from "../http/errors";

export async function softDeleteMedia(env: AppEnv, actor: Actor, id: string): Promise<void> {
  requireRole(actor, "admin");
  const row = await env.DB.prepare("SELECT status FROM media WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  if (!row) throw new AppError("MEDIA_NOT_FOUND", 404, "Media was not found");
  const refs = await env.DB.prepare("SELECT COUNT(*) AS count FROM media_references WHERE media_id = ?")
    .bind(id)
    .first<{ count: number }>();
  if ((refs?.count ?? 0) > 0) throw new AppError("MEDIA_IN_USE", 409, "Media is still referenced");
  try {
    await env.DB.batch([
      conflictGuard(env.DB, "SELECT COUNT(*) FROM media_references WHERE media_id = ?", id, 0),
      conflictGuard(env.DB, "SELECT COUNT(*) FROM media WHERE id = ? AND status = 'active'", id, 1),
      env.DB.prepare(
        "UPDATE media SET status = 'deleted', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      ).bind(id),
      auditStatement(env.DB, actor, "media.delete", id),
    ]);
  } catch {
    throw new AppError("MEDIA_CONFLICT", 409, "Media changed before it could be deleted");
  }
}

export async function cleanupMedia(
  env: AppEnv,
  now: Date,
): Promise<{ deleted: number; skipped: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, r2_key, checksum_sha256, status, deleted_at
     FROM media WHERE status IN ('deleted', 'orphaned')
     ORDER BY deleted_at, id LIMIT 100`,
  ).all<{
    id: string;
    r2_key: string;
    checksum_sha256: string;
    status: "deleted" | "orphaned";
    deleted_at: string | null;
  }>();
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  let deleted = 0;
  let skipped = 0;
  for (const row of rows.results) {
    if (!row.deleted_at || new Date(row.deleted_at).getTime() > cutoff) {
      skipped++;
      continue;
    }
    if (row.status === "deleted") {
      try {
        const results = await env.DB.batch([
          conflictGuard(env.DB, "SELECT COUNT(*) FROM media_references WHERE media_id = ?", row.id, 0),
          env.DB.prepare("UPDATE media SET status = 'orphaned' WHERE id = ? AND status = 'deleted'").bind(row.id),
        ]);
        if ((results[1]?.meta.changes ?? 0) !== 1) {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue;
      }
    }
    const object = await env.MEDIA.head(row.r2_key);
    if (object && object.customMetadata?.checksumSha256 !== row.checksum_sha256) {
      console.warn(JSON.stringify({ event: "media_cleanup_checksum_mismatch", mediaId: row.id }));
      skipped++;
      continue;
    }
    try {
      if (object) await env.MEDIA.delete(row.r2_key);
      const result = await env.DB.prepare(
        `DELETE FROM media WHERE id = ? AND status = 'orphaned'
         AND NOT EXISTS (SELECT 1 FROM media_references WHERE media_id = ?)`,
      )
        .bind(row.id, row.id)
        .run();
      if ((result.meta.changes ?? 0) === 1) deleted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { deleted, skipped };
}
