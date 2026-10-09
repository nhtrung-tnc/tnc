import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticator } from "../../src/server/auth/access";
import { saveDraft } from "../../src/server/content/drafts";
import { publishLocale } from "../../src/server/content/publish";
import { createItem } from "../../src/server/content/repository";
import { createMediaServer } from "../../src/server/media/serve";
import { uploadMedia } from "../../src/server/media/upload";
import { resetDatabase, seedActor } from "../helpers/database";
import { createAccessTestIssuer } from "../helpers/access-jwt";
import { makeActor, makeInsight } from "../helpers/fixtures";

const actor = makeActor("editor");
const admin = makeActor("admin");

describe("media visibility and responses", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(actor);
    await seedActor(admin);
  });

  it("hides draft-only media from anonymous users and revoked accounts", async () => {
    const media = await uploadMedia(env, actor, imageFile());
    const itemId = await createItem(env.DB, actor, "insight", "draft-media");
    const data = makeInsight().data;
    data.seo.image = { mediaId: media.id, alt: "Draft" };
    await saveDraft(env.DB, actor, itemId, "vi", 1, data);

    const issuer = await createAccessTestIssuer(env.ACCESS_ISSUER, env.ACCESS_AUDIENCE);
    const serve = createMediaServer(createAuthenticator(issuer.getKey));
    expect(
      (await serve(new Request(`https://site.test/media/${media.id}`), env, media.id)).status,
    ).toBe(404);

    const token = await issuer.sign({ subject: actor.subject, email: actor.email });
    const authenticated = new Request(`https://site.test/media/${media.id}`, {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const privateResponse = await serve(authenticated, env, media.id);
    expect(privateResponse.status).toBe(200);
    expect(privateResponse.headers.get("Cache-Control")).toBe("private, no-store");

    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(actor.id).run();
    expect((await serve(authenticated, env, media.id)).status).toBe(404);
  });

  it("serves published media for one year and validates width variants", async () => {
    const media = await uploadMedia(env, admin, imageFile());
    const itemId = await createItem(env.DB, admin, "insight", "public-media");
    const data = makeInsight().data;
    data.seo.image = { mediaId: media.id, alt: "Public" };
    await saveDraft(env.DB, admin, itemId, "vi", 1, data);
    await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    const serve = createMediaServer();

    const response = await serve(
      new Request(`https://site.test/media/${media.id}?width=768`),
      env,
      media.id,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("max-age=31536000");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(
      (
        await serve(
          new Request(`https://site.test/media/${media.id}?width=999`),
          env,
          media.id,
        )
      ).status,
    ).toBe(400);
  });

  it("varies AVIF/WebP transformations by Accept and falls back on failure", async () => {
    const media = await uploadMedia(env, admin, imageFile());
    await markPublished(media.id);
    const formats: string[] = [];
    const transformedEnv = Object.assign({}, env, {
      IMAGES: {
        input: () => ({
          transform() { return this; },
          async output(options: { format: string }) {
            formats.push(options.format);
            return { response: () => new Response("variant", { headers: { "Content-Type": options.format } }) };
          },
        }),
      },
    }) as AppEnv;
    const serve = createMediaServer();
    const avif = await serve(
      new Request(`https://site.test/media/${media.id}?width=480`, {
        headers: { Accept: "image/avif,image/webp" },
      }),
      transformedEnv,
      media.id,
    );
    expect(avif.headers.get("Content-Type")).toBe("image/avif");
    expect(avif.headers.get("Vary")).toContain("Accept");
    expect(formats).toEqual(["image/avif"]);

    const webp = await serve(
      new Request(`https://site.test/media/${media.id}?width=768`, {
        headers: { Accept: "image/webp" },
      }),
      transformedEnv,
      media.id,
    );
    expect(webp.headers.get("Content-Type")).toBe("image/webp");
    expect(formats).toEqual(["image/avif", "image/webp"]);

    const failingEnv = Object.assign({}, env, {
      IMAGES: { input: () => ({ transform() { return this; }, output: async () => { throw new Error("transform failed"); } }) },
    }) as AppEnv;
    const fallback = await serve(
      new Request(`https://site.test/media/${media.id}?width=1200`, { headers: { Accept: "image/webp" } }),
      failingEnv,
      media.id,
    );
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("Content-Type")).toBe("image/png");
  });

  it("forces PDFs to download and prevents MIME sniffing", async () => {
    const media = await uploadMedia(
      env,
      admin,
      new File(["%PDF-1.7\n%%EOF"], "catalog.pdf", { type: "application/pdf" }),
    );
    await markPublished(media.id);
    const response = await createMediaServer()(
      new Request(`https://site.test/media/${media.id}`),
      env,
      media.id,
    );
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});

async function markPublished(mediaId: string): Promise<void> {
  const itemId = await createItem(env.DB, admin, "insight", `article-${mediaId.slice(0, 8)}`);
  const data = makeInsight().data;
  data.seo.image = { mediaId, alt: "Published" };
  await saveDraft(env.DB, admin, itemId, "vi", 1, data);
  await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
}

function imageFile(): File {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, 100);
  new DataView(bytes.buffer).setUint32(20, 80);
  bytes.set([73, 69, 78, 68], 37);
  return new File([bytes], "image.png", { type: "image/png" });
}
