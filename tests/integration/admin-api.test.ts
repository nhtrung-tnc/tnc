import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as createContent } from "../../src/pages/api/admin/content/index";
import { PUT as updateDraft } from "../../src/pages/api/admin/content/[id]/[locale]/draft";
import { POST as publishDraft } from "../../src/pages/api/admin/content/[id]/[locale]/publish";
import { POST as restoreDraft } from "../../src/pages/api/admin/content/[id]/[locale]/restore";
import { publishLocale } from "../../src/server/content/publish";
import { createItem } from "../../src/server/content/repository";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeInsight } from "../helpers/fixtures";

const worker = (exports as unknown as { default: Fetcher }).default;
const admin = makeActor("admin");
const editor = makeActor("editor");

describe("structured admin API", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
    await seedActor(editor);
  });

  it("returns field errors for invalid JSON and rejects bodies over 1 MiB", async () => {
    const invalid = await invoke(
      createContent,
      jsonRequest("https://site.test/api/admin/content", { type: "page", slug: "../bad" }),
      {},
      admin,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST", fields: expect.any(Object) } });

    const tooLarge = await invoke(
      createContent,
      new Request("https://site.test/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "insight", slug: "a", padding: "x".repeat(1024 * 1024) }),
      }),
      {},
      admin,
    );
    expect(tooLarge.status).toBe(413);
  });

  it("returns a 409 for stale draft writes", async () => {
    const itemId = await createItem(env.DB, editor, "insight", "conflict");
    const request = () =>
      jsonRequest(`https://site.test/api/admin/content/${itemId}/vi/draft`, {
        expectedVersion: 1,
        data: makeInsight().data,
      }, "PUT");
    expect((await invoke(updateDraft, request(), { id: itemId, locale: "vi" }, editor)).status).toBe(200);
    const stale = await invoke(updateDraft, request(), { id: itemId, locale: "vi" }, editor);
    expect(stale.status).toBe(409);
  });

  it("prevents editors from publish/restore and reports pending cache after success", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "publish-api");
    await invoke(
      updateDraft,
      jsonRequest(`https://site.test/api/admin/content/${itemId}/vi/draft`, {
        expectedVersion: 1,
        data: makeInsight().data,
      }, "PUT"),
      { id: itemId, locale: "vi" },
      admin,
    );
    const payload = { expectedVersion: 2, expectedSharedVersion: 1 };
    const editorResponse = await invoke(
      publishDraft,
      jsonRequest(`https://site.test/api/admin/content/${itemId}/vi/publish`, payload),
      { id: itemId, locale: "vi" },
      editor,
    );
    expect(editorResponse.status).toBe(403);

    const published = await invoke(
      publishDraft,
      jsonRequest(`https://site.test/api/admin/content/${itemId}/vi/publish`, payload),
      { id: itemId, locale: "vi" },
      admin,
    );
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ revisionId: expect.any(String), cacheStatus: "pending" });
  });

  it("blocks cross-item revision restore", async () => {
    const first = await createItem(env.DB, admin, "insight", "first-api");
    const second = await createItem(env.DB, admin, "insight", "second-api");
    await invoke(updateDraft, jsonRequest("https://site.test/draft", { expectedVersion: 1, data: makeInsight().data }, "PUT"), { id: first, locale: "vi" }, admin);
    const revision = await publishLocale(env.DB, admin, first, "vi", 2, 1);
    const response = await invoke(
      restoreDraft,
      jsonRequest("https://site.test/restore", {
        revisionId: revision.revisionId,
        expectedVersion: 1,
        expectedSharedVersion: 1,
      }),
      { id: second, locale: "vi" },
      admin,
    );
    expect(response.status).toBe(404);
  });

  it("protects preview and admin payload routes before rendering", async () => {
    const preview = await worker.fetch("https://site.test/preview/item/vi");
    expect(preview.status).toBe(401);
    expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
    expect(preview.headers.get("X-Robots-Tag")).toContain("noindex");
    expect((await worker.fetch("https://site.test/api/admin/content")).status).toBe(401);
  });
});

function jsonRequest(url: string, value: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", Origin: "https://site.test" },
    body: JSON.stringify(value),
  });
}

async function invoke(
  handler: unknown,
  request: Request,
  params: Record<string, string>,
  actor: ReturnType<typeof makeActor>,
): Promise<Response> {
  return (handler as (context: unknown) => Promise<Response>)({
    request,
    url: new URL(request.url),
    params,
    locals: { actor, requestId: "test-request" },
  });
}
