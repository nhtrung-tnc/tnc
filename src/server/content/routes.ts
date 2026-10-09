import type { ContentType, Locale } from "./types";

export function publishedPath(
  type: ContentType,
  locale: Locale,
  slug: string,
): string {
  if (type === "homepage") return `/${locale}/`;
  if (type === "settings") return `/${locale}/_settings/`;
  return `/${locale}/insights/${slug}/`;
}

export function redirectStatements(
  db: D1Database,
  actorId: string,
  locale: Locale,
  oldPath: string | null,
  newPath: string,
): D1PreparedStatement[] {
  if (!oldPath || oldPath === newPath) return [];
  return [
    db.prepare("DELETE FROM redirects WHERE old_path = ?").bind(newPath),
    db
      .prepare("UPDATE redirects SET new_path = ? WHERE locale = ? AND new_path = ?")
      .bind(newPath, locale, oldPath),
    db
      .prepare(
        `INSERT INTO redirects (id, locale, old_path, new_path, created_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(old_path) DO UPDATE SET
           locale = excluded.locale,
           new_path = excluded.new_path,
           created_by = excluded.created_by,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(crypto.randomUUID(), locale, oldPath, newPath, actorId),
  ];
}
