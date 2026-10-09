import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { AppError, errorResponse } from "../../../../server/http/errors";
import { listMedia } from "../../../../server/media/repository";
import { uploadMedia } from "../../../../server/media/upload";

function actorOrThrow(locals: App.Locals) {
  if (!locals.actor) throw new AppError("AUTH_REQUIRED", 401, "Authentication is required");
  return locals.actor;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    actorOrThrow(locals);
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const result = await listMedia(env.DB, {
      cursor: url.searchParams.get("cursor") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      limit: Number.isFinite(limit) ? limit : 30,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorOrThrow(locals);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", 400, "A file is required");
    const record = await uploadMedia(env, actor, file);
    return Response.json(record, { status: record.existing ? 200 : 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
};
