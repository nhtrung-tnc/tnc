import { conflictGuard } from "../src/server/content/drafts";
import { normalizeEmail } from "../src/server/auth/users";
import { AppError } from "../src/server/http/errors";
import { directInvocation, explicitTarget, failSafely, loadRuntimeConfig } from "./runtime-config";

export async function bootstrapAdmin(db: D1Database, email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError("INVALID_EMAIL", 422, "Bootstrap email is invalid");
  }
  const existing = await db.prepare(
    "SELECT id, email_normalized FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  ).first<{ id:string; email_normalized:string }>();
  if (existing) {
    if (existing.email_normalized === normalized) return existing.id;
    throw new AppError("ADMIN_ALREADY_BOOTSTRAPPED", 409, "An Administrator already exists");
  }
  const id = crypto.randomUUID();
  try {
    await db.batch([
      conflictGuard(db, "SELECT COUNT(*) FROM users WHERE role = 'admin'", 0),
      db.prepare(
        `INSERT INTO users
         (id, access_subject, email_normalized, display_name, role, active)
         VALUES (?, NULL, ?, ?, 'admin', 1)`,
      ).bind(id, normalized, "Initial Administrator"),
    ]);
  } catch {
    const raced = await db.prepare(
      "SELECT id, email_normalized FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
    ).first<{ id:string; email_normalized:string }>();
    if (raced?.email_normalized === normalized) return raced.id;
    throw new AppError("ADMIN_ALREADY_BOOTSTRAPPED", 409, "An Administrator already exists");
  }
  return id;
}

if (directInvocation("bootstrap-admin.ts")) {
  void (async () => {
    const target = explicitTarget();
    const config = await loadRuntimeConfig<{ target:"local" | "production"; db:D1Database; email:string }>();
    if (config.target !== target) throw new Error("Runtime config target does not match --target");
    await bootstrapAdmin(config.db, config.email);
    console.log("Administrator bootstrap completed");
  })().catch(failSafely);
}
