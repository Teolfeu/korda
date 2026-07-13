export const MAX_CLIPBOARD_BYTES = 1024 * 1024;
// Reserve espaço para os delimitadores de bracketed paste que o xterm pode
// acrescentar antes de emitir um único evento onData ao backend (limite 64 KiB).
export const MAX_TERMINAL_PASTE_BYTES = 60 * 1024;

const encoder = new TextEncoder();

export function terminalClipboardShortcut(event = {}) {
  if (event.type && event.type !== "keydown") return null;
  if (event.altKey || event.metaKey) return null;
  const key = String(event.key || "").toLowerCase();

  if (event.ctrlKey && event.shiftKey && key === "c") return "copy";
  if (event.ctrlKey && !event.shiftKey && key === "insert") return "copy";
  if (event.ctrlKey && event.shiftKey && key === "v") return "paste";
  if (!event.ctrlKey && event.shiftKey && key === "insert") return "paste";
  return null;
}

export function clipUtf8(value, maxBytes) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  let used = 0;
  let result = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

export function sanitizeClipboardText(value, maxBytes = MAX_CLIPBOARD_BYTES) {
  return clipUtf8(String(value ?? "").replaceAll("\0", ""), maxBytes);
}

export function sanitizeTerminalPaste(value, maxBytes = MAX_TERMINAL_PASTE_BYTES) {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return clipUtf8(normalized, maxBytes);
}
