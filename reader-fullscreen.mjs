// Native fullscreen is optional (not available for book elements on iPhone).
// Keep the same reader and its session when expanding within the browser instead.
export function createReaderFullscreen({ document, shell, button, onChange, feedback }) {
  let expanded = false;
  let pending = false;
  let nativeRequested = false;
  let nativeTimer;
  let lastMode;

  const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function nativeApi() {
    if (typeof shell.requestFullscreen === "function" && typeof document.exitFullscreen === "function" && document.fullscreenEnabled !== false) {
      return { request: shell.requestFullscreen, exit: document.exitFullscreen };
    }
    if (typeof shell.webkitRequestFullscreen === "function" && typeof document.webkitExitFullscreen === "function" && document.webkitFullscreenEnabled !== false) {
      return { request: shell.webkitRequestFullscreen, exit: document.webkitExitFullscreen };
    }
    return null;
  }

  function sync() {
    if (nativeElement() === shell) expanded = false;
    const mode = nativeElement() === shell ? "native" : expanded ? "expanded" : "normal";
    const active = mode !== "normal";
    const native = Boolean(nativeApi());
    shell.classList.toggle("is-reading-expanded", mode === "expanded");
    button.dataset.fullscreenMode = mode;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active
      ? mode === "expanded" ? "Sair da leitura ampliada" : "Sair da tela cheia"
      : native ? "Entrar em tela cheia" : "Ampliar área de leitura");
    button.title = active
      ? mode === "expanded" ? "Sair da leitura ampliada (Esc)" : "Sair da tela cheia (Esc)"
      : native ? "Tela cheia (F)" : "Ampliar leitura (F)";
    button.querySelector("span").textContent = active ? "Sair" : native ? "Tela cheia" : "Ampliar leitura";
    if (mode !== lastMode) {
      const initialized = lastMode !== undefined;
      lastMode = mode;
      if (initialized) onChange();
    }
  }

  function setExpanded(value) {
    const changed = expanded !== value;
    expanded = value;
    sync();
    if (value && changed) {
      // The header is hidden in this mode; never leave keyboard focus inside it.
      button.focus({ preventScroll: true });
      feedback("Leitura ampliada ativada. A barra do navegador pode permanecer visível.");
    }
  }

  async function toggle() {
    if (pending) return;
    if (expanded) { setExpanded(false); return; }
    const api = nativeApi();
    if (!api) { setExpanded(true); return; }
    pending = true;
    const exiting = nativeElement() === shell;
    nativeRequested = !exiting;
    let waitForEvent = false;
    try {
      const result = exiting ? api.exit.call(document) : api.request.call(shell);
      if (result && typeof result.then === "function") await result;
      else if (exiting ? nativeElement() === shell : nativeRequested && nativeElement() !== shell) {
        // Older WebKit returns void; keep repeated taps locked until its event.
        waitForEvent = true;
        nativeTimer = setTimeout(() => {
          pending = false;
          nativeRequested = false;
          nativeTimer = undefined;
          if (exiting && nativeElement() === shell) feedback("Para sair da tela cheia, use o controle do navegador ou pressione Esc.");
          else if (!exiting && nativeElement() !== shell) setExpanded(true);
          else sync();
        }, 1500);
      }
      sync();
    } catch {
      nativeRequested = false;
      if (exiting) feedback("Para sair da tela cheia, use o controle do navegador ou pressione Esc.");
      else if (nativeElement() !== shell) setExpanded(true);
      else sync();
    } finally { if (!waitForEvent) pending = false; }
  }

  function nativeChange() {
    clearTimeout(nativeTimer);
    nativeTimer = undefined;
    pending = false;
    nativeRequested = false;
    sync();
  }
  function nativeError() {
    if (pending && !nativeRequested && nativeElement() === shell) {
      clearTimeout(nativeTimer);
      nativeTimer = undefined;
      pending = false;
      feedback("Para sair da tela cheia, use o controle do navegador ou pressione Esc.");
      return;
    }
    if (nativeRequested && nativeElement() !== shell) {
      clearTimeout(nativeTimer);
      nativeTimer = undefined;
      pending = false;
      nativeRequested = false;
      setExpanded(true);
    }
  }
  document.addEventListener("fullscreenchange", nativeChange);
  document.addEventListener("webkitfullscreenchange", nativeChange);
  document.addEventListener("fullscreenerror", nativeError);
  document.addEventListener("webkitfullscreenerror", nativeError);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
    }
  });
  sync();
  return { toggle };
}
