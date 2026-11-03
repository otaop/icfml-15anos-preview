import { clampPage, spreadForPage, nextPage, previousPage, displayMode } from "./reader-model.mjs?v=20261029-curl8";
import { createPageTurnRenderer } from "./page-turn.js?v=20261029-curl8";
import { createPaperLayers } from "./paper-layers.mjs?v=20261028-curl3";
import { cornerDirection, dragProgress, releaseDecision, sampleVelocity } from "./page-drag.mjs";
import { hoverPose } from "./page-hover.mjs?v=20261029-curl8";
import { applyPageGutter } from "./page-gutter.mjs?v=20261029-curl8";
import { loadPageText } from "./reader-text.mjs?v=20261029-pre-deploy1";
import { requestApi, clearSession, getPdfSource } from "./api-client.mjs";
import { createReaderFullscreen } from "./reader-fullscreen.mjs";

const $ = (selector) => document.querySelector(selector);
const shell = $("#reader-shell");
const stage = $("#reader-stage");
const viewport = $("#reader-viewport");
const space = $("#reading-space");
const host = $("#spread-host");
const message = $("#reader-message");
const messageText = $("#reader-message-text");
const retry = $("#reader-retry");
const announcement = $("#reader-announcement");
const pageInput = $("#page-number");
const totalLabel = $("#page-total");
const previous = $("#previous-page");
const next = $("#next-page");
const previousSide = $("#previous-page-side");
const nextSide = $("#next-page-side");
const zoomIn = $("#zoom-in");
const zoomOut = $("#zoom-out");
const zoomReset = $("#zoom-reset");
const fullscreen = $("#fullscreen");
const textToggle = $("#text-mode");
const textView = $("#reader-text");
const edgeNavigation = $(".reader-edge-navigation");
const jump = $(".jump-control");

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const MAX_PIXELS = 8_000_000;
const activeTasks = new Set();
const loadedPages = new Map();
const pointers = new Map();
let pdf;
let total = 0;
let currentPage = 1;
let zoom = 1;
let current;
let renderVersion = 0;
let pendingRender;
let storageKey;
let pageRatio = 708.661 / 595.276;
let resizeTimer;
let zoomTimer;
let gesture;
let pinch;
let turnRenderer;
let activeTurn;
let feedbackTimer;
let corner;
let prefetchTimer;
let zoomOrigin;
let textMode = false;
let textVersion = 0;
const loadedText = new Map();
const preparedSpreads = new Map();
stage.dataset.readerBuild = "20261029-pre-deploy1";

function notify(text, { error = false, compact = Boolean(current) } = {}) {
  clearTimeout(feedbackTimer);
  message.hidden = false;
  message.classList.toggle("is-error", error);
  message.classList.toggle("is-compact", compact && !error);
  messageText.textContent = text;
  retry.hidden = !error;
}

function controls() {
  const mode = displayMode(innerWidth, innerHeight);
  const anchor = total ? spreadForPage(currentPage, total, mode).anchor : 1;
  previous.disabled = !pdf || Boolean(pendingRender) || anchor === 1;
  next.disabled = !pdf || Boolean(pendingRender) || nextPage(currentPage, total, mode) === anchor;
  previousSide.disabled = previous.disabled;
  nextSide.disabled = next.disabled;
  pageInput.disabled = !pdf;
  pageInput.max = String(total || 1);
  if (document.activeElement !== pageInput) pageInput.value = String(currentPage);
  totalLabel.textContent = total ? `/ ${total}` : "";
  zoomIn.disabled = !pdf || textMode || zoom >= 3;
  zoomOut.disabled = !pdf || textMode || zoom <= 1;
  zoomReset.disabled = !pdf || textMode;
  textToggle.disabled = !pdf || !current || Boolean(pendingRender);
  zoomReset.textContent = `${Math.round(zoom * 100)}%`;
  viewport.classList.toggle("is-zoomed", zoom > 1);
  updateJump();
}

function updateJump(feedback = false) {
  const valid = Boolean(pdf && current && pageInput.validity.valid);
  const target = valid ? clampPage(pageInput.value, total) : null;
  const displayed = current?.pages?.filter(Boolean) || [];
  const alreadyOpen = valid && displayed.includes(target);
  jump.disabled = !pdf || !current || alreadyOpen;
  jump.title = alreadyOpen ? "Esta página já está aberta" : "Ir para a página digitada";
  if (!feedback) return;
  clearTimeout(feedbackTimer);
  if (alreadyOpen) {
    notify("Esta página já está aberta.", { compact: true });
    feedbackTimer = setTimeout(() => {
      if (stage.getAttribute("aria-busy") !== "true" && !message.classList.contains("is-error")) message.hidden = true;
    }, 2500);
  } else if (stage.getAttribute("aria-busy") !== "true" && !message.classList.contains("is-error")) message.hidden = true;
}

