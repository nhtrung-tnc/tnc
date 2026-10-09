import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { findOrLinkUser } from "../../src/server/auth/users";
import { inviteUser, updateUser } from "../../src/server/auth/management";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor } from "../helpers/fixtures";

const admin = makeActor("admin");

describe("CMS user management", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
  });

  it("normalizes invited email and rejects duplicates", async () => {
    const id = await inviteUser(
      env.DB,
      admin,
      "  New.Editor@Example.COM ",
      "editor",
    );
    const row = await env.DB.prepare(
      "SELECT email_normalized, access_subject FROM users WHERE id = ?",
    )
      .bind(id)
      .first<{ email_normalized: string; access_subject: string | null }>();
    expect(row).toEqual({
      email_normalized: "new.editor@example.com",
      access_subject: null,
    });
    await expect(
      inviteUser(env.DB, admin, "NEW.EDITOR@example.com", "editor"),
    ).rejects.toMatchObject({ status: 409, code: "USER_EXISTS" });
  });

  it("refuses to disable or demote the final active Admin", async () => {
    await expect(
      updateUser(env.DB, admin, admin.id, "admin", false),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      updateUser(env.DB, admin, admin.id, "editor", true),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps one active Admin when two demotions race", async () => {
    const second = {
      id: "admin-two",
      subject: "subject-two",
      email: "two@example.com",
      role: "admin" as const,
    };
    await seedActor(second);
    const results = await Promise.allSettled([
      updateUser(env.DB, admin, admin.id, "editor", true),
      updateUser(env.DB, second, second.id, "editor", true),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1",
    ).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("denies a disabled user immediately with an already linked Access subject", async () => {
    await updateUser(env.DB, admin, admin.id, "admin", true);
    await env.DB.prepare(
      "INSERT INTO users (id, access_subject, email_normalized, display_name, role, active) VALUES ('editor-two', 'live-subject', 'live@example.com', 'Live', 'editor', 1)",
    ).run();
    expect(
      await findOrLinkUser(env.DB, "live-subject", "live@example.com"),
    ).toMatchObject({ role: "editor" });
    await updateUser(env.DB, admin, "editor-two", "editor", false);
    await expect(
      findOrLinkUser(env.DB, "live-subject", "live@example.com"),
    ).rejects.toMatchObject({ status: 403, code: "USER_DISABLED" });
  });

  it("does not allow Editors to invite or modify users", async () => {
    const editor = makeActor("editor");
    await seedActor(editor);
    await expect(
      inviteUser(env.DB, editor, "blocked@example.com", "editor"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateUser(env.DB, editor, admin.id, "admin", true),
    ).rejects.toMatchObject({ status: 403 });
  });
});
