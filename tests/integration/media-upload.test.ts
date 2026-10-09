import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { uploadMedia } from "../../src/server/media/upload";
import { validateMediaFile } from "../../src/server/media/validate";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor } from "../helpers/fixtures";

const actor = makeActor("editor");
const MiB = 1024 * 1024;

describe("validated media upload", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(actor);
  });

  it.each([
    ["photo.jpg", "image/jpeg", jpeg(800, 600), 800, 600],
    ["photo.png", "image/png", png(640, 480), 640, 480],
    ["photo.webp", "image/webp", webp(320, 200), 320, 200],
    ["photo.avif", "image/avif", avif(1200, 630), 1200, 630],
    ["document.pdf", "application/pdf", pdf(), null, null],
  ])("accepts real %s content", async (name, type, bytes, width, height) => {
    const result = await uploadMedia(env, actor, new File([bytes], name, { type }));
    expect(result).toMatchObject({ mimeType: type, width, height, existing: false });
    expect(await env.MEDIA.head(result.r2Key)).not.toBeNull();
  });

  it("rejects SVG/HTML renamed as PNG and truncated images", async () => {
    const disguised = new File([`<svg onload="alert(1)"/>`], "image.png", {
      type: "image/png",
    });
    await expect(uploadMedia(env, actor, disguised)).rejects.toMatchObject({ status: 415 });
    await expect(
      validateMediaFile(new File([png(100, 100).slice(0, 20)], "short.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("enforces exact image/PDF size boundaries before buffering", async () => {
    const exactImage = paddedPng(20 * MiB);
    await expect(
      validateMediaFile(new File([exactImage], "exact.png", { type: "image/png" })),
    ).resolves.toMatchObject({ byteSize: 20 * MiB });
    await expect(
      validateMediaFile(
        new File([paddedPng(20 * MiB + 1)], "large.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ status: 413 });

    const exactPdf = paddedPdf(25 * MiB);
    await expect(
      validateMediaFile(new File([exactPdf], "exact.pdf", { type: "application/pdf" })),
    ).resolves.toMatchObject({ byteSize: 25 * MiB });
    await expect(
      validateMediaFile(
        new File([paddedPdf(25 * MiB + 1)], "large.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an image dimension above 12,000 pixels", async () => {
    await expect(
      uploadMedia(
        env,
        actor,
        new File([png(12_001, 100)], "wide.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("uses a UUID key and deduplicates active content by SHA-256", async () => {
    const bytes = png(100, 80);
    const first = await uploadMedia(
      env,
      actor,
      new File([bytes], "../../escape.png", { type: "image/png" }),
    );
    const second = await uploadMedia(
      env,
      actor,
      new File([bytes], "copy.png", { type: "image/png" }),
    );
    expect(first.r2Key).toMatch(/^media\/[0-9a-f-]+\.png$/);
    expect(first.r2Key).not.toContain("escape");
    expect(second).toMatchObject({ id: first.id, existing: true });
    const objects = await env.MEDIA.list({ prefix: "media/" });
    expect(objects.objects).toHaveLength(1);
  });

  it("does not create a D1 row when R2 fails", async () => {
    const broken = Object.assign({}, env, {
      MEDIA: { put: async () => { throw new Error("R2 unavailable"); } },
    }) as AppEnv;
    await expect(
      uploadMedia(broken, actor, new File([png(10, 10)], "x.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 503 });
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM media").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("deletes the new R2 object when D1 insertion fails", async () => {
    const operations: string[] = [];
    const fakeEnv = Object.assign({}, env, {
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => null }) }),
        batch: async () => { throw new Error("D1 unavailable"); },
      },
      MEDIA: {
        put: async (key: string) => { operations.push(`put:${key}`); return {}; },
        delete: async (key: string) => { operations.push(`delete:${key}`); },
      },
    }) as AppEnv;
    await expect(
      uploadMedia(fakeEnv, actor, new File([png(10, 10)], "x.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 503 });
    expect(operations.map((entry) => entry.split(":", 1)[0])).toEqual(["put", "delete"]);
  });
});

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint32(offset, value, false);
}

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  writeU32(bytes, 8, 13);
  bytes.set([73, 72, 68, 82], 12);
  writeU32(bytes, 16, width);
  writeU32(bytes, 20, height);
  bytes.set([73, 69, 78, 68], 37);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9,
  ]);
}

function webp(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  for (let index = 0; index < 3; index++) {
    bytes[24 + index] = ((width - 1) >> (index * 8)) & 0xff;
    bytes[27 + index] = ((height - 1) >> (index * 8)) & 0xff;
  }
  return bytes;
}

function avif(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44);
  writeU32(bytes, 0, 24);
  bytes.set(new TextEncoder().encode("ftypavif"), 4);
  bytes.set(new TextEncoder().encode("avifmif1"), 16);
  writeU32(bytes, 24, 20);
  bytes.set(new TextEncoder().encode("ispe"), 28);
  writeU32(bytes, 36, width);
  writeU32(bytes, 40, height);
  return bytes;
}

function pdf(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
}

function paddedPng(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(png(100, 100));
  bytes.set(new TextEncoder().encode("IEND"), size - 8);
  return bytes;
}

function paddedPdf(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  bytes.set(new TextEncoder().encode("%%EOF"), size - 5);
  return bytes;
}
