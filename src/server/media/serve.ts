import { authenticate } from "../auth/access";
import type { Actor } from "../content/types";

type Authenticator = (request: Request, env: AppEnv) => Promise<Actor>;
const WIDTHS = new Set([480, 768, 1200, 2400]);
const YEAR = 31_536_000;

interface MediaSource {
  r2_key: string;
  original_filename: string;
  mime_type: string;
  checksum_sha256: string;
  is_public: number;
}

function formatFor(request: Request, mimeType: string): ImageOutputOptions["format"] {
  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("image/avif")) return "image/avif";
  if (accept.includes("image/webp")) return "image/webp";
  return mimeType as ImageOutputOptions["format"];
}

function responseHeaders(source: MediaSource, isPublic: boolean): Headers {
  const headers = new Headers({
    "Content-Type": source.mime_type,
    "X-Content-Type-Options": "nosniff",
    ETag: `"${source.checksum_sha256}"`,
    "Cache-Control": isPublic
      ? `public, max-age=${YEAR}, immutable`
      : "private, no-store",
  });
  if (source.mime_type === "application/pdf") {
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(source.original_filename)}`,
    );
  }
  return headers;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Image transform timed out")), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createMediaServer(authenticator: Authenticator = authenticate) {
  return async function serve(request: Request, env: AppEnv, id: string): Promise<Response> {
    const widthValue = new URL(request.url).searchParams.get("width");
    const width = widthValue === null ? null : Number(widthValue);
    if (width !== null && (!Number.isInteger(width) || !WIDTHS.has(width))) {
      return new Response("Invalid image width", { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    const source = await env.DB.prepare(
      `SELECT m.r2_key, m.original_filename, m.mime_type, m.checksum_sha256,
              EXISTS(
                SELECT 1 FROM media_references mr
                WHERE mr.media_id = m.id AND mr.owner_kind = 'revision'
              ) AS is_public
       FROM media m WHERE m.id = ? AND m.status = 'active'`,
    )
      .bind(id)
      .first<MediaSource>();
    if (!source) return new Response("Not found", { status: 404 });

    const isPublic = source.is_public === 1;
    if (!isPublic) {
      try {
        await authenticator(request, env);
      } catch {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    const isImage = source.mime_type.startsWith("image/");
    const format = isImage ? formatFor(request, source.mime_type) : null;
    const shouldTransform = isImage && (width !== null || format !== source.mime_type);
    const variantUrl = new URL(request.url);
    variantUrl.search = "";
    if (width !== null) variantUrl.searchParams.set("width", String(width));
    if (format) variantUrl.searchParams.set("format", format);
    const mediaCache = isPublic ? await caches.open("tnc-media-v1") : null;
    if (mediaCache) {
      const cached = await mediaCache.match(variantUrl.toString());
      if (cached) return cached;
    }

    let body = await env.MEDIA.get(source.r2_key);
    if (!body) return new Response("Not found", { status: 404 });
    let response: Response;
    if (shouldTransform && format) {
      try {
        let transformer = env.IMAGES.input(body.body);
        if (width !== null) transformer = transformer.transform({ width, fit: "scale-down" });
        const output = await withTimeout(transformer.output({ format }));
        response = output.response();
      } catch {
        body = await env.MEDIA.get(source.r2_key);
        if (!body) return new Response("Not found", { status: 404 });
        response = new Response(body.body);
      }
    } else {
      response = new Response(body.body);
    }
    const headers = responseHeaders(source, isPublic);
    if (shouldTransform) {
      headers.set("Vary", "Accept");
      if (response.headers.get("Content-Type")) {
        headers.set("Content-Type", response.headers.get("Content-Type")!);
      }
    }
    const finalResponse = new Response(response.body, { status: response.status, headers });
    if (mediaCache && finalResponse.ok) {
      await mediaCache.put(variantUrl.toString(), finalResponse.clone());
    }
    return finalResponse;
  };
}

export const serveMedia = createMediaServer();
