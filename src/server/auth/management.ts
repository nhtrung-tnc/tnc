import { auditStatement } from "../audit";
import { conflictGuard } from "../content/drafts";
import type { Actor, Role } from "../content/types";
import { AppError } from "../http/errors";
import { requireRole } from "./policy";
import { normalizeEmail } from "./users";

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  linked: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export async function listUsers(
  db: D1Database,
  actor: Actor,
): Promise<ManagedUser[]> {
  requireRole(actor, "admin");
  const rows = await db
    .prepare(
      `SELECT id, email_normalized, display_name, role, active, access_subject, created_at, last_seen_at
     FROM users ORDER BY active DESC, role, email_normalized`,
    )
    .all<{
      id: string;
      email_normalized: string;
      display_name: string;
      role: Role;
      active: number;
      access_subject: string | null;
      created_at: string;
      last_seen_at: string | null;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    email: row.email_normalized,
    displayName: row.display_name,
    role: row.role,
    active: row.active === 1,
    linked: row.access_subject !== null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function inviteUser(
  db: D1Database,
  actor: Actor,
  email: string,
  role: Role,
): Promise<string> {
  requireRole(actor, "admin");
  const normalized = normalizeEmail(email);
  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new AppError("INVALID_EMAIL", 422, "Email is invalid", {
      email: "Email không hợp lệ",
    });
  }
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
         (id, access_subject, email_normalized, display_name, role, active)
         VALUES (?, NULL, ?, ?, ?, 1)`,
        )
        .bind(id, normalized, normalized, role),
      auditStatement(db, actor, "user.invite", id),
    ]);
  } catch {
    throw new AppError(
      "USER_EXISTS",
      409,
      "A user with this email already exists",
    );
  }
  return id;
}

export async function updateUser(
  db: D1Database,
  actor: Actor,
  userId: string,
  role: Role,
  active: boolean,
): Promise<void> {
  requireRole(actor, "admin");
  const current = await db
    .prepare("SELECT role, active FROM users WHERE id = ?")
    .bind(userId)
    .first<{ role: Role; active: number }>();
  if (!current) throw new AppError("USER_NOT_FOUND", 404, "User was not found");
  const removesActiveAdmin =
    current.role === "admin" &&
    current.active === 1 &&
    (role !== "admin" || !active);
  const statements: D1PreparedStatement[] = [];
  if (removesActiveAdmin) {
    statements.push(
      conflictGuard(
        db,
        "SELECT CASE WHEN COUNT(*) >= 2 THEN 1 ELSE 0 END FROM users WHERE role = 'admin' AND active = 1",
        1,
      ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE users SET role = ?, active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      )
      .bind(role, active ? 1 : 0, userId),
    auditStatement(db, actor, "user.update", userId),
  );
  try {
    await db.batch(statements);
  } catch {
    throw new AppError(
      "LAST_ADMIN",
      409,
      "At least one active Administrator is required",
    );
  }
}
