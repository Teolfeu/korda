import test from "node:test";
import assert from "node:assert/strict";
import {
  clipUtf8,
  sanitizeClipboardText,
  sanitizeTerminalPaste,
  terminalClipboardShortcut,
} from "../src/terminal-clipboard.js";

const shortcut = (key, modifiers = {}) => terminalClipboardShortcut({ type: "keydown", key, ...modifiers });

test("mapeia os atalhos Linux de copiar e colar do terminal", () => {
  assert.equal(shortcut("C", { ctrlKey: true, shiftKey: true }), "copy");
  assert.equal(shortcut("Insert", { ctrlKey: true }), "copy");
  assert.equal(shortcut("v", { ctrlKey: true, shiftKey: true }), "paste");
  assert.equal(shortcut("Insert", { shiftKey: true }), "paste");
});

test("não intercepta Ctrl+C puro nem combinações alternativas", () => {
  assert.equal(shortcut("c", { ctrlKey: true }), null);
  assert.equal(shortcut("v", { ctrlKey: true }), null);
  assert.equal(shortcut("c", { metaKey: true }), null);
  assert.equal(shortcut("c", { ctrlKey: true, shiftKey: true, altKey: true }), null);
  assert.equal(terminalClipboardShortcut({ type: "keyup", key: "c", ctrlKey: true, shiftKey: true }), null);
});

test("sanitiza controles perigosos sem perder tabulação e linhas", () => {
  assert.equal(sanitizeClipboardText("a\0b"), "ab");
  assert.equal(sanitizeTerminalPaste("a\r\nb\r\tc\u001b[31m\u0007"), "a\nb\n\tc[31m");
});

test("limita por bytes UTF-8 sem produzir caractere inválido", () => {
  assert.equal(clipUtf8("ááá", 4), "áá");
  assert.equal(clipUtf8("áá", 3), "á");
  assert.equal(clipUtf8("😀x", 4), "😀");
  assert.equal(clipUtf8("😀x", 3), "");
  assert.equal(sanitizeTerminalPaste("ááá", 4), "áá");
});