function layout() {
  const mode = displayMode(innerWidth, innerHeight);
  const slots = mode === "double" ? 2 : 1;
  const padding = mode === "double" ? 24 : 16;
  const width = Math.max(1, viewport.clientWidth - padding * 2);
  const height = Math.max(1, viewport.clientHeight - padding * 2);
  const ratio = pageRatio;
  const pageWidth = Math.min(width / slots, height * ratio);
  return { mode, slots, pageWidth: pageWidth * zoom, pageHeight: pageWidth / ratio * zoom, ratio, padding, zoom };
}

function applyDimensions(geometry) {
  const width = geometry.pageWidth * geometry.slots;
  const height = geometry.pageHeight;
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  space.style.width = `${Math.max(viewport.clientWidth, width + geometry.padding * 2)}px`;
  space.style.height = `${Math.max(viewport.clientHeight, height + geometry.padding * 2)}px`;
  const bookInset = (Math.max(viewport.clientHeight, height + geometry.padding * 2) - height) / 2;
  stage.style.setProperty("--edge-nav-offset", `${Math.max(0, bookInset - 8)}px`);
  if (current?.element) {
    for (const sheet of current.element.children) sheet.style.width = `${geometry.pageWidth}px`;
  }
}

function cancelPending() {
  for (const task of activeTasks) task.cancel();
  activeTasks.clear();
  activeTurn?.cancel();
}

function canTurn(old, fresh, direction, geometry) {
  if (textMode || !direction || reducedMotion.matches || zoom !== 1 || !old || old.mode !== fresh.mode || old.zoom !== zoom) return false;
  if (Math.abs(old.geometry.pageWidth - geometry.pageWidth) > .5) return false;
  return Boolean(old.canvases[geometry.mode === "double" && direction > 0 ? 1 : 0] && fresh.canvases[geometry.mode === "double" && direction < 0 ? 1 : 0]);
}

async function turn(old, fresh, direction, geometry) {
  if (!canTurn(old, fresh, direction, geometry)) return;
  const layers = createPaperLayers({ host, old, fresh, direction, geometry, isCurrent: () => current === old || current === fresh });
  const front = old.canvases[geometry.mode === "double" && direction > 0 ? 1 : 0];
  const back = fresh.canvases[geometry.mode === "double" && direction < 0 ? 1 : 0];
  turnRenderer ??= createPageTurnRenderer(stage);
  const animation = turnRenderer.animate({ front, back, geometry, direction, host, deferStart: true, onComplete: ({ committed }) => layers.complete(committed) });
  activeTurn = animation;
  try {
    // Present the opaque source frame over the old HTML before replacing it.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (activeTurn === animation) { layers.mount(); animation.settle(true); }
    await animation.finished;
  } finally {
    layers.complete(true);
    if (activeTurn === animation) activeTurn = null;
  }
}
async function pageCanvas(number, geometry, version, gutterSide = null) {
  let page = loadedPages.get(number);
  if (!page) { page = await pdf.getPage(number); loadedPages.set(number, page); }
  if (version !== renderVersion) return null;
  const original = page.getViewport({ scale: 1 });
  const renderingViewport = page.getViewport({ scale: geometry.pageWidth / original.width });
  const outputScale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (renderingViewport.width * renderingViewport.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(renderingViewport.width * outputScale));
  canvas.height = Math.max(1, Math.ceil(renderingViewport.height * outputScale));
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Página ${number} do livro`);
  const task = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: renderingViewport, transform: [outputScale, 0, 0, outputScale, 0, 0], background: "#fbf9f5" });
  activeTasks.add(task);
  try { await task.promise; applyPageGutter(canvas, { side: gutterSide, pageWidth: geometry.pageWidth }); return canvas; }
  finally { activeTasks.delete(task); }
}

function trimPages(visible) {
  for (const number of loadedText.keys()) {
    if (visible.every((p) => p === null || Math.abs(number - p) > 3)) loadedText.delete(number);
  }
  for (const [number, page] of loadedPages) {
    if (visible.every((p) => p === null || Math.abs(number - p) > 3)) {
      if (page.cleanup()) loadedPages.delete(number);
    }
  }
}

function savePosition() {
  history.replaceState(null, "", `#page=${currentPage}`);
  try { localStorage.setItem(storageKey, String(currentPage)); } catch { /* Reading works without storage. */ }
}

function freeSpread(spread) {
  if (!spread || spread === current || spread.released) return;
  spread.released = true;
  for (const canvas of spread.canvases) if (canvas) { canvas.width = 0; canvas.height = 0; }
}

