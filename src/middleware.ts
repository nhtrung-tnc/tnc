import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { authenticate } from "./server/auth/access";
import { requireSameOrigin } from "./server/http/csrf";
import { AppError, errorResponse } from "./server/http/errors";

const PRIVATE_ROOTS = ["/admin", "/api/admin", "/preview"];

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

function setPrivateHeaders(response: Response): void {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const vary = response.headers.get("Vary");
  response.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!isPrivatePath(pathname)) return next();

  const requestId = context.request.headers.get("Cf-Ray") ?? crypto.randomUUID();
  context.locals.requestId = requestId;
  try {
    requireSameOrigin(context.request, env.SITE_ORIGIN);
    context.locals.actor = await authenticate(context.request, env);
    const response = await next();
    setPrivateHeaders(response);
    return response;
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
    return response;
  }
});
