import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { publishLocale } from "../../../../../../server/content/publish";
import { purgePublished } from "../../../../../../server/site/cache";
import { errorResponse } from "../../../../../../server/http/errors";
import { actorFrom, localeFrom, readJson } from "../../../../../../server/http/json";

const schema = z.object({ expectedVersion: z.number().int().positive(), expectedSharedVersion: z.number().int().positive() }).strict();

export const POST: APIRoute = async ({ locals, params, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorFrom(locals);
    const body = await readJson(request, schema);
    const result = await publishLocale(env.DB, actor, params.id ?? "", localeFrom(params.locale), body.expectedVersion, body.expectedSharedVersion);
    const cacheStatus = await purgePublished(env, result.affectedPaths);
    return Response.json({ ...result, cacheStatus });
  } catch (error) { return errorResponse(error, requestId); }
};