async function prepareSpread(target, geometry, version) {
  const spread = spreadForPage(target, total, geometry.mode);
  const paired = geometry.mode === "double" && spread.pages.every(Boolean);
  const results = await Promise.allSettled(spread.pages.map((p, index) => p === null ? null : pageCanvas(p, geometry, version, paired ? index === 0 ? "right" : "left" : null)));
  const canvases = results.map((result) => result.status === "fulfilled" ? result.value : null);
  const failure = results.find((result) => result.status === "rejected");
  if (failure || version !== renderVersion || canvases.some((canvas, i) => spread.pages[i] !== null && !canvas)) {
    for (const canvas of canvases) if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (failure) throw failure.reason;
    return null;
  }
  const element = document.createElement("div");
  element.className = `reader-spread ${geometry.mode === "double" ? "is-double" : "is-single"}${paired ? " is-paired" : ""}`;
  element.setAttribute("aria-label", spread.pages.filter(Boolean).length === 2 ? `Páginas ${spread.pages[0]} e ${spread.pages[1]}` : `Página ${spread.anchor}`);
  canvases.forEach((canvas) => {
    const sheet = document.createElement("div");
    sheet.className = `reader-sheet${canvas ? "" : " is-empty"}`;
    sheet.style.width = `${geometry.pageWidth}px`;
    if (canvas) sheet.append(canvas);
    else sheet.setAttribute("aria-hidden", "true");
    element.append(sheet);
  });
  return { element, canvases, mode: geometry.mode, zoom: geometry.zoom, page: target, ratio: geometry.ratio, pages: spread.pages, geometry };
}

function spreadKey(target, geometry) {
  return `${geometry.mode}:${geometry.pageWidth.toFixed(1)}:${geometry.pageHeight.toFixed(1)}:${spreadForPage(target, total, geometry.mode).anchor}`;
}

function clearPrepared() {
  clearTimeout(prefetchTimer);
  for (const entry of preparedSpreads.values()) {
    entry.discarded = true;
    freeSpread(entry.spread);
  }
  preparedSpreads.clear();
}

function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (textMode || !current || corner || pendingRender || activeTurn || zoom !== 1 || stage.getAttribute("aria-busy") === "true") return;
    const geometry = layout();
    const anchor = spreadForPage(currentPage, total, geometry.mode).anchor;
    for (const target of [previousPage(currentPage, total, geometry.mode), nextPage(currentPage, total, geometry.mode)]) {
      if (target === anchor) continue;
      const key = spreadKey(target, geometry);
      if (preparedSpreads.has(key)) continue;
      const entry = { version: renderVersion };
      entry.promise = prepareSpread(target, geometry, entry.version).then((spread) => {
        if (entry.discarded) { freeSpread(spread); return null; }
        entry.spread = spread;
        return spread;
      }).catch(() => null);
      preparedSpreads.set(key, entry);
    }
  }, 80);
}

async function takePrepared(target, geometry, version) {
  const key = spreadKey(target, geometry);
  const entry = preparedSpreads.get(key);
  if (entry) {
    preparedSpreads.delete(key);
    const spread = await entry.promise;
    if (spread && !entry.discarded && !spread.released && entry.version === version && version === renderVersion
      && spreadKey(spread.page, spread.geometry) === key && spread.zoom === geometry.zoom) return spread;
    freeSpread(spread);
  }
  if (version !== renderVersion) return null;
  return prepareSpread(target, geometry, version);
}

function cornerAt(x, y) {
  if (textMode || !pdf || !current || pendingRender || activeTurn || resizeTimer || zoom !== 1 || stage.getAttribute("aria-busy") === "true") return 0;
  const mode = displayMode(innerWidth, innerHeight);
  if (current.mode !== mode || current.zoom !== zoom) return 0;
  const anchor = spreadForPage(current.page, total, mode).anchor;
  return cornerDirection(x, y, host.getBoundingClientRect(), {
    mode,
    canPrevious: previousPage(current.page, total, mode) !== anchor,
    canNext: nextPage(current.page, total, mode) !== anchor,
  });
}

function validCorner(session) {
  return corner === session && !session.canceled && session.version === renderVersion && current === session.old && zoom === 1 && session.geometry.mode === (displayMode(innerWidth, innerHeight));
}

function abortCorner() {
  const session = corner;
  if (!session) return;
  corner = null;
  session.canceled = true;
  if (session.frame) cancelAnimationFrame(session.frame);
  if (session.presentFrame) cancelAnimationFrame(session.presentFrame);
  if (session.hoverFrame) cancelAnimationFrame(session.hoverFrame);
  session.controller?.cancel();
  session.cleanup?.(false);
  freeSpread(session.fresh);
  viewport.classList.remove("is-page-turning", "is-corner-ready");
  stage.dataset.cornerState = "idle";
  stage.dataset.cornerCommitted = "false";
}

