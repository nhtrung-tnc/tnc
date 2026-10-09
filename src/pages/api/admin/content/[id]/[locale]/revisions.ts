import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { errorResponse } from "../../../../../../server/http/errors";
import { actorFrom, localeFrom } from "../../../../../../server/http/json";

export const GET: APIRoute = async ({ locals, params, url }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    actorFrom(locals);
    const locale = localeFrom(params.locale);
    const cursor = Number(url.searchParams.get("cursor") ?? Number.MAX_SAFE_INTEGER);
    const rows = await env.DB.prepare(
      `SELECT r.id, r.revision_number, r.published_by, r.published_at,
              r.source_revision_id, r.data_json
       FROM content_revisions r JOIN content_locales l ON l.id = r.content_locale_id
       WHERE l.content_item_id = ? AND l.locale = ? AND r.revision_number < ?
       ORDER BY r.revision_number DESC LIMIT 31`,
    ).bind(params.id ?? "", locale, Number.isSafeInteger(cursor) ? cursor : Number.MAX_SAFE_INTEGER).all<{
      id: string; revision_number: number; published_by: string; published_at: string;
      source_revision_id: string | null; data_json: string;
    }>();
    const page = rows.results.slice(0, 30);
    return Response.json({
      items: page.map((row) => ({ id: row.id, revisionNumber: row.revision_number, publishedBy: row.published_by, publishedAt: row.published_at, sourceRevisionId: row.source_revision_id, snapshot: JSON.parse(row.data_json) })),
      nextCursor: rows.results.length > 30 ? page.at(-1)?.revision_number ?? null : null,
    });
  } catch (error) { return errorResponse(error, requestId); }
};
