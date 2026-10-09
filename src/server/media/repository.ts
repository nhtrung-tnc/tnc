export interface MediaRecord {
  id: string;
  r2Key: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  status: "active" | "deleted" | "orphaned";
  uploadedBy: string;
  createdAt: string;
  deletedAt: string | null;
  existing: boolean;
}

interface MediaRow {
  id: string;
  r2_key: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  checksum_sha256: string;
  status: MediaRecord["status"];
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
}

export function mapMedia(row: MediaRow, existing = false): MediaRecord {
  return {
    id: row.id,
    r2Key: row.r2_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    checksumSha256: row.checksum_sha256,
    status: row.status,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    existing,
  };
}

const mediaColumns = `id, r2_key, original_filename, mime_type, byte_size, width,
  height, checksum_sha256, status, uploaded_by, created_at, deleted_at`;

export async function findActiveByChecksum(
  db: D1Database,
  checksum: string,
): Promise<MediaRecord | null> {
  const row = await db
    .prepare(`SELECT ${mediaColumns} FROM media WHERE checksum_sha256 = ? AND status = 'active'`)
    .bind(checksum)
    .first<MediaRow>();
  return row ? mapMedia(row, true) : null;
}

export async function listMedia(
  db: D1Database,
  options: { cursor?: string; search?: string; limit?: number } = {},
): Promise<{ items: Array<MediaRecord & { references: string[] }>; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const cursor = options.cursor ?? "";
  const search = `%${(options.search ?? "").replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = await db
    .prepare(
      `SELECT ${mediaColumns} FROM media
       WHERE id > ? AND original_filename LIKE ? ESCAPE '\\'
       ORDER BY id LIMIT ?`,
    )
    .bind(cursor, search, limit + 1)
    .all<MediaRow>();
  const page = rows.results.slice(0, limit);
  const items = await Promise.all(
    page.map(async (row) => {
      const refs = await db
        .prepare("SELECT owner_kind || ':' || owner_id AS location FROM media_references WHERE media_id = ? ORDER BY owner_kind, owner_id")
        .bind(row.id)
        .all<{ location: string }>();
      return { ...mapMedia(row), references: refs.results.map(({ location }) => location) };
    }),
  );
  return {
    items,
    nextCursor: rows.results.length > limit ? page.at(-1)?.id ?? null : null,
  };
}
