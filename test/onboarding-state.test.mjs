import test from "node:test";
import assert from "node:assert/strict";
import {
  markOnboardingSeen,
  ONBOARDING_STATE_VERSION,
  ONBOARDING_STORAGE_KEY,
  resetOnboarding,
  shouldShowOnboarding,
} from "../src/onboarding-state.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

test("mostra onboarding na primeira abertura e usa chave versionada", () => {
  const storage = memoryStorage();
  assert.equal(ONBOARDING_STORAGE_KEY, `korda:onboarding:v${ONBOARDING_STATE_VERSION}`);
  assert.equal(shouldShowOnboarding(storage), true);
});

test("marca como visto com estado mínimo e permite reset", () => {
  const storage = memoryStorage({ unrelated: "preservar" });

  assert.equal(markOnboardingSeen(storage), true);
  assert.equal(shouldShowOnboarding(storage), false);
  assert.deepEqual(JSON.parse(storage.snapshot()[ONBOARDING_STORAGE_KEY]), {
    version: ONBOARDING_STATE_VERSION,
    seen: true,
  });
  assert.equal(storage.snapshot().unrelated, "preservar");

  assert.equal(resetOnboarding(storage), true);
  assert.equal(shouldShowOnboarding(storage), true);
  assert.equal(storage.snapshot().unrelated, "preservar");
});

test("valor ausente, corrompido, incompleto ou de outra versão volta ao onboarding", () => {
  for (const value of [
    "{json",
    "null",
    "[]",
    JSON.stringify({ version: ONBOARDING_STATE_VERSION }),
    JSON.stringify({ version: ONBOARDING_STATE_VERSION, seen: false }),
    JSON.stringify({ version: ONBOARDING_STATE_VERSION + 1, seen: true }),
  ]) {
    assert.equal(shouldShowOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: value })), true);
  }
});

test("storage ausente ou com falha nunca lança e usa defaults seguros", () => {
  const broken = {
    getItem() { throw new Error("bloqueado"); },
    setItem() { throw new Error("bloqueado"); },
    removeItem() { throw new Error("bloqueado"); },
  };

  assert.equal(shouldShowOnboarding(null), true);
  assert.equal(markOnboardingSeen(null), false);
  assert.equal(resetOnboarding(null), false);
  assert.doesNotThrow(() => shouldShowOnboarding(broken));
  assert.equal(shouldShowOnboarding(broken), true);
  assert.equal(markOnboardingSeen(broken), false);
  assert.equal(resetOnboarding(broken), false);
});

test("estado visto fica isolado por instância e não aceita valores truthy informais", () => {
  const first = memoryStorage();
  const second = memoryStorage({ [ONBOARDING_STORAGE_KEY]: "true" });

  markOnboardingSeen(first);
  assert.equal(shouldShowOnboarding(first), false);
  assert.equal(shouldShowOnboarding(second), true);
  assert.equal(second.snapshot()[ONBOARDING_STORAGE_KEY], "true");
});
