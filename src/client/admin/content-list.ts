import { ApiError, apiRequest } from "./api";

document.querySelector<HTMLFormElement>("[data-create-content]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const output = form.querySelector<HTMLElement>("[data-create-status]");
  button.disabled = true;
  if (output) output.textContent = "Đang tạo…";
  try {
    const fields = new FormData(form);
    const result = await apiRequest<{ id: string }>("/api/admin/content", {
      method: "POST",
      body: JSON.stringify({ type: fields.get("type"), slug: fields.get("slug") }),
    });
    location.assign(`/admin/content/${result.id}/`);
  } catch (error) {
    if (output) output.textContent = error instanceof ApiError && error.status === 409
      ? "Đường dẫn này đã tồn tại."
      : "Không thể tạo nội dung. Hãy kiểm tra thông tin và thử lại.";
    button.disabled = false;
  }
});