function mountCorner(session) {
  const { old, fresh, geometry, direction } = session;
  const layers = createPaperLayers({ host, old, fresh, direction, geometry, isCurrent: () => current === old || current === fresh });
  session.cleanup = (committed) => layers.complete(committed);
  turnRenderer ??= createPageTurnRenderer(stage);
  const front = old.canvases[geometry.mode === "double" && direction > 0 ? 1 : 0];
  const back = fresh.canvases[geometry.mode === "double" && direction < 0 ? 1 : 0];
  session.controller = turnRenderer.begin({ front, back, geometry, direction, host, corner: session.corner, gripY: session.gripY, reducedMotion: reducedMotion.matches, onComplete: ({ committed }) => session.cleanup(committed) });
  session.controller.finished.then(({ committed }) => {
    if (!validCorner(session)) return;
    corner = null;
    if (session.hoverFrame) cancelAnimationFrame(session.hoverFrame);
    if (session.presentFrame) cancelAnimationFrame(session.presentFrame);
    viewport.classList.remove("is-page-turning", "is-corner-ready");
    stage.dataset.cornerState = "idle";
    stage.dataset.cornerCommitted = String(committed);
    if (committed) {
      current = fresh;
      currentPage = fresh.page;
      renderVersion += 1;
      clearPrepared();
      controls();
      savePosition();
      announcement.textContent = `${fresh.element.getAttribute("aria-label")}. 100% de ampliação.`;
      freeSpread(old);
    } else freeSpread(fresh);
    trimPages(current.pages);
    schedulePrefetch();
  });
  session.presentFrame = requestAnimationFrame(() => {
    session.presentFrame = 0;
    if (!validCorner(session)) return;
    if (!reducedMotion.matches) layers.mount();
    session.mounted = true;
    if (session.kind === "hover") { animateHover(session); return; }
    session.controller.update({ progress: session.progress, vertical: session.vertical, gripY: session.gripY });
    stage.dataset.cornerState = session.held ? "dragging" : "settling";
    if (session.release) session.controller.settle(session.release.committed, { velocity: session.release.velocity });
  });
}
async function prepareCorner(session) {
  try {
    const automatic = activeTurn;
    if (automatic) { automatic.finish(); await automatic.finished; }
    if (!validCorner(session)) return;
    const fresh = await takePrepared(session.target, session.geometry, session.version);
    if (!fresh) { if (validCorner(session)) abortCorner(); return; }
    session.fresh = fresh;
    if (!validCorner(session)) { freeSpread(fresh); return; }
    mountCorner(session);
  } catch {
    if (!validCorner(session)) return;
    abortCorner();
    if (session.kind !== "hover") notify("Não foi possível preparar esta página. Tente novamente.", { error: true });
  }
}

function beginCorner(event, direction, preview = null) {
  clearTimeout(prefetchTimer);
  const geometry = layout();
  const target = direction > 0 ? nextPage(current.page, total, geometry.mode) : previousPage(current.page, total, geometry.mode);
  const selectedCorner = preview?.corner ?? (event.clientY < host.getBoundingClientRect().top + geometry.pageHeight / 2 ? "top" : "bottom");
  const session = {
    kind: preview ? "hover" : "drag", pointerId: preview ? null : event.pointerId, direction, geometry, target, old: current, version: renderVersion,
    startX: event.clientX, startY: event.clientY, initialProgress: 0, initialVertical: 0, progress: 0, vertical: 0, held: !preview,
    corner: selectedCorner, gripY: preview?.gripY ?? (selectedCorner === "top" ? 0 : 1),
    hoverTarget: preview, lastHoverPose: preview, tapToTurn: !preview && event.pointerType === "mouse", moved: false,
    samples: [{ time: performance.now(), progress: 0 }],
  };
  corner = session;
  gesture = null;
  viewport.classList.toggle("is-corner-ready", Boolean(preview));
  viewport.classList.toggle("is-page-turning", !preview);
  stage.dataset.cornerState = preview ? "hover-preparing" : "preparing";
  stage.dataset.cornerProgress = "0";
  stage.dataset.cornerCommitted = "false";
  prepareCorner(session);
}

function hoverAt(event) {
  if (textMode || !pdf || !current || resizeTimer || activeTurn || pointers.size || stage.getAttribute("aria-busy") === "true") return null;
  const mode = displayMode(innerWidth, innerHeight);
  if (current.mode !== mode || current.zoom !== zoom) return null;
  const anchor = spreadForPage(current.page, total, mode).anchor;
  return hoverPose(event.clientX, event.clientY, host.getBoundingClientRect(), {
    pageWidth: current.geometry.pageWidth, aspect: current.geometry.pageHeight / current.geometry.pageWidth,
    mode, pointerType: event.pointerType, reducedMotion: reducedMotion.matches, zoom,
    canPrevious: previousPage(current.page, total, mode) !== anchor,
    canNext: nextPage(current.page, total, mode) !== anchor,
  });
}

function animateHover(session) {
  if (!validCorner(session) || session.kind !== "hover" || !session.mounted) return;
  if (session.hoverFrame) cancelAnimationFrame(session.hoverFrame);
  const from = { progress: session.controller.progress, vertical: session.controller.vertical, gripY: session.controller.gripY };
  const target = session.hoverTarget;
  const started = performance.now();
  stage.dataset.cornerState = session.closing ? "hover-returning" : "hover";
  function tick(now) {
    session.hoverFrame = 0;
    if (!validCorner(session) || session.kind !== "hover") return;
    const t = Math.max(0, Math.min(1, (now - started) / 170));
    const eased = t * t * (3 - 2 * t);
    session.progress = from.progress + (target.progress - from.progress) * eased;
    session.vertical = from.vertical + (target.vertical - from.vertical) * eased;
    session.gripY = from.gripY + ((target.gripY ?? from.gripY) - from.gripY) * eased;
    session.controller.update({ progress: session.progress, vertical: session.vertical, gripY: session.gripY });
    stage.dataset.cornerProgress = session.progress.toFixed(4);
    if (t < 1) session.hoverFrame = requestAnimationFrame(tick);
    else if (session.closing) session.controller.cancel();
  }
  session.hoverFrame = requestAnimationFrame(tick);
}

