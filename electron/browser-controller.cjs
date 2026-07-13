const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_CONTENT_LENGTH = 64 * 1024;
const MAX_INTERACTIVE_ITEMS = 100;
const MAX_FIELD_LENGTH = 4_000;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const VISIBLE_TEXT_SCRIPT = 'document.body?.innerText || ""';
const TARGET_ATTRIBUTE = "data-korda-target";

function inspectScript(prefix) {
  return `(() => {
    const prefix = ${JSON.stringify(prefix)};
    const attr = ${JSON.stringify(TARGET_ATTRIBUTE)};
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const sensitive = (element) => {
      const value = [element.type, element.name, element.autocomplete, element.id].join(" ").toLowerCase();
      const autocomplete = String(element.autocomplete || "").toLowerCase();
      return autocomplete.startsWith("cc-") || /password|passwd|secret|token|one-time|otp|credit|card|cvc|cvv/.test(value);
    };
    document.querySelectorAll("[" + attr + "]").forEach((element) => element.removeAttribute(attr));
    return [...document.querySelectorAll("a[href],button,input,textarea,select,[role=button]")]
      .filter(visible).slice(0, ${MAX_INTERACTIVE_ITEMS}).map((element, index) => {
        const id = prefix + ":" + index;
        const tag = element.tagName.toLowerCase();
        const inputType = String(element.type || "").toLowerCase();
        const textInput = tag === "textarea" || (tag === "input" && ["", "text", "search", "email", "url", "tel", "number"].includes(inputType));
        const field = textInput || tag === "select" || (tag === "input" && !["button", "submit", "reset", "checkbox", "radio"].includes(inputType));
        const isSensitive = field && sensitive(element);
        const requiresConfirmation = !field && ((tag === "button" || tag === "input" || element.getAttribute("role") === "button") && Boolean(element.closest("form")) || ["submit", "image"].includes(inputType));
        element.setAttribute(attr, id);
        return {
          id,
          kind: field ? "field" : "action",
          tag,
          label: (element.innerText || element.getAttribute("aria-label") || element.labels?.[0]?.innerText || element.placeholder || element.name || "").trim().slice(0, 200),
          type: String(element.type || "").slice(0, 32),
          fillable: textInput && !isSensitive && !element.disabled && !element.readOnly,
          sensitive: isSensitive,
          requiresConfirmation,
        };
      });
  })()`;
}

function targetScript(action, id, value = "") {
  return `(() => {
    const id = ${JSON.stringify(id)};
    const attr = ${JSON.stringify(TARGET_ATTRIBUTE)};
    const element = [...document.querySelectorAll("[" + attr + "]")].find((item) => item.getAttribute(attr) === id);
    if (!element || !element.isConnected) return { ok: false };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) return { ok: false };
    ${action === "activate" ? `
      const tag = element.tagName.toLowerCase();
      const inputType = String(element.type || "").toLowerCase();
      if (((tag === "button" || tag === "input" || element.getAttribute("role") === "button") && element.closest("form")) || ["submit", "image"].includes(inputType)) return { ok: false, confirmation: true };
      element.click();
      return { ok: true };
    ` : `
      const tag = element.tagName.toLowerCase();
      const inputType = String(element.type || "").toLowerCase();
      const sensitive = [element.type, element.name, element.autocomplete, element.id].join(" ").toLowerCase();
      const autocomplete = String(element.autocomplete || "").toLowerCase();
      const textInput = tag === "textarea" || (tag === "input" && ["", "text", "search", "email", "url", "tel", "number"].includes(inputType));
      if (!textInput || element.disabled || element.readOnly || autocomplete.startsWith("cc-") || /password|passwd|secret|token|one-time|otp|credit|card|cvc|cvv/.test(sensitive)) return { ok: false, blocked: true };
      const value = ${JSON.stringify(value)};
      const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value); else element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    `}
  })()`;
}

function safeUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw new TypeError("URL inválida.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Apenas URLs HTTP e HTTPS são permitidas.");
  if (url.username || url.password) throw new Error("Credenciais não são permitidas na URL.");
  return url.href;
}

