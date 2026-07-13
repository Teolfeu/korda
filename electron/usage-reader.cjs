const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const MAX_GROK_LOG_BYTES = 20 * 1024 * 1024;
const MAX_PLAN_LOG_BYTES = 8 * 1024 * 1024;
const CODEX_RPC_TIMEOUT_MS = 3_000;

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const total = (usage) => usage.inputTokens + usage.outputTokens + usage.reasoningTokens
  + usage.cacheReadTokens + usage.cacheWriteTokens;

function provider(id, label, source, scope) {
  return {
    id, label, available: false,
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    costUsd: null, costStatus: "unavailable", source, scope,
  };
}

function readDatabase(file, query, params, result) {
  if (!fs.existsSync(file)) return result;
  let database;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    const row = database.prepare(query).get(...params) || {};
    Object.assign(result, row, { available: true });
  } catch {
    result.available = false;
  } finally {
    database?.close();
  }
  return result;
}

function readDatabaseRows(file, query, params) {
  let database;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    return database.prepare(query).all(...params);
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

function readJsonlTail(file, maxBytes) {
  let descriptor;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    descriptor = fs.openSync(file, "r");
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    if (start) text = text.slice(text.indexOf("\n") + 1);
    return text.split("\n").flatMap((line) => {
      if (!line) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function unavailablePlan(providerId, label, source, reason) {
  return { provider: providerId, label, available: false, plan: null, windows: [], status: "unavailable", source, reason };
}

function percent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function windowLabel(minutes) {
  if (minutes === 300) return "5h";
  if (minutes === 10_080) return "semana";
  if (minutes > 0 && minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
}

function codexPlan(limits, source, status) {
  const windows = [limits?.primary, limits?.secondary].filter(Boolean).flatMap((entry) => {
    const usedPercent = percent(entry.usedPercent ?? entry.used_percent);
    const minutes = number(entry.windowDurationMins ?? entry.window_minutes);
    if (usedPercent === null || minutes <= 0) return [];
    const resetAt = number(entry.resetsAt ?? entry.resets_at) * 1000;
    return [{ label: windowLabel(minutes), usedPercent, ...(resetAt > 0 ? { resetAt } : {}) }];
  });
  const plan = limits?.planType || limits?.plan_type || null;
  if (!windows.length && !plan) return null;
  const credits = limits?.credits && typeof limits.credits === "object" ? {
    hasCredits: Boolean(limits.credits.hasCredits),
    unlimited: Boolean(limits.credits.unlimited),
    balance: limits.credits.balance ?? null,
  } : null;
  return {
    provider: "codex", label: "Codex", available: true, plan, windows, status, source,
    ...(credits ? { credits } : {}),
    ...(windows.length ? {} : { reason: "quota_not_observed" }),
  };
}

function readCodexRateLimitsLive() {
  return new Promise((resolve, reject) => {
    let child;
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.kill();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("codex_rate_limits_timeout")), CODEX_RPC_TIMEOUT_MS);
    try {
      child = spawn("codex", ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
    } catch (error) {
      finish(error);
      return;
    }
    child.on("error", (error) => finish(error));
    child.on("exit", () => finish(new Error("codex_app_server_closed")));
    child.stdin.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 256 * 1024) return finish(new Error("codex_response_too_large"));
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && !message.error) {
          child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ id: 2, method: "account/rateLimits/read", params: null })}\n`);
        } else if (message.id === 1) {
          finish(new Error("codex_initialize_failed"));
        } else if (message.id === 2 && message.result?.rateLimits) {
          finish(null, message.result);
        } else if (message.id === 2) {
          finish(new Error("codex_rate_limits_failed"));
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      id: 1, method: "initialize",
      params: { clientInfo: { name: "korda-studio", version: "0.1" }, capabilities: { experimentalApi: true } },
    })}\n`);
  });
}

function readCodexPlan(home) {
  const databaseFile = path.join(home, ".codex", "state_5.sqlite");
  const source = readDatabaseRows(databaseFile,
    "SELECT rollout_path FROM threads WHERE rollout_path IS NOT NULL ORDER BY updated_at DESC LIMIT 1", [])[0]?.rollout_path;
  const result = unavailablePlan("codex", "Codex", source || databaseFile, "rate_limit_not_observed");
  if (!source) return result;
  let latest;
  for (const event of readJsonlTail(source, MAX_PLAN_LOG_BYTES) || []) {
    const limits = event?.payload?.rate_limits;
    if (event?.payload?.type === "token_count" && limits) latest = limits;
  }
  if (!latest) return result;
  return codexPlan(latest, source, "fallback") || result;
}