function closeHover() {
  if (corner?.kind !== "hover" || corner.closing) return;
  if (!corner.mounted) { abortCorner(); return; }
  corner.closing = true;
  corner.hoverTarget = { progress: 0, vertical: 0 };
  animateHover(corner);
}

function previewHover(event) {
  if (corner && corner.kind !== "hover") return;
  if (event.buttons) { closeHover(); return; }
  let target = hoverAt(event);
  const session = corner;
  if (!target && session?.kind === "hover" && session.lastHoverPose && event.pointerType === "mouse" && !pointers.size && zoom === 1 && !reducedMotion.matches && !resizeTimer && !activeTurn) {
    const box = host.getBoundingClientRect();
    const width = Math.max(32, Math.min(72, session.geometry.pageWidth * .12));
    const distance = session.direction > 0 ? box.right - event.clientX : event.clientX - box.left;
    // A small exit margin keeps the crease from chattering at the hit boundary.
    if (distance >= -6 && distance <= width + 8 && event.clientY >= box.top - 6 && event.clientY <= box.bottom + 6) target = session.lastHoverPose;
  }
  if (!target) { viewport.classList.remove("is-corner-ready"); closeHover(); return; }
  viewport.classList.add("is-corner-ready");
  if (session?.kind === "hover" && target.direction === session.direction) {
    const previousPose = session.lastHoverPose;
    if (!session.closing && Math.abs(target.progress - previousPose.progress) < .002 && Math.abs(target.gripY - previousPose.gripY) < .003 && Math.abs(target.vertical - previousPose.vertical) < .002) return;
    session.closing = false;
    session.lastHoverPose = target;
    session.hoverTarget = target;
    animateHover(session);
    return;
  }
  abortCorner();
  beginCorner(event, target.direction, target);
}

function grabCorner(session, event) {
  if (session.hoverFrame) cancelAnimationFrame(session.hoverFrame);
  const progress = session.controller?.progress ?? 0;
  const vertical = session.controller?.vertical ?? 0;
  const gripY = session.controller?.gripY ?? session.gripY;
  const wasHover = session.kind === "hover";
  Object.assign(session, {
    kind: "drag", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    initialProgress: progress, initialVertical: vertical, progress, vertical, gripY,
    held: true, release: null, closing: false, hoverTarget: null,
    tapToTurn: wasHover && event.pointerType === "mouse", moved: false,
    samples: [{ time: performance.now(), progress }],
  });
  if (session.mounted) session.controller?.update({ progress, vertical, gripY });
  stage.dataset.cornerState = session.mounted ? "dragging" : "preparing";
  viewport.classList.remove("is-corner-ready");
  viewport.classList.add("is-page-turning");
  gesture = null;
}
function moveCorner(session, event) {
  if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 6) session.moved = true;
  session.progress = dragProgress(session.startX, event.clientX, { direction: session.direction, pageWidth: session.geometry.pageWidth, mode: session.geometry.mode, initialProgress: session.initialProgress });
  session.vertical = session.initialVertical + (event.clientY - session.startY) / session.geometry.pageWidth;
  const now = performance.now();
  session.samples.push({ time: now, progress: session.progress });
  session.samples = session.samples.filter((sample) => sample.time >= now - 130);
  stage.dataset.cornerProgress = session.progress.toFixed(4);
  if (session.controller && session.mounted && !session.frame) {
    session.frame = requestAnimationFrame(() => {
      session.frame = 0;
      if (validCorner(session) && session.held) session.controller.update({ progress: session.progress, vertical: session.vertical, gripY: session.gripY });
    });
  }
}

function releaseCorner(event) {
  const session = corner;
  if (!session || session.pointerId !== event.pointerId) return false;
  if (event.type !== "pointerup") { abortCorner(); return true; }
  moveCorner(session, event);
  if (session.frame) { cancelAnimationFrame(session.frame); session.frame = 0; }
  const velocity = sampleVelocity(session.samples, performance.now());
  const committed = session.tapToTurn && !session.moved || releaseDecision(session.progress, velocity, { mode: session.geometry.mode });
  session.held = false;
  session.release = { committed, velocity };
  if ((!session.controller || !session.mounted) && !committed) { abortCorner(); return true; }
  stage.dataset.cornerState = "settling";
  if (session.controller && session.mounted) {
    session.controller.update({ progress: session.progress, vertical: session.vertical, gripY: session.gripY });
    session.controller.settle(committed, { velocity });
  }
  return true;
}

