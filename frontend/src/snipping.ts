import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("snipping-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawMask();
  };

  const drawMask = (selection?: { x: number; y: number; w: number; h: number }) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Semi-transparent dim background
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (selection && selection.w > 0 && selection.h > 0) {
      // Clear cut hole revealing desktop beneath
      ctx.clearRect(selection.x, selection.y, selection.w, selection.h);

      // Cyan glowing border around selection
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);

      // Dimension indicator badge (in physical pixels)
      const dpr = window.devicePixelRatio || 1;
      const badgeText = `${Math.round(selection.w * dpr)} × ${Math.round(selection.h * dpr)} px`;
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      const textWidth = ctx.measureText(badgeText).width;
      const badgeX = selection.x;
      const badgeY = selection.y > 32 ? selection.y - 8 : selection.y + selection.h + 20;

      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY - 14, textWidth + 12, 18, 4);
      ctx.fill();

      ctx.fillStyle = "#38bdf8";
      ctx.fillText(badgeText, badgeX + 6, badgeY);
    }
  };

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  listen("snipping_activated", () => {
    isDragging = false;
    resizeCanvas();
  });

  window.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Left mouse click only
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = e.clientX;
    currentY = e.clientY;
    drawMask();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    currentY = e.clientY;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    drawMask({ x, y, w, h });
  });

  window.addEventListener("mouseup", async (e) => {
    if (!isDragging || e.button !== 0) return;
    isDragging = false;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    if (w >= 8 && h >= 8) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      try {
        await invoke("confirm_crop_region", {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
          dpr: window.devicePixelRatio || 1.0,
        });
      } catch (err) {
        console.error("Failed to confirm crop region:", err);
      }
    } else {
      await invoke("cancel_crop_region");
    }
  });

  window.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      isDragging = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await invoke("cancel_crop_region");
    }
  });
});

