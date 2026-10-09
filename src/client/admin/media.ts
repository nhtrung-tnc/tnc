interface MediaItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  status: "active" | "deleted" | "orphaned";
  references: string[];
  existing: boolean;
}

async function getMedia(search = ""): Promise<MediaItem[]> {
  const response = await fetch(
    `/api/admin/media?limit=100&search=${encodeURIComponent(search)}`,
  );
  if (!response.ok) throw new Error("media list failed");
  return ((await response.json()) as { items: MediaItem[] }).items;
}

function mediaCard(
  item: MediaItem,
  options: { select?: (id: string) => void; canDelete?: boolean } = {},
): HTMLElement {
  const card = document.createElement("article");
  card.dataset.mediaId = item.id;
  if (item.mimeType.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = `/media/${encodeURIComponent(item.id)}`;
    image.alt = "";
    card.appendChild(image);
  } else {
    const preview = document.createElement("div");
    preview.className = "file-preview";
    preview.textContent = "PDF";
    card.appendChild(preview);
  }
  const name = document.createElement("strong");
  name.textContent = item.originalFilename;
  const details = document.createElement("small");
  details.textContent =
    item.width && item.height
      ? `${item.width} × ${item.height}`
      : item.mimeType;
  const id = document.createElement("code");
  id.textContent = item.id;
  const refs = document.createElement("p");
  refs.textContent = item.references.length
    ? `Đang dùng: ${item.references.join(", ")}`
    : "Chưa được sử dụng";
  card.appendChild(name);
  card.appendChild(details);
  card.appendChild(id);
  card.appendChild(refs);
  if (options.select) {
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = "Chọn";
    select.addEventListener("click", () => options.select?.(item.id));
    card.appendChild(select);
  } else if (options.canDelete && item.status === "active") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.deleteMedia = "";
    remove.textContent = "Xóa";
    remove.disabled = item.references.length > 0;
    card.appendChild(remove);
  }
  return card;
}

async function renderLibrary(search = ""): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-media-results]");
  if (!root) return;
  const items = await getMedia(search);
  root.replaceChildren(
    ...items.map((item) =>
      mediaCard(item, { canDelete: root.dataset.canDelete === "true" }),
    ),
  );
}

document
  .querySelector<HTMLInputElement>("[data-media-search]")
  ?.addEventListener("input", (event) => {
    void renderLibrary((event.currentTarget as HTMLInputElement).value);
  });

document
  .querySelector<HTMLFormElement>("[data-media-upload]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    const output = form.querySelector<HTMLElement>("[data-upload-status]")!;
    button.disabled = true;
    output.textContent = "Đang tải lên…";
    try {
      const response = await fetch("/api/admin/media", {
        method: "POST",
        body: new FormData(form),
      });
      const body = (await response.json()) as MediaItem;
      if (!response.ok) throw new Error("upload failed");
      output.textContent = body.existing
        ? "Tệp đã tồn tại; CMS dùng lại media hiện có."
        : "Đã tải lên.";
      form.reset();
      await renderLibrary();
    } catch {
      output.textContent = "Không thể tải tệp lên.";
    } finally {
      button.disabled = false;
    }
  });

document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "[data-delete-media]",
  );
  if (!button) return;
  const card = button.closest<HTMLElement>("[data-media-id]");
  if (
    !card ||
    !confirm(
      "Xóa media chưa được sử dụng này? Tệp sẽ được giữ 30 ngày trước khi dọn vĩnh viễn.",
    )
  )
    return;
  button.disabled = true;
  const response = await fetch(`/api/admin/media/${card.dataset.mediaId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (response.ok) card.remove();
  else {
    button.disabled = false;
    alert(
      response.status === 409
        ? "Media đang được sử dụng nên không thể xóa."
        : "Không thể xóa media.",
    );
  }
});

document.querySelectorAll<HTMLElement>(".media-picker").forEach((picker) => {
  const input = picker.querySelector<HTMLInputElement>("input[readonly]")!;
  const dialog = picker.querySelector<HTMLDialogElement>("dialog")!;
  const results = picker.querySelector<HTMLElement>("[data-picker-results]")!;
  const render = async (search = "") => {
    const items = (await getMedia(search)).filter(
      ({ status, mimeType }) =>
        status === "active" && mimeType.startsWith("image/"),
    );
    results.replaceChildren(
      ...items.map((item) =>
        mediaCard(item, {
          select: (id) => {
            input.value = id;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            dialog.close();
          },
        }),
      ),
    );
  };
  picker
    .querySelector<HTMLButtonElement>("[data-open-media]")
    ?.addEventListener("click", () => {
      dialog.showModal();
      void render();
    });
  picker
    .querySelector<HTMLButtonElement>("[data-clear-media]")
    ?.addEventListener("click", () => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  picker
    .querySelector<HTMLInputElement>("[data-picker-search]")
    ?.addEventListener(
      "input",
      (event) => void render((event.currentTarget as HTMLInputElement).value),
    );
});
