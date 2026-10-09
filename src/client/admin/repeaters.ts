export function initializeRepeaters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-repeat]").forEach((group) => {
    group.querySelector<HTMLButtonElement>("[data-add-item]")?.addEventListener("click", () => {
      const items = group.querySelector<HTMLElement>("[data-repeat-items]");
      const source = items?.querySelector<HTMLElement>("[data-repeat-item]:last-of-type");
      if (!items) return;
      const clone = source?.cloneNode(true) as HTMLElement | undefined;
      const item = clone ?? document.createElement("div");
      item.classList.add("repeat-item");
      item.dataset.repeatItem = "";
      if (!source) {
        for (const key of (group.dataset.repeatKeys ?? "").split(",").filter(Boolean)) {
          const label = document.createElement("label");
          label.append(key);
          const field = key === "body" || key === "list"
            ? document.createElement("textarea")
            : document.createElement("input");
          field.dataset.key = key;
          label.appendChild(field);
          item.appendChild(label);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.removeItem = "";
        remove.textContent = "Xóa";
        item.appendChild(remove);
      }
      item.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach((field) => { field.value = ""; });
      items.appendChild(item);
      bindRemove(item);
      item.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")?.focus();
      item.dispatchEvent(new Event("input", { bubbles: true }));
    });
    group.querySelectorAll<HTMLElement>("[data-repeat-item]").forEach(bindRemove);
  });
}

function bindRemove(item: HTMLElement): void {
  item.querySelector<HTMLButtonElement>("[data-remove-item]")?.addEventListener("click", () => {
    const group = item.closest<HTMLElement>("[data-repeat]");
    item.remove();
    group?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
