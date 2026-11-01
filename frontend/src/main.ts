import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

/**
 * Main TypeScript entry point for the AI Helper desktop window.
 *
 * Why:
 * Implements intuitive window behavior:
 * 1. Immediate focus into the input field for instant keyboard typing.
 * 2. Middle-mouse-button (wheel hold & drag) custom window repositioning using Pointer Events.
 * 3. Escape key handler: clears query and hides the window instantly.
 */
window.addEventListener("DOMContentLoaded", () => {
  const queryInput = document.getElementById("query-input") as HTMLInputElement | null;
  const appWindow = getCurrentWindow();

  // 1. Auto-focus the input field on initial load and every time the window regains focus
  const focusInput = () => {
    if (queryInput) {
      queryInput.focus();
      queryInput.select();
    }
  };

  focusInput();
  window.addEventListener("focus", focusInput);

  // 2. Middle-click (wheel hold & move) window dragging
  let isDragging = false;
  let startScreenX = 0;
  let startScreenY = 0;
  let startWindowX = 0;
  let startWindowY = 0;

  window.addEventListener("pointerdown", async (event: PointerEvent) => {
    if (event.button === 1) {
      // 1 = Middle mouse button (wheel press)
      event.preventDefault();

      const target = event.target as HTMLElement | null;
      if (target && target.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // Non-critical if capture fails
        }
      }

      // Query current physical window position on the monitor
      const pos = await appWindow.outerPosition();
      startWindowX = pos.x;
      startWindowY = pos.y;
      startScreenX = event.screenX;
      startScreenY = event.screenY;
      isDragging = true;
    }
  });

  window.addEventListener("pointermove", (event: PointerEvent) => {
    if (isDragging) {
      const deltaX = event.screenX - startScreenX;
      const deltaY = event.screenY - startScreenY;
      appWindow.setPosition(new PhysicalPosition(startWindowX + deltaX, startWindowY + deltaY));
    }
  });

  const stopDrag = (event: PointerEvent) => {
    if (event.button === 1 && isDragging) {
      isDragging = false;
      const target = event.target as HTMLElement | null;
      if (target && target.releasePointerCapture) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // Non-critical
        }
      }
    }
  };

  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  // 3. Escape key: clear input and instantly hide the window
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (queryInput) {
        queryInput.value = "";
      }
      appWindow.hide().catch((err) => {
        console.error("[AI Helper] Failed to hide window on Escape:", err);
      });
    }
  });
});
