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

export function isPublicCacheable(request: Request, response: Response): boolean {
  if (request.method !== "GET" || request.headers.has("Cookie")) return false;
  if (response.status !== 200 || response.headers.has("Set-Cookie")) return false;
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
    let files: string[];
    try {
      files = [...new Set(paths.map((path) => canonicalCacheUrl(env.SITE_ORIGIN, path)))];
    } catch {
      return "pending";
    }
    try {
      for (let index = 0; index < files.length; index += 30) {
        const response = await fetcher(
          `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}/purge_cache`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.CACHE_PURGE_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ files: files.slice(index, index + 30) }),
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
  const key = new Request(canonicalCacheUrl(env.SITE_ORIGIN, new URL(request.url).pathname));
  const cached = await publicCache.match(key);
  const cachedAt = Number(cached?.headers.get("X-TNC-Cached-At"));
  const ageSeconds = cachedAt ? (now - cachedAt) / 1_000 : Number.POSITIVE_INFINITY;
  if (cached && ageSeconds <= FRESH_SECONDS) return responseForVisitor(cached);

  try {
    const response = await load();
    if (isPublicCacheable(request, response)) {
      const storedHeaders = new Headers(response.headers);
      storedHeaders.set("Cache-Control", `public, max-age=${STALE_SECONDS}`);
      storedHeaders.set("X-TNC-Cached-At", String(now));
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
    if (cached && ageSeconds <= STALE_SECONDS) return responseForVisitor(cached);
    throw error;
  }
}
