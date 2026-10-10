const CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const FRESH_SECONDS = 60;
const STALE_SECONDS = 360;

export function publicCacheHeaders(): Headers {
  return new Headers({
    "Cache-Control": BROWSER_CACHE_CONTROL,
    "CDN-Cache-Control": CDN_CACHE_CONTROL,
  });
}

export function privateCacheHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store" });
}

export function canonicalCacheUrl(origin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Cache path must be an absolute site path");
  }
  const trustedOrigin = new URL(origin).origin;
  const url = new URL(path, trustedOrigin);
  return `${trustedOrigin}${url.pathname}`;
}

async function cacheTagForUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `tnc-path-${hex}`;
}

export function isPublicCacheable(
  request: Request,
  response: Response,
): boolean {
  if (request.method !== "GET" || request.headers.has("Cookie")) return false;
  if (response.status !== 200 || response.headers.has("Set-Cookie"))
    return false;
  return !response.headers.get("Cache-Control")?.includes("private");
}

type PurgeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createPurger(fetcher: PurgeFetch = fetch) {
  return async function purge(
    env: AppEnv,
    paths: string[],
  ): Promise<"purged" | "pending"> {
    if (!env.CLOUDFLARE_ZONE_ID || !env.CACHE_PURGE_TOKEN) return "pending";
    let tags: string[];
    try {
      const urls = [
        ...new Set(
          paths.map((path) => canonicalCacheUrl(env.SITE_ORIGIN, path)),
        ),
      ];
      tags = await Promise.all(urls.map(cacheTagForUrl));
    } catch {
      return "pending";
    }
    try {
      for (let index = 0; index < tags.length; index += 100) {
        const response = await fetcher(
          `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}/purge_cache`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.CACHE_PURGE_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ tags: tags.slice(index, index + 100) }),
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!response.ok) return "pending";
      }
      return "purged";
    } catch {
      return "pending";
    }
  };
}

export const purgePublished = createPurger();

type ResponseLoader = () => Promise<Response>;

function responseForVisitor(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("X-TNC-Cached-At");
  headers.delete("Cache-Tag");
  headers.set("Cache-Control", BROWSER_CACHE_CONTROL);
  headers.set("CDN-Cache-Control", CDN_CACHE_CONTROL);
  return new Response(response.body, { status: response.status, headers });
}

export async function loadPublicWithCache(
  request: Request,
  env: Pick<AppEnv, "SITE_ORIGIN">,
  load: ResponseLoader,
  cache?: Pick<Cache, "match" | "put">,
  now = Date.now(),
): Promise<Response> {
  if (request.method !== "GET" || request.headers.has("Cookie")) return load();
  const publicCache = cache ?? (await caches.open("tnc-public-v1"));
  const key = new Request(
    canonicalCacheUrl(env.SITE_ORIGIN, new URL(request.url).pathname),
  );
  const cached = await publicCache.match(key);
  const cachedAt = Number(cached?.headers.get("X-TNC-Cached-At"));
  const ageSeconds = cachedAt
    ? (now - cachedAt) / 1_000
    : Number.POSITIVE_INFINITY;
  if (cached && ageSeconds <= FRESH_SECONDS) return responseForVisitor(cached);

  try {
    const response = await load();
    if (response.status >= 500 && cached && ageSeconds <= STALE_SECONDS) {
      return responseForVisitor(cached);
    }
    if (isPublicCacheable(request, response)) {
      const storedHeaders = new Headers(response.headers);
      storedHeaders.set("Cache-Control", `public, max-age=${STALE_SECONDS}`);
      storedHeaders.set("X-TNC-Cached-At", String(now));
      storedHeaders.set("Cache-Tag", await cacheTagForUrl(key.url));
      await publicCache.put(
        key,
        new Response(response.clone().body, {
          status: response.status,
          headers: storedHeaders,
        }),
      );
    }
    return response;
  } catch (error) {
    if (cached && ageSeconds <= STALE_SECONDS)
      return responseForVisitor(cached);
    throw error;
  }
}