async function render(target = currentPage, { direction = 0, center = false, anchor } = {}) {
  if (!pdf) return;
  clearTimeout(resizeTimer);
  resizeTimer = undefined;
  clearTimeout(zoomTimer);
  zoomTimer = undefined;
  abortCorner();
  clearPrepared();
  const version = ++renderVersion;
  const request = { version, target: clampPage(target, total) };
  pendingRender = request;
  cancelPending();
  controls();
  stage.setAttribute("aria-busy", "true");
  notify(current ? "Carregando páginas…" : "Carregando o livro…");
  const geometry = layout();
  const old = current;
  const previousScroll = { x: viewport.scrollLeft, y: viewport.scrollTop };
  const rollbackScroll = zoomOrigin && zoomOrigin.spread === old ? zoomOrigin.scroll : previousScroll;
  const previousWidth = space.clientWidth;
  const previousHeight = space.clientHeight;
  let fresh;
  try {
    fresh = await prepareSpread(request.target, geometry, version);
    if (!fresh) return;
    if (version !== renderVersion) { freeSpread(fresh); return; }
    const { element } = fresh;
    const animate = canTurn(old, fresh, direction, geometry);
    if (animate) {
      // Keep the committed source and its position until the physical turn ends.
      // The temporary layer owner presents fresh underneath without promoting it.
      applyDimensions(geometry);
      await turn(old, fresh, direction, geometry);
      if (version !== renderVersion) { freeSpread(fresh); return; }
    }
    current = fresh;
    currentPage = request.target;
    if (!animate) host.replaceChildren(element);
    applyDimensions(geometry);
    if (center) {
      viewport.scrollLeft = Math.max(0, (space.clientWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (space.clientHeight - viewport.clientHeight) / 2);
    } else if (anchor) {
      viewport.scrollLeft = anchor.x * space.clientWidth - anchor.localX;
      viewport.scrollTop = anchor.y * space.clientHeight - anchor.localY;
    } else {
      viewport.scrollLeft = (previousScroll.x + viewport.clientWidth / 2) / previousWidth * space.clientWidth - viewport.clientWidth / 2;
      viewport.scrollTop = (previousScroll.y + viewport.clientHeight / 2) / previousHeight * space.clientHeight - viewport.clientHeight / 2;
    }
    message.hidden = true;
    stage.setAttribute("aria-busy", "false");
    savePosition();
    announcement.textContent = `${element.getAttribute("aria-label")}. ${Math.round(zoom * 100)}% de ampliação.`;
    updateTextContent();
    if (old?.canvases) for (const canvas of old.canvases) if (canvas && !canvas.isConnected) { canvas.width = 0; canvas.height = 0; }
    if (version === renderVersion) trimPages(current.pages);
  } catch (error) {
    if (version !== renderVersion || error?.name === "RenderingCancelledException") return;
    if (old) {
      current = old;
      currentPage = old.page;
      zoom = old.zoom;
      host.replaceChildren(old.element);
      applyDimensions(old.geometry);
      viewport.scrollLeft = rollbackScroll.x;
      viewport.scrollTop = rollbackScroll.y;
    }
    freeSpread(fresh);
    stage.setAttribute("aria-busy", "false");
    notify("Não foi possível carregar esta página. Tente novamente.", { error: true });
  } finally {
    if (pendingRender === request) {
      pendingRender = null;
      zoomOrigin = null;
      controls();
      if (current && stage.getAttribute("aria-busy") !== "true") schedulePrefetch();
    }
  }
}

function navigate(direction) {
  if (!pdf || pendingRender || activeTurn || corner?.kind === "drag") return;
  const mode = displayMode(innerWidth, innerHeight);
  const target = direction > 0 ? nextPage(currentPage, total, mode) : previousPage(currentPage, total, mode);
  if (target === spreadForPage(currentPage, total, mode).anchor) return;
  render(target, { direction });
}

function zoomAnchor(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const localX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
  const localY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
  return { x: (viewport.scrollLeft + localX) / space.clientWidth, y: (viewport.scrollTop + localY) / space.clientHeight, localX, localY };
}

function setZoom(value, { clientX, clientY, live = false } = {}) {
  if (!pdf || textMode) return;
  const wanted = Math.round(Math.max(1, Math.min(3, value)) * 100) / 100;
  if (wanted === zoom && !live) return;
  if (current && zoomOrigin?.spread !== current) {
    zoomOrigin = { spread: current, scroll: { x: viewport.scrollLeft, y: viewport.scrollTop } };
  }
  abortCorner();
  clearPrepared();
  const anchor = zoomAnchor(clientX, clientY);
  zoom = wanted;
  controls();
  clearTimeout(zoomTimer);
  if (live && current) {
    // A new pinch pose supersedes an older rasterization immediately. Its
    // eventual rejection must never roll back the latest pointer position.
    if (pendingRender || activeTurn) {
      renderVersion += 1;
      cancelPending();
      pendingRender = null;
      stage.setAttribute("aria-busy", "false");
      message.hidden = true;
      controls();
    }
    applyDimensions(layout());
    viewport.scrollLeft = anchor.x * space.clientWidth - anchor.localX;
    viewport.scrollTop = anchor.y * space.clientHeight - anchor.localY;
    zoomTimer = setTimeout(() => render(currentPage, { anchor }), 140);
  } else render(currentPage, { anchor });
}

function toggleFullscreen() { return fullscreenMode.toggle(); }

function fullscreenFeedback(text) {
  announcement.textContent = text;
  notify(text, { compact: true });
  feedbackTimer = setTimeout(() => {
    if (stage.getAttribute("aria-busy") !== "true" && !message.classList.contains("is-error")) message.hidden = true;
  }, 5000);
}

const fullscreenMode = createReaderFullscreen({
  document, shell, button: fullscreen, feedback: fullscreenFeedback,
  onChange() { abortCorner(); clearPrepared(); },
});

async function updateTextContent() {
  const version = ++textVersion;
  if (!textMode || !current) return;
  const pages = current.pages.filter(Boolean);
  textView.setAttribute("aria-busy", "true");
  const loading = document.createElement("p");
  loading.textContent = "Carregando o texto destas páginas…";
  textView.replaceChildren(loading);
  textView.scrollTop = 0;
  const results = await Promise.allSettled(pages.map((number) => loadPageText(pdf, number, loadedPages, loadedText)));
  if (!textMode || version !== textVersion) return;
  const sections = results.map((result, index) => {
    const section = document.createElement("article");
    const heading = document.createElement("h2");
    heading.textContent = `Página ${pages[index]}`;
    section.append(heading);
    const content = document.createElement("div");
    content.className = "reader-text-content";
    content.textContent = result.status === "fulfilled"
      ? result.value.trim() ? result.value : "Esta página não contém texto extraível no PDF."
      : "Não foi possível carregar o texto desta página.";
    section.append(content);
    if (result.status === "rejected") {
      const retryText = document.createElement("button");
      retryText.type = "button";
      retryText.className = "reader-retry";
      retryText.textContent = "Tentar novamente";
      retryText.addEventListener("click", updateTextContent);
      section.append(retryText);
    }
    return section;
  });
  textView.replaceChildren(...sections);
  textView.setAttribute("aria-busy", "false");
}

function toggleTextView() {
  if (!pdf || !current || pendingRender) return;
  abortCorner();
  clearPrepared();
  textMode = !textMode;
  shell.classList.toggle("is-text-reading", textMode);
  textToggle.setAttribute("aria-pressed", String(textMode));
  textToggle.setAttribute("aria-label", textMode ? "Ver páginas do livro" : "Leitura em texto");
  textToggle.querySelector("span").textContent = textMode ? "Ver páginas" : "Leitura em texto";
  textToggle.title = textMode ? "Ver páginas do livro" : "Leitura em texto";
  viewport.setAttribute("aria-hidden", String(textMode));
  viewport.inert = textMode;
  edgeNavigation.setAttribute("aria-hidden", String(textMode));
  edgeNavigation.inert = textMode;
  textView.hidden = !textMode;
  textView.setAttribute("aria-busy", "false");
  controls();
  announcement.textContent = textMode ? "Leitura em texto ativada." : "Visualização das páginas ativada.";
  updateTextContent();
  if (textMode) textView.focus();
  else { viewport.focus({ preventScroll: true }); schedulePrefetch(); }
}

previous.addEventListener("click", () => navigate(-1));
next.addEventListener("click", () => navigate(1));
previousSide.addEventListener("click", () => navigate(-1));
nextSide.addEventListener("click", () => navigate(1));
zoomIn.addEventListener("click", () => setZoom(zoom + .25));
zoomOut.addEventListener("click", () => setZoom(zoom - .25));
zoomReset.addEventListener("click", () => setZoom(1));
fullscreen.addEventListener("click", toggleFullscreen);
textToggle.addEventListener("click", toggleTextView);
retry.addEventListener("click", () => pdf ? render() : location.reload());
$("#page-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pdf || !pageInput.reportValidity()) return;
  const target = clampPage(pageInput.value, total);
  if (current?.pages?.includes(target)) { updateJump(true); return; }
  render(target, { direction: target > currentPage ? 1 : target < currentPage ? -1 : 0 });
  pageInput.blur();
});
pageInput.addEventListener("input", () => updateJump(true));
pageInput.addEventListener("focus", () => pageInput.select());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && corner) { event.preventDefault(); abortCorner(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (textMode && ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key)) return;
  const actions = { ArrowRight: () => navigate(1), PageDown: () => navigate(1), ArrowLeft: () => navigate(-1), PageUp: () => navigate(-1), Home: () => render(1), End: () => render(total), "+": () => setZoom(zoom + .25), "=": () => setZoom(zoom + .25), "-": () => setZoom(zoom - .25), "0": () => setZoom(1), f: toggleFullscreen, F: toggleFullscreen };
  if (actions[event.key] && pdf) { event.preventDefault(); actions[event.key](); }
});
viewport.addEventListener("dblclick", (event) => {
  const box = host.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  const slot = current?.mode === "double" && event.clientX >= box.left + box.width / 2 ? 1 : 0;
  const overPage = inside && Boolean(current?.canvases[slot]);
  if (!overPage) return;
  setZoom(zoom > 1 ? 1 : 2, event);
});
viewport.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setZoom(zoom * Math.exp(-event.deltaY * .006), { clientX: event.clientX, clientY: event.clientY, live: true });
}, { passive: false });