async function readCodexPlanCurrent(home, reader) {
  try {
    const response = await reader();
    const plan = codexPlan(response?.rateLimits, "codex app-server", "live");
    if (plan) {
      const availableCount = number(response?.rateLimitResetCredits?.availableCount);
      if (availableCount > 0) plan.resetCreditsAvailable = availableCount;
      return plan;
    }
  } catch { /* rollout local abaixo é o fallback offline. */ }
  return readCodexPlan(home);
}

function readGrokPlan(home) {
  const source = path.join(home, ".grok", "logs", "unified.jsonl");
  const result = unavailablePlan("grok", "Grok", source, "billing_not_observed");
  let latest;
  for (const event of readJsonlTail(source, MAX_GROK_LOG_BYTES) || []) {
    if (event?.msg === "billing: fetched credits config") latest = event;
  }
  if (!latest) return result;
  const config = latest.ctx?.config || {};
  const usedPercent = percent(config.creditUsagePercent);
  const resetAt = Date.parse(config.currentPeriod?.end || config.billingPeriodEnd);
  const windows = usedPercent === null ? [] : [{
    label: config.currentPeriod?.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "semana" : "plano",
    usedPercent,
    ...(Number.isFinite(resetAt) ? { resetAt } : {}),
  }];
  const plan = typeof latest.ctx?.subscriptionTier === "string" ? latest.ctx.subscriptionTier : null;
  if (!windows.length && !plan) return result;
  return {
    provider: "grok", label: "Grok", available: true, plan, windows,
    status: windows.length ? "observed" : "partial", source,
    ...(Number.isFinite(Date.parse(latest.ts)) ? { observedAt: Date.parse(latest.ts) } : {}),
    ...(windows.length ? {} : { reason: "quota_not_observed" }),
  };
}

function hermesCost(row) {
  const actual = number(row.actualCost);
  const estimated = number(row.estimatedCost);
  if (actual > 0) return { costUsd: actual, costStatus: "actual" };
  if (estimated > 0) return { costUsd: estimated, costStatus: "estimated" };
  if (number(row.includedSessions) > 0) return { costUsd: 0, costStatus: "included" };
  return { costUsd: null, costStatus: "unavailable" };
}

function modelName(value) {
  if (typeof value !== "string" || !value) return "unknown";
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return [parsed.providerID, parsed.id || parsed.modelID].filter(Boolean).join("/") || "unknown";
    }
  } catch { /* OpenCode antigo persiste o nome diretamente. */ }
  return value.slice(0, 120);
}

function readHermes(home, cutoffSeconds, scope) {
  const source = path.join(home, ".hermes", "state.db");
  const result = provider("hermes", "Hermes", source, scope);
  readDatabase(source, `SELECT
    COALESCE(SUM(input_tokens), 0) inputTokens,
    COALESCE(SUM(output_tokens), 0) outputTokens,
    COALESCE(SUM(reasoning_tokens), 0) reasoningTokens,
    COALESCE(SUM(cache_read_tokens), 0) cacheReadTokens,
    COALESCE(SUM(cache_write_tokens), 0) cacheWriteTokens,
    COALESCE(SUM(actual_cost_usd), 0) actualCost,
    COALESCE(SUM(estimated_cost_usd), 0) estimatedCost,
    COALESCE(SUM(cost_status = 'included'), 0) includedSessions
    FROM sessions WHERE started_at >= ?`, [cutoffSeconds], result);
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"]) result[key] = number(result[key]);
  result.totalTokens = total(result);
  Object.assign(result, hermesCost(result));
  delete result.actualCost;
  delete result.estimatedCost;
  delete result.includedSessions;
  result.models = readDatabaseRows(source, `SELECT COALESCE(NULLIF(model, ''), 'unknown') model,
    COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens + cache_read_tokens + cache_write_tokens), 0) totalTokens,
    COALESCE(SUM(actual_cost_usd), 0) actualCost,
    COALESCE(SUM(estimated_cost_usd), 0) estimatedCost,
    COALESCE(SUM(cost_status = 'included'), 0) includedSessions
    FROM sessions WHERE started_at >= ? GROUP BY model ORDER BY totalTokens DESC LIMIT 8`, [cutoffSeconds])
    .map((row) => ({ model: modelName(row.model), totalTokens: number(row.totalTokens), ...hermesCost(row) }));
  return result;
}

