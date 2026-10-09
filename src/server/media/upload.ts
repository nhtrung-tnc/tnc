import type { Actor } from "../content/types";
import { auditStatement } from "../audit";
import { AppError } from "../http/errors";
import { findActiveByChecksum, mapMedia, type MediaRecord } from "./repository";
import { validateMediaFile } from "./validate";

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function safeFilename(input: string): string {
  const basename = input.split(/[\\/]/).at(-1) ?? "upload";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "upload";
}

export async function uploadMedia(
  env: AppEnv,
  actor: Actor,
  file: File,
): Promise<MediaRecord> {
  const validated = await validateMediaFile(file);
  const digest = await crypto.subtle.digest("SHA-256", validated.bytes.buffer);
  const checksum = hex(digest);
  const existing = await findActiveByChecksum(env.DB, checksum);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const key = `media/${id}.${validated.extension}`;
  const originalFilename = safeFilename(file.name);
  try {
    await env.MEDIA.put(key, validated.bytes, {
      httpMetadata: { contentType: validated.mimeType },
      customMetadata: { checksumSha256: checksum, status: "active" },
    });
  } catch {
    throw new AppError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media storage is unavailable");
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO media
         (id, r2_key, original_filename, mime_type, byte_size, width, height,
          checksum_sha256, status, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).bind(
        id,
        key,
        originalFilename,
        validated.mimeType,
        validated.byteSize,
        validated.width,
        validated.height,
        checksum,
        actor.id,
      ),
      auditStatement(env.DB, actor, "media.upload", id),
    ]);
  } catch {
    const raced = await findActiveByChecksum(env.DB, checksum).catch(() => null);
    try {
      await env.MEDIA.delete(key);
    } catch {
      await env.MEDIA.put(key, validated.bytes, {
        httpMetadata: { contentType: validated.mimeType },
        customMetadata: { checksumSha256: checksum, status: "orphaned" },
      }).catch(() => undefined);
    }
    if (raced) return raced;
    throw new AppError("MEDIA_INDEX_UNAVAILABLE", 503, "Media index is unavailable");
  }

  const row = await env.DB.prepare(
    `SELECT id, r2_key, original_filename, mime_type, byte_size, width, height,
            checksum_sha256, status, uploaded_by, created_at, deleted_at
     FROM media WHERE id = ?`,
  )
    .bind(id)
    .first<Parameters<typeof mapMedia>[0]>();
  if (!row) throw new AppError("MEDIA_INDEX_UNAVAILABLE", 503, "Media index is unavailable");
  return mapMedia(row);
}
