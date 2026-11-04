"use strict";

// The fragment stays in memory only. Loading this document never consumes it.
let confirmationToken = "";
try {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const value = fragment.get("token");
  if (fragment.getAll("token").length === 1 && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/iu.test(value || "")) confirmationToken = value.toLowerCase();
  window.history.replaceState(null, "", window.location.pathname);
} catch {
  confirmationToken = "";
}

function getApiClient() {
  return import("./api-client.mjs");
}

function initializeConfirmation() {
  const button = document.querySelector("#confirm-button");
  const label = button.querySelector(".button-label");
  const title = document.querySelector("#confirm-title");
  const description = document.querySelector("#confirm-description");
  const message = document.querySelector("#confirmation-message");
  const help = document.querySelector(".confirmation-help");
  let sending = false;
  let activeRequest;
  let needsEmailReview = false;
  let blockedUntil = 0;
  let countdown;
  let limitNotice = false;

  function remainingSeconds() {
    return Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
  }

  function waitLabel(seconds) {
    return seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
  }

  function retryDelay(response, result) {
    const header = response.headers.get("Retry-After");
    const value = /^\d{1,4}$/u.test(header || "") ? Number(header) : NaN;
    if (Number.isInteger(value) && value >= 1 && value <= 3600) return value;
    return Number.isInteger(result?.retryAfterSeconds) && result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 3600 ? result.retryAfterSeconds : 60;
  }

  function updateButton() {
    const remaining = remainingSeconds();
    button.disabled = sending || !confirmationToken || remaining > 0;
    button.setAttribute("aria-busy", String(sending));
    label.textContent = sending ? "A confirmar…" : remaining ? `Confirmar novamente em ${waitLabel(remaining)}` : "Confirmar e aceder ao livro";
    if (!remaining && countdown) { clearInterval(countdown); countdown = undefined; }
    if (!remaining && limitNotice && confirmationToken) {
      message.textContent = "O prazo de espera terminou. Pode tentar confirmar novamente.";
      limitNotice = false;
    }
  }

  function unavailable() {
    confirmationToken = "";
    blockedUntil = 0;
    limitNotice = false;
    clearInterval(countdown);
    countdown = undefined;
    button.disabled = true;
    title.textContent = "Ligação indisponível";
    description.textContent = "Esta ligação está incompleta, expirou ou já foi utilizada. Solicite um novo e-mail para continuar.";
    message.textContent = "";
    label.textContent = "Confirmar e aceder ao livro";
  }

  function emailChangeReview() {
    confirmationToken = "";
    blockedUntil = 0;
    limitNotice = false;
    clearInterval(countdown);
    countdown = undefined;
    needsEmailReview = true;
    button.disabled = true;
    title.textContent = "O registo precisa de atualização";
    description.textContent = "O endereço deste acesso foi alterado. Entre em contacto com a equipa responsável para atualizar o seu registo.";
    message.textContent = "";
    help.textContent = "Voltar à página inicial";
    title.setAttribute("tabindex", "-1");
    title.focus();
  }

  button.addEventListener("click", async () => {
    if (sending || button.disabled || !confirmationToken || remainingSeconds()) return;
    sending = true;
    limitNotice = false;
    updateButton();
    message.textContent = "";
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const client = await getApiClient();
      if (!confirmationToken) return;
      client.prepareSession();
      const response = await client.requestApi("/api/confirm", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: confirmationToken }), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!confirmationToken) return;
      if (response.status === 409 && result?.code === "EMAIL_CHANGE_REVIEW") { emailChangeReview(); return; }
      if ([400, 404, 409, 410].includes(response.status)) { unavailable(); return; }
      if (response.status === 429) {
        const seconds = retryDelay(response, result);
        blockedUntil = Math.max(blockedUntil, Date.now() + seconds * 1000);
        limitNotice = true;
        const prefix = result?.code === "AUTH_RATE_LIMIT" ? "Há muitos pedidos de acesso neste momento." : "O limite temporário de confirmações foi atingido.";
        message.textContent = `${prefix} Aguarde o prazo indicado no botão antes de confirmar novamente. Mantenha esta página aberta para tentar novamente quando a espera terminar.`;
        if (!countdown) countdown = setInterval(updateButton, 1000);
        return;
      }
      if (!response.ok || !result?.registered) {
        throw new Error("Não foi possível confirmar agora. Tente novamente dentro de instantes.");
      }
      client.acceptSession(result);
      confirmationToken = "";
      window.location.assign("reader.html");
    } catch (error) {
      if (!confirmationToken) return;
      message.textContent = error.name === "AbortError"
        ? "A ligação demorou mais do que o esperado. Tente confirmar novamente."
        : error instanceof TypeError
          ? "Não foi possível estabelecer a ligação. Verifique a sua ligação à Internet e tente novamente."
          : error.message;
    } finally {
      clearTimeout(timeout);
      if (activeRequest === controller) activeRequest = undefined;
      sending = false;
      updateButton();
    }
  });

  window.addEventListener("pagehide", () => {
    activeRequest?.abort();
    clearInterval(countdown);
    countdown = undefined;
    if (!needsEmailReview) unavailable();
  });
  if (confirmationToken) button.disabled = false;
  else unavailable();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeConfirmation, { once: true });
else initializeConfirmation();
