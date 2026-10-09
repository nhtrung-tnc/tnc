import { ApiError, apiRequest } from "./api";

document
  .querySelector<HTMLFormElement>("[data-invite-user]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const output = form.querySelector<HTMLElement>("[data-user-status]")!;
    button.disabled = true;
    try {
      const data = new FormData(form);
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          role: data.get("role"),
        }),
      });
      output.textContent = "Đã tạo lời mời. Đang tải lại…";
      location.reload();
    } catch (error) {
      output.textContent =
        error instanceof ApiError && error.status === 409
          ? "Email này đã có trong CMS."
          : "Không thể tạo lời mời.";
      button.disabled = false;
    }
  });

document.querySelectorAll<HTMLFormElement>("[data-user-row]").forEach((form) =>
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const output = form.querySelector<HTMLElement>("[data-row-status]")!;
    const data = new FormData(form);
    button.disabled = true;
    try {
      await apiRequest(`/api/admin/users/${form.dataset.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: data.get("role"),
          active: data.get("active") === "on",
        }),
      });
      output.textContent = "Đã lưu";
    } catch (error) {
      output.textContent =
        error instanceof ApiError && error.status === 409
          ? "Phải luôn còn ít nhất một Admin hoạt động."
          : "Không thể cập nhật người dùng.";
    } finally {
      button.disabled = false;
    }
  }),
);
