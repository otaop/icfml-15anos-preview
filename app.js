"use strict";

const form = document.querySelector("#access-form");
const nameInput = document.querySelector("#access-name");
const emailInput = document.querySelector("#access-email");
const submitButton = document.querySelector("#continue-button");
const buttonLabel = submitButton.querySelector(".button-label");
const message = document.querySelector("#form-message");
const editButton = document.querySelector("#edit-registration");
const heading = document.querySelector("#access-heading");
const description = document.querySelector("#access-description");
const demoNotice = document.querySelector("#demo-notice");
const pending = document.querySelector("#access-pending");
const pendingEmail = document.querySelector("#pending-email");
const pendingMessage = document.querySelector("#pending-message");
const resendButton = document.querySelector("#resend-confirmation");
const correctButton = document.querySelector("#correct-email");
let returning = false;
let demo = false;
let sending = false;
let contact = null;
let resendAt = 0;
let requestBlockedAt = 0;
let requestBlockCode = "RATE_LIMIT";
let logoutBlockedAt = 0;
let rateNotice;
let countdown;
let activeRequest;
let interactionVersion = 0;

function getApiClient() {
  return import("./api-client.mjs");
}

function setFieldError(input, text) {
  const error = input === nameInput ? "#name-error" : "#email-error";
  document.querySelector(error).textContent = text;
  if (text) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function idleLabel() {
  return returning ? "Continuar a leitura" : demo ? "Continuar" : "Receber ligação de acesso";
}

function remainingSeconds(deadline) {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function waitLabel(seconds) {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
}

function retryDelay(response, result) {
  const header = response.headers.get("Retry-After");
  const headerSeconds = /^\d{1,4}$/u.test(header || "") ? Number(header) : NaN;
  if (Number.isInteger(headerSeconds) && headerSeconds >= 1 && headerSeconds <= 3600) return headerSeconds;
  const bodySeconds = result?.retryAfterSeconds;
  return Number.isInteger(bodySeconds) && bodySeconds >= 1 && bodySeconds <= 3600 ? bodySeconds : 60;
}

function limitMessage(code, seconds, logout = false) {
  if (!seconds) return logout ? "Já pode tentar alterar o registo novamente." : "O prazo de espera terminou. Pode tentar novamente.";
  if (logout) return "Aguarde até o botão ‘Utilizar outro registo’ estar disponível antes de tentar alterar o registo. Pode continuar a leitura com o seu acesso atual.";
  if (code === "EMAIL_SERVICE_LIMIT") return "Foi atingido temporariamente o limite de envio de e-mails. Aguarde o prazo indicado no botão antes de tentar novamente. Se já recebeu uma ligação, pode utilizá-la para confirmar o acesso.";
  if (code === "ACCESS_RATE_LIMIT") return "Há muitos pedidos desta rede. Aguarde o prazo indicado no botão antes de solicitar outra ligação. Se já recebeu um e-mail, pode confirmar através da ligação existente.";
  if (code === "AUTH_RATE_LIMIT") return "Há muitos pedidos de acesso neste momento. Aguarde o prazo indicado no botão antes de tentar novamente. Se já recebeu uma ligação, pode utilizá-la para confirmar o acesso.";
  return "O limite temporário de pedidos foi atingido. Aguarde o prazo indicado no botão antes de tentar novamente.";
}

function showLimitNotice(error, target, { logout = false } = {}) {
  const seconds = error.retryAfter;
  const deadline = Date.now() + seconds * 1000;
  if (logout) logoutBlockedAt = Math.max(logoutBlockedAt, deadline);
  else {
    requestBlockedAt = Math.max(requestBlockedAt, deadline);
    requestBlockCode = error.code;
  }
  rateNotice = { target, code: error.code, logout, expired: false };
  target.textContent = limitMessage(error.code, remainingSeconds(logout ? logoutBlockedAt : requestBlockedAt), logout);
  target.classList.remove("is-information");
  ensureCountdown();
  updateCountdown();
}

function ensureCountdown() {
  if (!countdown) countdown = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const requestRemaining = remainingSeconds(requestBlockedAt);
  const logoutRemaining = remainingSeconds(logoutBlockedAt);
  const remaining = Math.max(remainingSeconds(resendAt), requestRemaining);
  submitButton.disabled = sending || (!returning && requestRemaining > 0);
  buttonLabel.textContent = sending ? demo ? "A abrir…" : "A enviar ligação…"
    : !returning && requestRemaining ? `Solicitar novamente em ${waitLabel(requestRemaining)}` : idleLabel();
  resendButton.disabled = sending || !contact || remaining > 0;
  resendButton.textContent = sending ? "A enviar…" : remaining ? `Reenviar e-mail em ${waitLabel(remaining)}` : "Reenviar e-mail";
  editButton.disabled = sending || logoutRemaining > 0;
  if (logoutRemaining) editButton.setAttribute("aria-label", `Utilizar outro registo em ${waitLabel(logoutRemaining)}`);
  else editButton.removeAttribute("aria-label");
  if (rateNotice && !rateNotice.expired && !remainingSeconds(rateNotice.logout ? logoutBlockedAt : requestBlockedAt)) {
    rateNotice.target.textContent = limitMessage(rateNotice.code, 0, rateNotice.logout);
    rateNotice.expired = true;
  }
  if (!remaining && !logoutRemaining && countdown) { clearInterval(countdown); countdown = undefined; }
}

function startCountdown(seconds) {
  const delay = Number.isFinite(Number(seconds)) ? Math.min(3600, Math.max(1, Math.ceil(Number(seconds)))) : 60;
  resendAt = Date.now() + delay * 1000;
  ensureCountdown();
  updateCountdown();
}

function setLoading(loading) {
  sending = loading;
  submitButton.setAttribute("aria-busy", String(loading));
  resendButton.setAttribute("aria-busy", String(loading));
  correctButton.disabled = loading;
  nameInput.readOnly = loading;
  emailInput.readOnly = loading;
  updateCountdown();
}

function discardPending() {
  contact = null;
  pendingEmail.textContent = "";
  pendingMessage.textContent = "";
  pendingMessage.classList.remove("is-information");
  resendAt = 0;
  if (rateNotice?.target === pendingMessage) rateNotice = undefined;
  updateCountdown();
}

function showForm({ focus = true } = {}) {
  interactionVersion += 1;
  discardPending();
  pending.hidden = true;
  form.hidden = false;
  returning = false;
  editButton.hidden = true;
  for (const field of form.querySelectorAll(".field")) field.hidden = false;
  heading.textContent = "Aceda ao livro";
  description.textContent = demo ? "Indique o seu nome e e-mail para começar a leitura." : "Indique o seu nome e e-mail para receber a ligação de acesso.";
  message.textContent = "";
  if (remainingSeconds(requestBlockedAt)) {
    rateNotice = { target: message, code: requestBlockCode, logout: false, expired: false };
    message.textContent = limitMessage(requestBlockCode, remainingSeconds(requestBlockedAt));
  }
  updateCountdown();
  if (focus) nameInput.focus();
}

function showPending(resendAfter) {
  form.hidden = true;
  editButton.hidden = true;
  heading.textContent = "Verifique o seu e-mail";
  description.textContent = "Só falta confirmar o seu endereço de e-mail para aceder ao livro.";
  pendingEmail.textContent = contact.email;
  pendingMessage.textContent = "";
  pending.hidden = false;
  startCountdown(resendAfter);
  pending.focus({ preventScroll: true });
}

async function sendAccess(person) {
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const client = await getApiClient();
    const response = await client.requestApi("/api/access", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(person), signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || !(result.registered || result.confirmationRequired)) {
      const error = new Error("Não foi possível enviar a ligação agora. Tente novamente dentro de instantes.");
      if (response.status === 429) {
        error.code = ["EMAIL_SERVICE_LIMIT", "AUTH_RATE_LIMIT", "ACCESS_RATE_LIMIT"].includes(result?.code) ? result.code : "RATE_LIMIT";
        error.retryAfter = retryDelay(response, result);
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("A ligação demorou mais do que o esperado. Tente novamente.");
    if (error instanceof TypeError) throw new Error("Não foi possível estabelecer a ligação. Verifique a sua ligação à Internet e tente novamente.");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeRequest === controller) activeRequest = undefined;
  }
}

for (const input of [nameInput, emailInput]) {
  input.addEventListener("input", () => {
    interactionVersion += 1;
    setFieldError(input, "");
    if (!remainingSeconds(requestBlockedAt)) { message.textContent = ""; if (rateNotice?.target === message) rateNotice = undefined; }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || submitButton.disabled || (!returning && remainingSeconds(requestBlockedAt))) return;
  interactionVersion += 1;
  if (returning) { window.location.assign("reader.html"); return; }
  message.textContent = "";
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const validName = name.length > 0 && name.length <= 120 && !/[\u0000-\u001f\u007f<>]/u.test(name);
  const validEmail = email.length <= 254 && emailInput.validity.valid && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email) && !/[\u0000-\u001f\u007f]/u.test(email);
  setFieldError(nameInput, validName ? "" : "Indique um nome com até 120 caracteres.");
  setFieldError(emailInput, validEmail ? "" : "Indique um endereço de e-mail válido.");
  if (!validName || !validEmail) { (validName ? emailInput : nameInput).focus(); return; }
  setLoading(true);
  const requestVersion = interactionVersion;
  try {
    const result = await sendAccess({ name, email });
    if (requestVersion !== interactionVersion) return;
    nameInput.value = "";
    emailInput.value = "";
    if (result.registered) {
      discardPending();
      window.location.assign("reader.html");
      return;
    }
    contact = { name, email };
    showPending(result.resendAfter || 60);
  } catch (error) {
    if (requestVersion === interactionVersion) {
      if (error.retryAfter) showLimitNotice(error, message);
      else message.textContent = error.message;
    }
  } finally { if (!activeRequest) setLoading(false); }
});

resendButton.addEventListener("click", async () => {
  if (sending || resendButton.disabled || !contact || Date.now() < resendAt || remainingSeconds(requestBlockedAt)) return;
  interactionVersion += 1;
  pendingMessage.textContent = "";
  setLoading(true);
  const requestVersion = interactionVersion;
  try {
    const result = await sendAccess(contact);
    if (requestVersion !== interactionVersion) return;
    if (result.registered) { discardPending(); window.location.assign("reader.html"); return; }
    startCountdown(result.resendAfter || 60);
    pendingMessage.textContent = "Pedido recebido. Verifique a sua caixa de entrada e a pasta de spam.";
    pendingMessage.classList.add("is-information");
  } catch (error) {
    if (requestVersion !== interactionVersion) return;
    pendingMessage.classList.remove("is-information");
    pendingMessage.textContent = error.message;
    if (error.retryAfter) showLimitNotice(error, pendingMessage);
  } finally { if (!activeRequest) setLoading(false); }
});

correctButton.addEventListener("click", () => {
  if (sending) return;
  const previous = contact;
  showForm({ focus: false });
  if (previous) { nameInput.value = previous.name; emailInput.value = previous.email; }
  emailInput.focus();
});
editButton.addEventListener("click", async () => {
  if (sending || editButton.disabled || remainingSeconds(logoutBlockedAt)) return;
  sending = true;
  editButton.disabled = true;
  submitButton.disabled = true;
  interactionVersion += 1;
  const requestVersion = interactionVersion;
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const client = await getApiClient();
    const response = await client.requestApi("/api/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
    });
    if (requestVersion !== interactionVersion) return;
    if (!response.ok) {
      const error = new Error("Não foi possível terminar o acesso. Tente novamente.");
      if (response.status === 429) {
        const result = await response.json().catch(() => null);
        error.code = "LOGOUT_RATE_LIMIT";
        error.retryAfter = retryDelay(response, result);
      }
      throw error;
    }
    client.clearSession();
    showForm();
  } catch (error) {
    if (requestVersion === interactionVersion) {
      if (error.retryAfter) showLimitNotice(error, message, { logout: true });
      else message.textContent = "Não foi possível terminar o acesso. Tente novamente.";
    }
  } finally {
    clearTimeout(timeout);
    if (activeRequest === controller) {
      activeRequest = undefined;
      sending = false;
      updateCountdown();
    }
  }
});
window.addEventListener("pagehide", () => {
  interactionVersion += 1;
  activeRequest?.abort();
  showForm({ focus: false });
  setLoading(false);
  clearInterval(countdown);
  countdown = undefined;
  nameInput.value = "";
  emailInput.value = "";
});
window.addEventListener("pageshow", () => {
  if (remainingSeconds(requestBlockedAt) || remainingSeconds(logoutBlockedAt) || remainingSeconds(resendAt)) ensureCountdown();
  updateCountdown();
});

// HTML starts disabled: native fallback cannot place personal data in a URL.
submitButton.disabled = false;
const sessionVersion = interactionVersion;
getApiClient()
  .then(async (client) => {
    const response = await client.requestApi("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 && interactionVersion === sessionVersion) client.clearSession();
    if (!response.ok) return null;
    const session = await response.json();
    if (!session?.registered && interactionVersion === sessionVersion) client.clearSession();
    return session;
  })
  .then((session) => {
    demo = session?.demo === true;
    demoNotice.hidden = !demo;
    if (interactionVersion !== sessionVersion || sending || !pending.hidden) return;
    buttonLabel.textContent = idleLabel();
    description.textContent = demo ? "Indique o seu nome e e-mail para começar a leitura." : "Indique o seu nome e e-mail para receber a ligação de acesso.";
    if (!session?.registered || nameInput.value || emailInput.value || document.activeElement === nameInput || document.activeElement === emailInput) return;
    returning = true;
    for (const field of form.querySelectorAll(".field")) field.hidden = true;
    buttonLabel.textContent = idleLabel();
    description.textContent = "O seu acesso está pronto. Continue a leitura do livro.";
    editButton.hidden = false;
  })
  .catch(() => {});
