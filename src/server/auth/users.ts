import type { Actor, Role } from "../content/types";
import { AppError } from "../http/errors";

interface UserRow {
  id: string;
  access_subject: string | null;
  email_normalized: string;
  role: Role;
  active: number;
}

function toActor(row: UserRow, subject: string): Actor {
  if (row.active !== 1) {
    throw new AppError("USER_DISABLED", 403, "This account is disabled");
  }
  return {
    id: row.id,
    subject,
    email: row.email_normalized,
    role: row.role,
  };
}

async function bySubject(db: D1Database, subject: string): Promise<UserRow | null> {
  return db
    .prepare(
      "SELECT id, access_subject, email_normalized, role, active FROM users WHERE access_subject = ?",
    )
    .bind(subject)
    .first<UserRow>();
}

export async function findOrLinkUser(
  db: D1Database,
  subject: string,
  email: string,
): Promise<Actor> {
  const linked = await bySubject(db, subject);
  if (linked) return toActor(linked, subject);

  const normalizedEmail = email.trim().toLowerCase();
  await db
    .prepare(
      `UPDATE users
       SET access_subject = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE email_normalized = ? AND access_subject IS NULL AND active = 1`,
    )
    .bind(subject, normalizedEmail)
    .run();

  const newlyLinked = await bySubject(db, subject);
  if (!newlyLinked) {
    throw new AppError("USER_NOT_ALLOWED", 403, "This account has not been invited");
  }
  return toActor(newlyLinked, subject);
}