viewport.addEventListener("pointerdown", (event) => {
  if (!pdf || pendingRender || activeTurn || event.button !== 0) return;
  const previewDirection = corner?.kind === "hover" ? hoverAt(event)?.direction || cornerAt(event.clientX, event.clientY) : 0;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  viewport.setPointerCapture(event.pointerId);
  if (pointers.size >= 2) {
    abortCorner();
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), zoom };
    gesture = null;
    return;
  }
  if (corner?.kind === "hover") {
    if (previewDirection === corner.direction && event.pointerType === "mouse") { grabCorner(corner, event); return; }
    abortCorner();
  }
  if (corner && !corner.held) {
    const box = host.getBoundingClientRect();
    if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
      grabCorner(corner, event);
      return;
    }
    abortCorner();
  }
  const direction = cornerAt(event.clientX, event.clientY);
  if (direction) { beginCorner(event, direction); return; }
  gesture = { x: event.clientX, y: event.clientY, start: performance.now(), scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop, moved: false };
});
viewport.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) {
    previewHover(event);
    return;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    if (pinch.distance > 0) setZoom(pinch.zoom * Math.hypot(b.x - a.x, b.y - a.y) / pinch.distance, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, live: true });
    return;
  }
  if (corner?.held && corner.pointerId === event.pointerId) { moveCorner(corner, event); return; }
  if (!gesture) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (Math.hypot(dx, dy) > 8) gesture.moved = true;
  if (zoom > 1 && gesture.moved) {
    viewport.classList.add("is-dragging");
    viewport.scrollLeft = gesture.scrollX - dx;
    viewport.scrollTop = gesture.scrollY - dy;
  }
});
function releasePointer(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  viewport.classList.remove("is-dragging");
  if (releaseCorner(event)) { gesture = null; return; }
  if (pinch) {
    pinch = null;
    gesture = null;
    clearTimeout(zoomTimer);
    render();
    return;
  }
  if (gesture && event.type === "pointerup" && zoom === 1) {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) navigate(dx < 0 ? 1 : -1);
  }
  gesture = null;
}
viewport.addEventListener("pointerup", releasePointer);
viewport.addEventListener("pointercancel", releasePointer);
viewport.addEventListener("lostpointercapture", releasePointer);
viewport.addEventListener("pointerleave", () => { viewport.classList.remove("is-corner-ready"); closeHover(); });
reducedMotion.addEventListener("change", () => { abortCorner(); activeTurn?.finish(); });
window.addEventListener("blur", () => {
  abortCorner();
  for (const id of pointers.keys()) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  pointers.clear();
  gesture = null;
  pinch = null;
  viewport.classList.remove("is-dragging");
});

