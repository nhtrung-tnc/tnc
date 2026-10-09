import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { restoreRevision } from "../../../../../../server/content/restore";
import { errorResponse } from "../../../../../../server/http/errors";
import { actorFrom, localeFrom, readJson } from "../../../../../../server/http/json";

const schema = z.object({
  revisionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  expectedSharedVersion: z.number().int().positive(),
}).strict();

export const POST: APIRoute = async ({ locals, params, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorFrom(locals);
    const body = await readJson(request, schema);
    const draft = await restoreRevision(env.DB, actor, params.id ?? "", localeFrom(params.locale), body.revisionId, body.expectedVersion, body.expectedSharedVersion);
    return Response.json(draft);
  } catch (error) { return errorResponse(error, requestId); }
};
