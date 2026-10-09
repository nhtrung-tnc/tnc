import type { Draft, Locale, LocaleData } from "../../server/content/types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly payload: unknown) { super(`API request failed (${status})`); }
}

export async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export function saveEditorDraft(
  itemId: string,
  locale: Locale,
  version: number,
  data: LocaleData,
): Promise<Draft> {
  return apiRequest(`/api/admin/content/${itemId}/${locale}/draft`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion: version, data }),
  });
}
