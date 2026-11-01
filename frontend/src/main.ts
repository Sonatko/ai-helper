import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";

/**
 * Main TypeScript entry point for the AI Helper desktop window.
 *
 * Why:
 * Implements intuitive window behavior:
 * 1. Immediate focus into the input field for instant keyboard typing.
 * 2. Middle-mouse-button (wheel hold & drag) custom window repositioning using Pointer Events.
 */
window.addEventListener("DOMContentLoaded", () => {
  const queryInput = document.getElementById("query-input") as HTMLInputElement | null;
  const appWindow = getCurrentWindow();

  // 1. Auto-focus the input field on launch
  if (queryInput) {
    queryInput.focus();
  }

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

      // Capture pointer events so dragging stays active even if cursor moves fast
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

  // 3. Escape key to clear or handle dismissal
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (queryInput && queryInput.value.length > 0) {
        queryInput.value = "";
      }
    }
  });
});
