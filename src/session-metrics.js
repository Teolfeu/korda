const ACTIVITY_KEY = "korda.local-activity.v2";

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanActivity(value) {
  const days = Object.fromEntries(Object.entries(value?.days || {})
    .filter(([key, count]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && number(count) > 0)
    .map(([key, count]) => [key, number(count)]));
  return { runs: Math.max(0, number(value?.runs)), packets: Math.max(0, number(value?.packets)), days };
}

export function readLocalActivity(storage = globalThis.localStorage) {
  try {
    return cleanActivity(JSON.parse(storage?.getItem(ACTIVITY_KEY) || "null"));
  } catch {
    return cleanActivity(null);
  }
}

export function saveLocalActivity(activity, storage = globalThis.localStorage) {
  try { storage?.setItem(ACTIVITY_KEY, JSON.stringify(cleanActivity(activity))); } catch { /* armazenamento pode estar bloqueado */ }
}

export function recordLocalRun(activity, packets, now = Date.now()) {
  const current = cleanActivity(activity);
  const key = dateKey(now);
  return {
    runs: current.runs + 1,
    packets: current.packets + Math.max(0, number(packets)),
    days: { ...current.days, [key]: number(current.days[key]) + 1 },
  };
}

export function activityWindow(records, now = Date.now(), days = 84) {
  const result = [];
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - offset);
    const key = dateKey(day);
    result.push({ key, count: number(records?.[key]), label: day.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) });
  }
  return result;
}

export function formatBytes(value) {
  const bytes = Math.max(0, number(value));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export function formatDuration(value) {
  const milliseconds = Math.max(0, number(value));
  if (!milliseconds) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
}

export function summarizeSession({ snapshot, nodes = [], edges = [], sessionBindings = {}, activity, workspaceRoot, now = Date.now() }) {
  const allTerminals = Array.isArray(snapshot?.terminals) ? snapshot.terminals : [];
  const root = typeof workspaceRoot === "string" ? workspaceRoot.replace(/[\\/]+$/, "") : "";
  const separator = root.includes("\\") ? "\\" : "/";
  const terminals = root
    ? allTerminals.filter((terminal) => terminal.cwd === root || terminal.cwd?.startsWith(`${root}${separator}`))
    : allTerminals;
  const measuredAt = number(snapshot?.now) || now;
  const active = terminals.filter((terminal) => !terminal.exited && !terminal.closed);
  const startedAt = terminals.reduce((earliest, terminal) => {
    const createdAt = number(terminal.createdAt);
    return createdAt && (!earliest || createdAt < earliest) ? createdAt : earliest;
  }, 0);
  const totals = terminals.reduce((result, terminal) => ({
    bytesIn: result.bytesIn + number(terminal.bytesIn),
    bytesOut: result.bytesOut + number(terminal.bytesOut),
    inputEvents: result.inputEvents + number(terminal.inputEvents ?? terminal.writes),
  }), { bytesIn: 0, bytesOut: 0, inputEvents: 0 });
  const agents = nodes.filter((node) => node.data?.role).map((node) => {
    const terminal = terminals.find((item) => item.id === sessionBindings[node.id]);
    const endedAt = number(terminal?.exitedAt || terminal?.closedAt) || measuredAt;
    return {
      id: node.id,
      title: node.data.agentName || node.data.title || node.id,
      role: node.data.role,
      command: node.data.command || "—",
      state: !terminal ? "unavailable" : terminal.exited || terminal.closed ? "ended" : "active",
      active: Boolean(terminal && !terminal.exited && !terminal.closed),
      duration: terminal ? Math.max(0, endedAt - number(terminal.createdAt)) : 0,
      bytesIn: number(terminal?.bytesIn),
      bytesOut: number(terminal?.bytesOut),
      inputEvents: number(terminal?.inputEvents ?? terminal?.writes),
    };
  });
  const localActivity = cleanActivity(activity);
  const activityDays = activityWindow(localActivity.days, measuredAt);
  return {
    measuredAt,
    sessionDuration: startedAt ? Math.max(0, measuredAt - startedAt) : 0,
    terminals: terminals.length,
    activeTerminals: active.length,
    configuredAgents: agents.length,
    activeAgents: agents.filter((agent) => agent.active).length,
    bytesIn: totals.bytesIn,
    bytesOut: totals.bytesOut,
    inputEvents: totals.inputEvents,
    cords: edges.length,
    runs: localActivity.runs,
    windowRuns: activityDays.reduce((total, day) => total + day.count, 0),
    packets: localActivity.packets,
    agents,
    activity: activityDays,
    usage: snapshot?.usage && Array.isArray(snapshot.usage.providers)
      ? snapshot.usage
      : { now: measuredAt, days: 30, providers: [] },
  };
}
