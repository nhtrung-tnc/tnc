import { z } from "zod";
import type { Actor, Locale } from "../content/types";
import { localeSchema } from "../content/schema";
import { AppError } from "./errors";

const MAX_JSON_BYTES = 1024 * 1024;

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_JSON_BYTES) {
    throw new AppError("BODY_TOO_LARGE", 413, "JSON body exceeds 1 MiB");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_REQUEST", 400, "JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new AppError("BODY_TOO_LARGE", 413, "JSON body exceeds 1 MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError("INVALID_REQUEST", 400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.join(".") || "body"] = issue.message;
    }
    throw new AppError("INVALID_REQUEST", 400, "Request fields are invalid", fields);
  }
  return parsed.data;
}

export function actorFrom(locals: App.Locals): Actor {
  if (!locals.actor) throw new AppError("AUTH_REQUIRED", 401, "Authentication is required");
  return locals.actor;
}

export function localeFrom(value: string | undefined): Locale {
  const parsed = localeSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_LOCALE", 400, "Locale is invalid");
  return parsed.data;
}