function readOpenCode(home, cutoffMilliseconds, scope) {
  const source = path.join(home, ".local", "share", "opencode", "opencode.db");
  const result = provider("opencode", "OpenCode", source, scope);
  readDatabase(source, `SELECT
    COALESCE(SUM(tokens_input), 0) inputTokens,
    COALESCE(SUM(tokens_output), 0) outputTokens,
    COALESCE(SUM(tokens_reasoning), 0) reasoningTokens,
    COALESCE(SUM(tokens_cache_read), 0) cacheReadTokens,
    COALESCE(SUM(tokens_cache_write), 0) cacheWriteTokens,
    COALESCE(SUM(cost), 0) costUsd
    FROM session WHERE time_created >= ?`, [cutoffMilliseconds], result);
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"]) result[key] = number(result[key]);
  result.totalTokens = total(result);
  if (result.available) result.costStatus = "actual";
  result.models = readDatabaseRows(source, `SELECT CASE WHEN json_valid(model)
      THEN COALESCE(json_extract(model, '$.providerID') || '/' || COALESCE(json_extract(model, '$.id'), json_extract(model, '$.modelID')), 'unknown')
      ELSE COALESCE(NULLIF(model, ''), 'unknown') END normalizedModel,
    COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning + tokens_cache_read + tokens_cache_write), 0) totalTokens,
    COALESCE(SUM(cost), 0) costUsd
    FROM session WHERE time_created >= ? GROUP BY normalizedModel HAVING totalTokens > 0 OR costUsd > 0 ORDER BY totalTokens DESC LIMIT 8`, [cutoffMilliseconds])
    .map((row) => ({ model: modelName(row.normalizedModel), totalTokens: number(row.totalTokens), costUsd: number(row.costUsd), costStatus: "actual" }));
  return result;
}

function readCodex(home, cutoffSeconds, scope) {
  const source = path.join(home, ".codex", "state_5.sqlite");
  const result = provider("codex", "Codex", source, scope);
  readDatabase(source, "SELECT COALESCE(SUM(tokens_used), 0) totalTokens FROM threads WHERE created_at >= ?", [cutoffSeconds], result);
  result.totalTokens = number(result.totalTokens);
  return result;
}

function readGrok(home, cutoffMilliseconds, scope) {
  const source = path.join(home, ".grok", "logs", "unified.jsonl");
  const result = provider("grok", "Grok", source, scope);
  try {
    if (!fs.existsSync(source)) return result;
    const events = readJsonlTail(source, MAX_GROK_LOG_BYTES);
    if (!events) return result;
    for (const event of events) {
      const timestamp = Date.parse(event.ts);
      if (event.msg !== "shell.turn.inference_done" || !Number.isFinite(timestamp) || timestamp < cutoffMilliseconds) continue;
      const cached = number(event.ctx?.cached_prompt_tokens);
      result.inputTokens += Math.max(0, number(event.ctx?.prompt_tokens) - cached);
      result.outputTokens += number(event.ctx?.completion_tokens);
      result.reasoningTokens += number(event.ctx?.reasoning_tokens);
      result.cacheReadTokens += cached;
    }
    result.available = true;
    result.totalTokens = total(result);
  } catch {
    result.available = false;
  }
  return result;
}

async function readUsageSnapshot(options = {}) {
  const home = typeof options.home === "string" ? options.home : os.homedir();
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const days = Number.isFinite(options.days) && options.days > 0 ? options.days : 30;
  const cutoffMilliseconds = now - days * 86_400_000;
  const scope = `${days}d`;
  return {
    now,
    days,
    providers: [
      readHermes(home, cutoffMilliseconds / 1000, scope),
      readOpenCode(home, cutoffMilliseconds, scope),
      readCodex(home, cutoffMilliseconds / 1000, scope),
      readGrok(home, cutoffMilliseconds, scope),
    ],
    plans: [await readCodexPlanCurrent(home, options.readCodexRateLimits || readCodexRateLimitsLive), readGrokPlan(home)],
  };
}

module.exports = { readUsageSnapshot };
