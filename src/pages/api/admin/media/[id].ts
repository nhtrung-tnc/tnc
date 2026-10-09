import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { errorResponse } from "../../../../server/http/errors";
import { actorFrom } from "../../../../server/http/json";
import { softDeleteMedia } from "../../../../server/media/cleanup";

export const DELETE: APIRoute = async ({ locals, params }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    await softDeleteMedia(env, actorFrom(locals), params.id ?? "");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
};
