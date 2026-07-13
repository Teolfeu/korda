const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { readUsageSnapshot } = require("../electron/usage-reader.cjs");

function database(file, schema, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(schema);
  for (const statement of values) db.exec(statement);
  db.close();
}

test("agrega somente telemetria estruturada do período sem ler conversas", async (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "korda-usage-"));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const now = Date.UTC(2026, 6, 12);
  const recentSeconds = now / 1000 - 60;
  const recentMilliseconds = now - 60_000;

  database(path.join(home, ".hermes", "state.db"), `CREATE TABLE sessions (
    started_at REAL, model TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, actual_cost_usd REAL,
    estimated_cost_usd REAL, cost_status TEXT)`, [
    `INSERT INTO sessions VALUES (${recentSeconds},'deepseek-v4',10,2,1,4,3,NULL,0.25,'estimated')`,
    `INSERT INTO sessions VALUES (0,'antigo',999,999,999,999,999,9,9,'actual')`,
  ]);
  database(path.join(home, ".local", "share", "opencode", "opencode.db"), `CREATE TABLE session (
    time_created INTEGER, model TEXT, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
    tokens_cache_read INTEGER, tokens_cache_write INTEGER, cost REAL)`, [
    `INSERT INTO session VALUES (${recentMilliseconds},'{"id":"gpt-5","providerID":"openai"}',20,5,2,6,1,1.5)`,
  ]);
  const rollout = path.join(home, ".codex", "sessions", "rollout.jsonl");
  fs.mkdirSync(path.dirname(rollout), { recursive: true });
  fs.writeFileSync(rollout, JSON.stringify({ type: "event_msg", payload: { type: "token_count", rate_limits: {
    plan_type: "prolite",
    primary: { used_percent: 31, window_minutes: 300, resets_at: recentSeconds + 3_600 },
    secondary: { used_percent: 54, window_minutes: 10_080, resets_at: recentSeconds + 604_800 },
  } } }));
  database(path.join(home, ".codex", "state_5.sqlite"),
    "CREATE TABLE threads (created_at INTEGER, updated_at INTEGER, tokens_used INTEGER, title TEXT, rollout_path TEXT)", [
      `INSERT INTO threads VALUES (${recentSeconds},${recentSeconds},42,'não deve sair','${rollout}')`,
  ]);
  const grokLog = path.join(home, ".grok", "logs", "unified.jsonl");
  fs.mkdirSync(path.dirname(grokLog), { recursive: true });
  fs.writeFileSync(grokLog, [
    JSON.stringify({ ts: new Date(recentMilliseconds).toISOString(), msg: "shell.turn.inference_done", ctx: { prompt_tokens: 100, cached_prompt_tokens: 80, completion_tokens: 7, reasoning_tokens: 3 }, prompt: "privado" }),
    JSON.stringify({ ts: new Date(recentMilliseconds).toISOString(), msg: "billing: fetched credits config", ctx: {
      subscriptionTier: "SuperGrok", config: { creditUsagePercent: 84,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: new Date(recentMilliseconds + 604_800_000).toISOString() } },
    } }),
    JSON.stringify({ msg: "shell.turn.inference_done", ctx: { prompt_tokens: 999 } }),
    JSON.stringify({ ts: new Date(recentMilliseconds).toISOString(), msg: "outro", ctx: { prompt_tokens: 999 } }),
  ].join("\n"));

  const snapshot = await readUsageSnapshot({ home, now, days: 30, readCodexRateLimits: async () => null });
  assert.deepEqual(snapshot.providers.map(({ id, available }) => [id, available]), [
    ["hermes", true], ["opencode", true], ["codex", true], ["grok", true],
  ]);
  assert.deepEqual(snapshot.providers[0], {
    id: "hermes", label: "Hermes", available: true,
    inputTokens: 10, outputTokens: 2, reasoningTokens: 1, cacheReadTokens: 4, cacheWriteTokens: 3,
    totalTokens: 20, costUsd: 0.25, costStatus: "estimated",
    source: path.join(home, ".hermes", "state.db"), scope: "30d",
    models: [{ model: "deepseek-v4", totalTokens: 20, costUsd: 0.25, costStatus: "estimated" }],
  });
  assert.equal(snapshot.providers[1].totalTokens, 34);
  assert.equal(snapshot.providers[1].costUsd, 1.5);
  assert.equal(snapshot.providers[1].costStatus, "actual");
  assert.deepEqual(snapshot.providers[1].models, [
    { model: "openai/gpt-5", totalTokens: 34, costUsd: 1.5, costStatus: "actual" },
  ]);
  assert.equal(snapshot.providers[2].totalTokens, 42);
  assert.deepEqual(snapshot.providers[3], {
    id: "grok", label: "Grok", available: true,
    inputTokens: 20, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 80, cacheWriteTokens: 0,
    totalTokens: 110, costUsd: null, costStatus: "unavailable",
    source: grokLog, scope: "30d",
  });
  assert.deepEqual(snapshot.plans, [
    { provider: "codex", label: "Codex", available: true, plan: "prolite", status: "fallback", source: rollout, windows: [
      { label: "5h", usedPercent: 31, resetAt: (recentSeconds + 3_600) * 1000 },
      { label: "semana", usedPercent: 54, resetAt: (recentSeconds + 604_800) * 1000 },
    ] },
    { provider: "grok", label: "Grok", available: true, plan: "SuperGrok", status: "observed", source: grokLog, observedAt: recentMilliseconds, windows: [
      { label: "semana", usedPercent: 84, resetAt: recentMilliseconds + 604_800_000 },
    ] },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /privado|não deve sair/);
});

test("fontes ausentes não interrompem o snapshot", async () => {
  const snapshot = await readUsageSnapshot({
    home: path.join(os.tmpdir(), "korda-usage-ausente"), now: 1, days: 7,
    readCodexRateLimits: async () => null,
  });
  assert.equal(snapshot.providers.every(({ available }) => !available), true);
  assert.equal(snapshot.plans.every(({ available, reason }) => !available && reason), true);
});

test("prefere a leitura ao vivo do plano Codex e resume créditos sem identificadores", async () => {
  const snapshot = await readUsageSnapshot({
    home: path.join(os.tmpdir(), "korda-usage-live"), now: 1, days: 7,
    readCodexRateLimits: async () => ({
      rateLimits: {
        planType: "pro", credits: { hasCredits: true, unlimited: false, balance: "12.50" },
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 123 },
        secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 456 },
      },
      rateLimitResetCredits: { availableCount: 2, credits: [{ id: "não deve sair" }] },
    }),
  });
  assert.deepEqual(snapshot.plans[0], {
    provider: "codex", label: "Codex", available: true, plan: "pro", status: "live", source: "codex app-server",
    windows: [
      { label: "5h", usedPercent: 12, resetAt: 123_000 },
      { label: "semana", usedPercent: 34, resetAt: 456_000 },
    ],
    credits: { hasCredits: true, unlimited: false, balance: "12.50" },
    resetCreditsAvailable: 2,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /não deve sair/);
});
