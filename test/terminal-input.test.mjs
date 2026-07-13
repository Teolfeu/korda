import test from "node:test";
import assert from "node:assert/strict";
import { submitTerminalText } from "../src/terminal-input.js";

const noPause = async () => {};

test("envia texto e Enter separados e serializa nudges por PTY", async () => {
  const writes = [];
  await Promise.all([
    submitTerminalText("hermes", async (data) => writes.push(data), "primeiro", { mode: "raw", pause: noPause }),
    submitTerminalText("hermes", async (data) => writes.push(data), "segundo", { mode: "raw", pause: noPause }),
  ]);
  assert.deepEqual(writes, ["primeiro", "\r", "segundo", "\r"]);
});

test("mantém protocolo multilinha como paste seguido de um Enter", async () => {
  const writes = [];
  await submitTerminalText("worker", async (data) => writes.push(data), "linha 1\nlinha 2", { pause: noPause });
  assert.deepEqual(writes, ["\u001b[200~linha 1\nlinha 2\u001b[201~", "\r"]);
});

test("respeita o atraso calibrado do agente", async () => {
  const pauses = [];
  await submitTerminalText("hermes", async () => {}, "ping", { mode: "raw", submitDelayMs: 160, pause: async (ms) => pauses.push(ms) });
  assert.deepEqual(pauses, [160]);
});
