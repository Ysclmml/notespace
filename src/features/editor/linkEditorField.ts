/**
 * Crepe owns link transactions and its input's Vue state. Keep that input as
 * the adapter, but expose a wrapping textarea instead of a clipped one-line
 * field. Confirm/cancel still run through the original handlers and Undo.
 */
export function installWrappingLinkEditor(root: HTMLElement, label: string): () => void {
  const fields = new Map<
    HTMLInputElement,
    { area: HTMLTextAreaElement; dispose: () => void }
  >();
  const update = () => {
    for (const input of root.querySelectorAll<HTMLInputElement>(
      ".milkdown-link-edit input.input-area",
    )) {
      let field = fields.get(input);
      if (!field) {
        const area = document.createElement("textarea");
        area.className = "notespace-link-address";
        area.setAttribute("aria-label", label);
        area.rows = 3;
        area.wrap = "soft";
        area.spellcheck = false;
        area.autocomplete = "off";
        input.classList.add("notespace-link-input-adapter");
        input.setAttribute("aria-hidden", "true");
        input.tabIndex = -1;
        input.insertAdjacentElement("afterend", area);
        const resize = () => {
          area.style.height = "auto";
          area.style.height = `${Math.max(72, area.scrollHeight + 2)}px`;
        };
        const focus = () => {
          area.value = input.value;
          resize();
          area.focus({ preventScroll: true });
        };
        const change = () => {
          // A URL is one logical line; visual wrapping does not add whitespace.
          const value = area.value.replace(/[\r\n]/gu, "");
          if (area.value !== value) area.value = value;
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          resize();
        };
        const keydown = (event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape"))
            return;
          event.preventDefault();
          input.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: event.key,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        input.addEventListener("focus", focus);
        area.addEventListener("input", change);
        area.addEventListener("keydown", keydown);
        field = {
          area,
          dispose: () => {
            input.removeEventListener("focus", focus);
            area.removeEventListener("input", change);
            area.removeEventListener("keydown", keydown);
            area.remove();
          },
        };
        fields.set(input, field);
      }
      if (document.activeElement !== field.area && field.area.value !== input.value) {
        field.area.value = input.value;
      }
      if (field.area.placeholder !== label) field.area.placeholder = label;
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-show", "value"],
  });
  update();
  return () => {
    observer.disconnect();
    for (const field of fields.values()) field.dispose();
  };
}
