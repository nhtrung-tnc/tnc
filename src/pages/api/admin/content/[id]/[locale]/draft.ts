import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { saveDraft } from "../../../../../../server/content/drafts";
import { getDraft } from "../../../../../../server/content/repository";
import { errorResponse } from "../../../../../../server/http/errors";
import { actorFrom, localeFrom, readJson } from "../../../../../../server/http/json";

const schema = z.object({ expectedVersion: z.number().int().positive(), data: z.unknown() }).strict();

export const GET: APIRoute = async ({ locals, params }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    actorFrom(locals);
    return Response.json(await getDraft(env.DB, params.id ?? "", localeFrom(params.locale)));
  } catch (error) { return errorResponse(error, requestId); }
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorFrom(locals);
    const body = await readJson(request, schema);
    const draft = await saveDraft(env.DB, actor, params.id ?? "", localeFrom(params.locale), body.expectedVersion, body.data as never);
    return Response.json(draft);
  } catch (error) { return errorResponse(error, requestId); }
};