const resize = new ResizeObserver(() => {
  if (!pdf) return;
  abortCorner();
  clearPrepared();
  gesture = null;
  pinch = null;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeTimer = undefined; render(currentPage, { center: zoom === 1 }); }, 100);
});
resize.observe(viewport);

async function initialize() {
  try {
    const session = await requestApi("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (!session.ok) {
      if (session.status === 401) clearSession();
      throw new Error("Session unavailable");
    }
    if (!(await session.json()).registered) { clearSession(); location.replace("./"); return; }
    const { getDocument, GlobalWorkerOptions } = await import("./vendor/pdfjs/pdf.mjs");
    GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
    const task = getDocument({
      ...getPdfSource(), rangeChunkSize: 262144,
      disableAutoFetch: true, disableStream: true, isEvalSupported: false,
      cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
      iccUrl: new URL("./vendor/pdfjs/iccs/", import.meta.url).href,
    });
    pdf = await task.promise;
    total = pdf.numPages;
    const firstPage = await pdf.getPage(1);
    loadedPages.set(1, firstPage);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    storageKey = `icfml-reading-position:${pdf.fingerprints[0] || "web"}`;
    let remembered = 1;
    try { remembered = localStorage.getItem(storageKey) || 1; } catch { /* Optional browser storage. */ }
    const linkedPage = new URLSearchParams(location.hash.slice(1)).get("page");
    currentPage = clampPage(linkedPage || remembered, total);
    // This PDF uses the same page size throughout; the actual first page is authoritative.
    pageRatio = firstViewport.width / firstViewport.height;
    await render(currentPage, { center: true });
  } catch {
    stage.setAttribute("aria-busy", "false");
    notify("Não foi possível abrir o livro. Confira sua conexão e tente novamente.", { error: true, compact: false });
  }
}
controls();
initialize();
