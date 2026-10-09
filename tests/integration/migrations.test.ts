import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../helpers/database";

describe("CMS migration", () => {
  beforeEach(resetDatabase);

  it("creates the required tables", async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = result.results.map(({ name }) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "content_items",
        "content_locales",
        "content_revisions",
        "media",
        "redirects",
        "audit_events",
        "published_routes",
        "media_references",
      ]),
    );
  });

  it("enforces roles, types, locales, foreign keys and singleton content", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO users (id, email_normalized, display_name, role, active) VALUES ('u1', 'u@example.com', 'U', 'owner', 1)",
      ).run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        "INSERT INTO content_items (id, type, slug, shared_data_json, created_by) VALUES ('bad-type', 'page', 'bad', '{}', 'system')",
      ).run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        "INSERT INTO content_locales (id, content_item_id, locale, draft_data_json, updated_by) VALUES ('orphan', 'missing', 'vi', '{}', 'system')",
      ).run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO content_items (id, type, slug, shared_data_json, created_by) VALUES ('home-1', 'homepage', 'home', '{}', 'system')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO content_items (id, type, slug, shared_data_json, created_by) VALUES ('home-2', 'homepage', 'other', '{}', 'system')",
      ).run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO content_locales (id, content_item_id, locale, draft_data_json, updated_by) VALUES ('l1', 'home-1', 'vi', '{}', 'system')",
    ).run();
    await expect(
      env.DB.prepare(
        "INSERT INTO content_locales (id, content_item_id, locale, draft_data_json, updated_by) VALUES ('bad-locale', 'home-1', 'fr', '{}', 'system')",
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO content_locales (id, content_item_id, locale, draft_data_json, updated_by) VALUES ('l2', 'home-1', 'vi', '{}', 'system')",
      ).run(),
    ).rejects.toThrow();
  });

  it("is idempotent and keeps existing data", async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email_normalized, display_name, role, active) VALUES ('admin', 'admin@example.com', 'Admin', 'admin', 1)",
    ).run();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);

    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{
      count: number;
    }>();
    expect(result?.count).toBe(1);
  });

  it("keeps revisions immutable", async () => {
    await env.DB.prepare(
      "INSERT INTO content_items (id, type, slug, shared_data_json, created_by) VALUES ('article', 'insight', 'article', '{}', 'system')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO content_locales (id, content_item_id, locale, draft_data_json, updated_by) VALUES ('article-vi', 'article', 'vi', '{}', 'system')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO content_revisions (id, content_locale_id, revision_number, data_json, published_by) VALUES ('rev-1', 'article-vi', 1, '{}', 'system')",
    ).run();

    await expect(
      env.DB.prepare("UPDATE content_revisions SET data_json = '{\"changed\":true}' WHERE id = 'rev-1'").run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM content_revisions WHERE id = 'rev-1'").run(),
    ).rejects.toThrow();
  });
});
