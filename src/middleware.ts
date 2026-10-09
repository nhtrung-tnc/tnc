import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { authenticate } from "./server/auth/access";
import { requireSameOrigin } from "./server/http/csrf";
import { AppError, errorResponse } from "./server/http/errors";
import { loadPublicWithCache } from "./server/site/cache";

const PRIVATE_ROOTS = ["/admin", "/api/admin", "/preview"];

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

function isPublicCachePath(pathname: string): boolean {
  return /^\/(?:vi|en|ja)(?:\/|$)/.test(pathname) || pathname === "/sitemap.xml";
}

function setPrivateHeaders(response: Response): void {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const vary = response.headers.get("Vary");
  response.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'",
  );
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return secured;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!isPrivatePath(pathname)) {
    const response = isPublicCachePath(pathname)
      ? loadPublicWithCache(context.request, env, next)
      : next();
    return withSecurityHeaders(await response);
  }

  const requestId = context.request.headers.get("Cf-Ray") ?? crypto.randomUUID();
  context.locals.requestId = requestId;
  try {
    requireSameOrigin(context.request, env.SITE_ORIGIN);
    context.locals.actor = await authenticate(context.request, env);
    const response = await next();
    setPrivateHeaders(response);
    return withSecurityHeaders(response);
  } catch (error) {
    const safeError =
      error instanceof AppError
        ? error
        : new AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    console.warn(
      JSON.stringify({
        event: "private_request_rejected",
        requestId,
        code: safeError.code,
        status: safeError.status,
        path: pathname,
      }),
    );
    const response = errorResponse(safeError, requestId);
    setPrivateHeaders(response);
    return withSecurityHeaders(response);
  }
});
