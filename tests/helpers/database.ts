import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

const dropSql = `
DROP TRIGGER IF EXISTS content_revisions_no_update;
DROP TRIGGER IF EXISTS content_revisions_no_delete;
DROP TRIGGER IF EXISTS audit_fail;
DROP TABLE IF EXISTS d1_migrations;
DROP TABLE IF EXISTS media_references;
DROP TABLE IF EXISTS published_routes;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS redirects;
DROP TABLE IF EXISTS content_revisions;
DROP TABLE IF EXISTS content_locales;
DROP TABLE IF EXISTS content_items;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS users;
`;

export async function resetDatabase(): Promise<void> {
  await env.DB.exec(dropSql);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);
}

export async function seedActor(actor: {
  id: string;
  subject: string;
  email: string;
  role: "admin" | "editor";
}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id, access_subject, email_normalized, display_name, role, active) VALUES (?, ?, ?, ?, ?, 1)",
  )
    .bind(actor.id, actor.subject, actor.email.toLowerCase(), actor.email, actor.role)
    .run();
}