function createBrowserController({ getWorkspaceRoot }) {
  if (typeof getWorkspaceRoot !== "function") throw new TypeError("getWorkspaceRoot é obrigatório.");
  const views = new Map();
  const inventories = new Map();

  function get(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new TypeError("ID de navegador inválido.");
    const contents = views.get(id);
    if (!contents || contents.isDestroyed?.()) throw new Error("Navegador não encontrado.");
    return contents;
  }

  function register(id, contents) {
    if (!contents || typeof contents !== "object") throw new TypeError("WebContents inválido.");
    getId(id);
    views.set(id, contents);
    inventories.delete(id);
    contents.once?.("destroyed", () => {
      if (views.get(id) === contents) {
        views.delete(id);
        inventories.delete(id);
      }
    });
    return true;
  }

  function getId(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new TypeError("ID de navegador inválido.");
    return id;
  }

  function unregister(id, guestId) {
    const current = views.get(getId(id));
    if (!current || (guestId !== undefined && current.id !== guestId)) return false;
    inventories.delete(id);
    return views.delete(id);
  }

  async function screenshot(contents, requestedPath) {
    const workspace = getWorkspaceRoot();
    if (!workspace) throw new Error("Escolha uma pasta de trabalho primeiro.");
    const root = fs.realpathSync(workspace);
    const fileName = requestedPath || `korda-browser-${Date.now()}.png`;
    if (typeof fileName !== "string" || !fileName || path.basename(fileName) !== fileName) throw new Error("A captura deve ficar na raiz da pasta de trabalho.");
    const target = path.join(root, fileName);
    if (path.extname(target).toLowerCase() !== ".png") throw new Error("A captura deve usar a extensão .png.");
    const image = await contents.capturePage();
    const handle = await fs.promises.open(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { await handle.writeFile(image.toPNG()); } finally { await handle.close(); }
    return target;
  }

  async function command(id, action, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Opções inválidas.");
    const contents = get(id);
    switch (action) {
      case "info":
        return { url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading() };
      case "navigate":
        inventories.delete(id);
        await contents.loadURL(safeUrl(options.url));
        return contents.getURL();
      case "content": {
        const text = await contents.executeJavaScript(VISIBLE_TEXT_SCRIPT, true);
        return String(text || "").slice(0, MAX_CONTENT_LENGTH);
      }
      case "screenshot":
        return screenshot(contents, options.path);
      case "inspect": {
        const prefix = crypto.randomBytes(12).toString("hex");
        const raw = await contents.executeJavaScript(inspectScript(prefix), true);
        const items = (Array.isArray(raw) ? raw : []).slice(0, MAX_INTERACTIVE_ITEMS).flatMap((item) => {
          if (!item || typeof item !== "object" || typeof item.id !== "string" || !new RegExp(`^${prefix}:\\d{1,3}$`).test(item.id)) return [];
          return [{
            id: item.id.slice(0, 32),
            kind: item.kind === "field" ? "field" : "action",
            label: String(item.label || "").slice(0, 200),
            type: String(item.type || "").slice(0, 32),
            fillable: item.fillable === true && item.sensitive !== true,
            requiresConfirmation: item.requiresConfirmation === true,
          }];
        });
        inventories.set(id, { url: contents.getURL(), items: new Map(items.map((item) => [item.id, item])) });
        return items;
      }
      case "activate":
      case "fill": {
        const inventory = inventories.get(id);
        const targetId = typeof options.id === "string" ? options.id : "";
        const target = inventory?.items.get(targetId);
        if (!inventory || inventory.url !== contents.getURL() || !target) throw new Error("Elemento interativo inexistente ou obsoleto. Inspecione a página novamente.");
        if (action === "activate" && target.kind !== "action") throw new Error("Este elemento não pode ser ativado diretamente.");
        if (action === "activate" && target.requiresConfirmation) throw new Error("Esta ação exige confirmação humana, ainda não disponível.");
        if (action === "fill" && !target.fillable) throw new Error("Este campo não pode ser preenchido com segurança.");
        const value = action === "fill" && typeof options.value === "string" ? options.value.slice(0, MAX_FIELD_LENGTH) : "";
        if (action === "fill" && !value) throw new Error("Informe um texto para preencher o campo.");
        const result = await contents.executeJavaScript(targetScript(action, targetId, value), true);
        if (!result?.ok) {
          inventory.items.delete(targetId);
          if (result?.confirmation) throw new Error("Esta ação exige confirmação humana, ainda não disponível.");
          if (result?.blocked) throw new Error("Este campo não pode ser preenchido com segurança.");
          throw new Error("Elemento interativo inexistente ou obsoleto. Inspecione a página novamente.");
        }
        return action === "fill" ? "Campo preenchido." : "Elemento ativado.";
      }
      default:
        throw new Error("Ação de navegador inválida.");
    }
  }

  return { register, unregister, command };
}

module.exports = { createBrowserController, MAX_CONTENT_LENGTH, MAX_INTERACTIVE_ITEMS, MAX_FIELD_LENGTH };
