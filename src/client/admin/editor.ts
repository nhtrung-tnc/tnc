import type { Locale, LocaleData } from "../../server/content/types";
import { ApiError, apiRequest, saveEditorDraft } from "./api";
import { initializeRepeaters } from "./repeaters";

type Json = Record<string, unknown>;
const dirtyForms = new Set<HTMLFormElement>();

function setPath(target: Json, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part] as Json;
  });
  cursor[parts.at(-1)!] = value;
}

function collect(form: HTMLFormElement): LocaleData {
  const data = structuredClone(JSON.parse(form.dataset.initial ?? "{}")) as Json;
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-path]").forEach((field) => {
    const path = field.dataset.path!;
    if (path.endsWith("seo.image.mediaId")) {
      const mediaId = field.value.trim();
      const alt = form.querySelector<HTMLInputElement>('[data-path="seo.image.alt"]')?.value ?? "";
      setPath(data, "seo.image", mediaId ? { mediaId, alt } : null);
    } else if (!path.endsWith("seo.image.alt")) setPath(data, path, field.value);
  });
  form.querySelectorAll<HTMLElement>("[data-repeat]").forEach((group) => {
    const values = [...group.querySelectorAll<HTMLElement>("[data-repeat-item]")].map((item) => {
      const entry: Json = {};
      item.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-key]").forEach((field) => {
        entry[field.dataset.key!] = field.dataset.key === "list"
          ? field.value.split("\n").map((value) => value.trim()).filter(Boolean)
          : field.value;
      });
      return entry;
    });
    setPath(data, group.dataset.repeat!, values);
  });
  return data as unknown as LocaleData;
}

function clearFieldErrors(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>("[aria-invalid=true]").forEach((field) => field.removeAttribute("aria-invalid"));
}

function showFieldErrors(form: HTMLFormElement, payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return false;
  const error = (payload as { error?: { fields?: Record<string, string> } }).error;
  if (!error?.fields) return false;
  const messages = Object.entries(error.fields).map(([path, message]) => {
    form.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.setAttribute("aria-invalid", "true");
    return `${path}: ${message}`;
  });
  status(form, `Vui lòng kiểm tra: ${messages.join("; ")}`, true);
  return messages.length > 0;
}

function status(form: HTMLFormElement, message: string, error = false): void {
  const output = form.querySelector<HTMLElement>("[data-editor-status]");
  if (output) { output.textContent = message; output.dataset.error = String(error); }
}

document.querySelectorAll<HTMLButtonElement>("[data-locale-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const locale = tab.dataset.localeTab;
    document.querySelectorAll<HTMLButtonElement>("[data-locale-tab]").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    document.querySelectorAll<HTMLElement>("[data-locale-panel]").forEach((panel) => { panel.hidden = panel.dataset.localePanel !== locale; });
  });
});

document.querySelectorAll<HTMLFormElement>(".editor-form").forEach((form) => {
  form.addEventListener("input", () => { dirtyForms.add(form); status(form, "Có thay đổi chưa lưu"); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    button.disabled = true;
    clearFieldErrors(form);
    status(form, "Đang lưu…");
    try {
      const draft = await saveEditorDraft(form.dataset.itemId!, form.dataset.locale as Locale, Number(form.dataset.version), collect(form));
      form.dataset.version = String(draft.version);
      form.dataset.initial = JSON.stringify(draft.snapshot.data);
      dirtyForms.delete(form);
      status(form, "Đã lưu nháp");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        status(form, "Nội dung đã thay đổi ở nơi khác. Dữ liệu của bạn vẫn được giữ lại.", true);
        form.querySelector<HTMLElement>("[data-conflict-actions]")!.hidden = false;
      } else if (!(error instanceof ApiError && showFieldErrors(form, error.payload))) {
        status(form, "Không thể lưu. Kiểm tra mạng và thử lại; dữ liệu vẫn còn trên form.", true);
      }
    } finally { button.disabled = false; }
  });
  form.querySelector<HTMLButtonElement>("[data-copy]")?.addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(collect(form), null, 2)));
  form.querySelector<HTMLButtonElement>("[data-reload]")?.addEventListener("click", () => location.reload());
  form.querySelector<HTMLButtonElement>("[data-publish]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const result = await apiRequest<{ cacheStatus: string }>(`/api/admin/content/${form.dataset.itemId}/${form.dataset.locale}/publish`, { method:"POST", body:JSON.stringify({ expectedVersion:Number(form.dataset.version), expectedSharedVersion:Number(form.dataset.sharedVersion) }) });
      form.dataset.version = String(Number(form.dataset.version) + 1);
      status(form, result.cacheStatus === "pending" ? "Đã xuất bản, cache đang được làm mới" : "Đã xuất bản");
    } catch { status(form, "Xuất bản thất bại", true); } finally { button.disabled = false; }
  });
});

document.querySelector<HTMLFormElement>(".metadata-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const output = form.querySelector<HTMLElement>("[data-metadata-status]");
  button.disabled = true;
  if (output) output.textContent = "Đang lưu…";
  try {
    const fields = new FormData(form);
    const result = await apiRequest<{ sharedVersion: number }>(`/api/admin/content/${form.dataset.itemId}`, {
      method: "PUT",
      body: JSON.stringify({
        expectedSharedVersion: Number(form.dataset.sharedVersion),
        slug: fields.get("slug"),
        shared: { primaryMediaId: String(fields.get("primaryMediaId") ?? "").trim() || null },
      }),
    });
    form.dataset.sharedVersion = String(result.sharedVersion);
    document.querySelectorAll<HTMLFormElement>(".editor-form").forEach((editor) => { editor.dataset.sharedVersion = String(result.sharedVersion); });
    dirtyForms.delete(form);
    if (output) output.textContent = "Đã lưu thông tin dùng chung";
  } catch (error) {
    if (output) output.textContent = error instanceof ApiError && error.status === 409
      ? "Thông tin dùng chung đã thay đổi ở nơi khác. Hãy tải lại trang."
      : "Không thể lưu; dữ liệu vẫn còn trên form.";
  } finally { button.disabled = false; }
});

document.querySelector<HTMLFormElement>(".metadata-form")?.addEventListener("input", (event) => {
  dirtyForms.add(event.currentTarget as HTMLFormElement);
});

document.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach((button) => button.addEventListener("click", async () => {
  const form = document.querySelector<HTMLFormElement>(`.editor-form[data-locale="${button.closest<HTMLElement>("[data-locale-panel]")?.dataset.localePanel}"]`);
  if (!form) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/admin/content/${form.dataset.itemId}/${form.dataset.locale}/restore`, { method:"POST", body:JSON.stringify({ revisionId:button.dataset.restore, expectedVersion:Number(form.dataset.version), expectedSharedVersion:Number(form.dataset.sharedVersion) }) });
    location.reload();
  } catch { status(form, "Không thể khôi phục revision", true); button.disabled = false; }
}));

initializeRepeaters();
window.addEventListener("beforeunload", (event) => {
  if (dirtyForms.size === 0) return;
  event.preventDefault();
  event.returnValue = "";
});
