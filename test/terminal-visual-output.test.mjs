import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalVisualOutputTracker, hasTerminalVisualOutput } from "../src/terminal-visual-output.js";

test("não considera controles ANSI, respostas DSR ou espaços como frame visual", () => {
  assert.equal(hasTerminalVisualOutput(""), false);
  assert.equal(hasTerminalVisualOutput("\r\n\t"), false);
  assert.equal(hasTerminalVisualOutput("\u001b[2J\u001b[H\u001b[?25h\u001b[1;1R"), false);
  assert.equal(hasTerminalVisualOutput("\u001b]0;OpenCode\u0007"), false);
});

test("reconhece prompts e texto estilizado sem reter o conteúdo", () => {
  assert.equal(hasTerminalVisualOutput("$ "), true);
  assert.equal(hasTerminalVisualOutput("\u001b[32mPronto\u001b[0m"), true);
  assert.equal(hasTerminalVisualOutput("┌─ OpenCode ─┐"), true);
});

test("mantém estado entre chunks ANSI fragmentados sem falso positivo", () => {
  const tracker = createTerminalVisualOutputTracker();
  assert.equal(tracker.push("\u001b["), false);
  assert.equal(tracker.push("?25h\u001b]0;Open"), false);
  assert.equal(tracker.push("Code\u001b\\"), false);
  assert.equal(tracker.visible, false);
  assert.equal(tracker.push("ready"), true);
  assert.equal(tracker.visible, true);
});

test("ignora payloads gráficos e títulos até surgir um glifo normal", () => {
  const tracker = createTerminalVisualOutputTracker();
  assert.equal(tracker.push("\u001bPq12345"), false);
  assert.equal(tracker.push("67890\u001b\\"), false);
  assert.equal(tracker.push("\n✓"), true);
});
