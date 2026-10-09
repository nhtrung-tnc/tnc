import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { saveItemMetadata } from "../../../../../server/content/publish";
import { getDraft } from "../../../../../server/content/repository";
import { errorResponse } from "../../../../../server/http/errors";
import { actorFrom, readJson } from "../../../../../server/http/json";

const metadataSchema = z.object({
  expectedSharedVersion: z.number().int().positive(),
  slug: z.string(),
  shared: z.object({ primaryMediaId: z.string().nullable() }).strict(),
}).strict();

export const GET: APIRoute = async ({ locals, params }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    actorFrom(locals);
    const id = params.id ?? "";
    const locales = await Promise.all((["vi", "en", "ja"] as const).map((locale) => getDraft(env.DB, id, locale)));
    return Response.json({ id, locales });
  } catch (error) { return errorResponse(error, requestId); }
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorFrom(locals);
    const body = await readJson(request, metadataSchema);
    const sharedVersion = await saveItemMetadata(env.DB, actor, params.id ?? "", body.expectedSharedVersion, body.slug, body.shared);
    return Response.json({ sharedVersion });
  } catch (error) { return errorResponse(error, requestId); }
};
