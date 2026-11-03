import { API_ORIGIN, ACCESS_TRANSPORT, SESSION_STORAGE_KEY } from "./runtime-config.mjs";

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_SECONDS = 3600;
const METHODS = new Map([
  ["/api/access", ["POST"]], ["/api/confirm", ["POST"]], ["/api/logout", ["POST"]],
  ["/api/session", ["GET"]], ["/api/book", ["GET", "HEAD"]],
]);
const AUTHENTICATED = new Set(["/api/session", "/api/book", "/api/logout"]);
const STORAGE_ERROR = "O navegador não permitiu manter o acesso nesta aba. Permita o armazenamento da sessão para continuar.";

function loopback(url) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

export function createApiClient({
  apiOrigin = API_ORIGIN, transport = ACCESS_TRANSPORT, storageKey = SESSION_STORAGE_KEY,
  windowObject = globalThis.window, fetchImpl = globalThis.fetch, now = Date.now,
} = {}) {
  if (!["cookie", "bearer"].includes(transport) || typeof fetchImpl !== "function" || typeof now !== "function"
      || typeof storageKey !== "string" || !/^icfml-book:[A-Za-z0-9:_-]{1,100}$/u.test(storageKey)) {
    throw new TypeError("Configuração de acesso inválida.");
  }
  const page = new URL(windowObject.location.href);
  const target = new URL(apiOrigin || page.origin);
  if (target.username || target.password || target.search || target.hash || target.pathname !== "/"
      || (target.protocol !== "https:" && !(target.protocol === "http:" && page.protocol === "http:" && loopback(page) && loopback(target)))
      || (transport === "cookie" && target.origin !== page.origin)) {
    throw new TypeError("Endereço de acesso inválido.");
  }
  const bearer = transport === "bearer";

  function storage() {
    try {
      const value = windowObject.sessionStorage;
      if (!value || typeof value.getItem !== "function" || typeof value.setItem !== "function" || typeof value.removeItem !== "function") throw new Error();
      return value;
    } catch {
      throw new Error(STORAGE_ERROR);
    }
  }

  function clearSession() {
    if (bearer) {
      try { storage().removeItem(storageKey); } catch { /* No private fallback storage. */ }
    }
  }

  function readSession() {
    if (!bearer) return null;
    try {
      const raw = storage().getItem(storageKey);
      if (!raw) return null;
      if (raw.length > 512) throw new Error();
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Object.keys(value).length !== 2
          || typeof value.accessToken !== "string" || !TOKEN.test(value.accessToken) || !Number.isFinite(value.expiresAt)
          || value.expiresAt <= now() || value.expiresAt > now() + MAX_SECONDS * 1000) throw new Error();
      return value;
    } catch {
      clearSession();
      return null;
    }
  }

  function prepareSession() {
    if (!bearer) return;
    try {
      const value = storage();
      const probe = storageKey + ":probe";
      value.setItem(probe, "1");
      if (value.getItem(probe) !== "1") throw new Error();
      value.removeItem(probe);
    } catch {
      throw new Error(STORAGE_ERROR);
    }
  }

  function acceptSession(result) {
    if (result?.registered !== true) throw new Error("Não foi possível confirmar o acesso.");
    if (!bearer) return true;
    if (typeof result.accessToken !== "string" || !TOKEN.test(result.accessToken) || !Number.isInteger(result.expiresIn) || result.expiresIn < 1 || result.expiresIn > MAX_SECONDS) {
      throw new Error("Não foi possível manter o acesso nesta aba. Solicite um novo link.");
    }
    prepareSession();
    const value = { accessToken: result.accessToken, expiresAt: now() + result.expiresIn * 1000 };
    try {
      storage().setItem(storageKey, JSON.stringify(value));
      if (readSession()?.accessToken !== value.accessToken) throw new Error();
    } catch {
      clearSession();
      throw new Error(STORAGE_ERROR);
    }
    return true;
  }

  async function requestApi(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    if (!METHODS.get(path)?.includes(method)) throw new TypeError("Solicitação de acesso inválida.");
    const headers = new Headers(options.headers);
    if (headers.has("Authorization")) throw new TypeError("Cabeçalho de acesso inválido.");
    const session = bearer && AUTHENTICATED.has(path) ? readSession() : null;
    if (session) headers.set("Authorization", "Bearer " + session.accessToken);
    const response = await fetchImpl(new URL(path, target.origin).href, {
      ...options, method, headers, cache: "no-store", redirect: "error",
      mode: bearer ? "cors" : "same-origin", credentials: bearer ? "omit" : "same-origin",
    });
    // An obsolete response must not remove a newer confirmed session.
    if (bearer && session && response.status === 401 && readSession()?.accessToken === session.accessToken) clearSession();
    return response;
  }

  function getPdfSource() {
    const session = readSession();
    if (bearer && !session) throw new Error("Seu acesso expirou. Solicite um novo link para continuar a leitura.");
    return {
      url: new URL("/api/book", target.origin).href,
      withCredentials: !bearer,
      httpHeaders: session ? { Authorization: "Bearer " + session.accessToken } : {},
    };
  }

  return { requestApi, prepareSession, acceptSession, clearSession, getPdfSource };
}

let singleton;
function client() { return singleton ||= createApiClient(); }
export function requestApi(path, options) { return client().requestApi(path, options); }
export function prepareSession() { return client().prepareSession(); }
export function acceptSession(result) { return client().acceptSession(result); }
export function clearSession() { return client().clearSession(); }
export function getPdfSource() { return client().getPdfSource(); }
