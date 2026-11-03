"use strict";

(() => {
  const cover = document.querySelector(".book-presentation");
  if (!cover) return;
  const pointer = matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let bounds, pose, frame;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  function reset() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    bounds = pose = undefined;
    cover.classList.remove("is-cover-hovered");
    cover.style.removeProperty("--cover-rotate-x");
    cover.style.removeProperty("--cover-rotate-y");
  }

  function track(event) {
    if (event.pointerType !== "mouse" || !pointer.matches || reduced.matches) return;
    bounds ??= cover.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    cover.classList.add("is-cover-hovered");
    pose = {
      x: (0.5 - clamp((event.clientY - bounds.top) / bounds.height)) * 6,
      y: 2 + (clamp((event.clientX - bounds.left) / bounds.width) - 0.5) * 8,
    };
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      cover.style.setProperty("--cover-rotate-x", `${pose.x.toFixed(2)}deg`);
      cover.style.setProperty("--cover-rotate-y", `${pose.y.toFixed(2)}deg`);
    });
  }

  cover.addEventListener("pointerenter", track);
  cover.addEventListener("pointermove", track);
  cover.addEventListener("pointerleave", reset);
  cover.addEventListener("pointercancel", reset);
  pointer.addEventListener("change", reset);
  reduced.addEventListener("change", reset);
  window.addEventListener("blur", reset);
  window.addEventListener("resize", reset);
})();
