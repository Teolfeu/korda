export const WORKSPACE_STATE_VERSION = 1;

const WORKSPACE_PREFIX = `korda:workspace:v${WORKSPACE_STATE_VERSION}:`;
const LAST_WORKSPACE_KEY = "korda:last-workspace";
const MAX_SERIALIZED_LENGTH = 2_000_000;
const MAX_NODES = 250;
const MAX_EDGES = 1_000;
const MAX_COORDINATE = 1_000_000;
const nodeTypes = new Set(["agent", "browser", "file", "note"]);
const roles = new Set(["orchestrator", "executor", "reviewer", "researcher"]);
const edgeKinds = new Set(["delegate", "validate", "browser", "context"]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, limit, trim = false) {
  if (typeof value !== "string") return undefined;
  const result = trim ? value.trim() : value;
  return result ? result.slice(0, limit) : undefined;
}

function number(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function storageOrDefault(storage) {
  try { return storage || globalThis.localStorage || null; } catch { return null; }
}

function cleanWorkspace(value) {
  const source = typeof value === "string" ? { root: value } : record(value);
  if (!source) return null;
  const root = text(source.root, 4_096, true);
  const fallbackName = root?.split(/[\\/]/).filter(Boolean).at(-1);
  const name = text(source.name, 240, true) || fallbackName;
  if (!root && !name) return null;
  return { name: name || "Workspace", root: root || null };
}

function workspaceIdentity(workspace) {
  return workspace.root ? `root:${workspace.root}` : `name:${workspace.name}`;
}

export function workspaceScopeId(workspace) {
  const clean = cleanWorkspace(workspace);
  if (!clean) return "ws-unknown";
  let hash = 2_166_136_261;
  for (const character of workspaceIdentity(clean)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `ws-${(hash >>> 0).toString(36)}`;
}

export function workspaceStorageKey(workspace) {
  const clean = cleanWorkspace(workspace);
  return clean ? `${WORKSPACE_PREFIX}${encodeURIComponent(workspaceIdentity(clean))}` : null;
}

function cleanPorts(value) {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set();
  const ports = [];
  for (const raw of value.slice(0, 32)) {
    const source = record(raw);
    const id = text(source?.id, 120, true);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const port = { id };
    for (const [key, limit] of [["label", 160], ["color", 80], ["type", 20], ["position", 20]]) {
      const valueText = text(source[key], limit, true);
      if (valueText) port[key] = valueText;
    }
    ports.push(port);
  }
  return ports;
}

function cleanNodeData(value, type) {
  const source = record(value) || {};
  const data = {};
  const fieldsByType = {
    agent: { title: 500, agentId: 240, agentName: 240, command: 1_024, kind: 120, accent: 80, objective: 10_000 },
    browser: { title: 500, url: 4_096 },
    file: { title: 500, path: 4_096, meta: 1_000 },
    note: { title: 500, text: 50_000, variant: 20, color: 80 },
  };
  for (const [key, limit] of Object.entries(fieldsByType[type])) {
    const valueText = text(source[key], limit, key !== "text" && key !== "objective");
    if (valueText !== undefined) data[key] = valueText;
  }
  if (type === "agent") {
    if (roles.has(source.role)) data.role = source.role;
    if (typeof source.terminal === "boolean") data.terminal = source.terminal;
    const ports = cleanPorts(source.ports);
    if (ports) data.ports = ports;
  }
  if (type === "note") {
    if (!["sticky", "text"].includes(data.variant)) delete data.variant;
    const fontSize = number(source.fontSize, 8, 96, undefined);
    const fontWeight = number(source.fontWeight, 100, 900, undefined);
    if (fontSize !== undefined) data.fontSize = fontSize;
    if (fontWeight !== undefined) data.fontWeight = fontWeight;
  }
  return data;
}

function cleanNode(value) {
  const source = record(value);
  const id = text(source?.id, 200, true);
  if (!id || !nodeTypes.has(source.type)) return null;
  const position = record(source.position);
  const node = {
    id,
    type: source.type,
    position: {
      x: number(position?.x, -MAX_COORDINATE, MAX_COORDINATE, 0),
      y: number(position?.y, -MAX_COORDINATE, MAX_COORDINATE, 0),
    },
    data: cleanNodeData(source.data, source.type),
  };
  const style = record(source.style);
  const width = number(source.width ?? style?.width, source.type === "agent" ? 560 : 80, 4_000, undefined);
  const height = number(source.height ?? style?.height, source.type === "agent" ? 380 : 60, 3_000, undefined);
  if (width !== undefined || height !== undefined) node.style = { ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
  return node;
}

function cleanStyle(value, textFields, numberFields) {
  const source = record(value);
  if (!source) return undefined;
  const result = {};
  for (const key of textFields) {
    const valueText = text(source[key], 160, true);
    if (valueText) result[key] = valueText;
  }
  for (const key of numberFields) {
    const valueNumber = number(source[key], 0, 10_000, undefined);
    if (valueNumber !== undefined) result[key] = valueNumber;
  }
  return Object.keys(result).length ? result : undefined;
}

function cleanMarker(value) {
  const marker = cleanStyle(value, ["type", "color", "orient", "markerUnits"], ["width", "height", "strokeWidth"]);
  return marker;
}

function cleanEdge(value, nodeIds) {
  const source = record(value);
  const id = text(source?.id, 200, true);
  const from = text(source?.source, 200, true);
  const to = text(source?.target, 200, true);
  if (!id || !from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return null;
  const edge = { id, source: from, target: to };
  for (const key of ["sourceHandle", "targetHandle", "type", "label"]) {
    const valueText = text(source[key], key === "label" ? 500 : 200, true);
    if (valueText) edge[key] = valueText;
  }
  if (typeof source.animated === "boolean") edge.animated = source.animated;
  const kind = record(source.data)?.kind;
  if (typeof kind === "string") edge.data = { kind: edgeKinds.has(kind) ? kind : "context" };
  const style = cleanStyle(source.style, ["stroke", "strokeDasharray"], ["strokeWidth", "opacity"]);
  const labelStyle = cleanStyle(source.labelStyle, ["fill"], ["fontSize", "fontWeight"]);
  const labelBgStyle = cleanStyle(source.labelBgStyle, ["fill", "stroke"], ["fillOpacity", "strokeWidth"]);
  const markerStart = cleanMarker(source.markerStart);
  const markerEnd = cleanMarker(source.markerEnd);
  if (style) edge.style = style;
  if (labelStyle) edge.labelStyle = labelStyle;
  if (labelBgStyle) edge.labelBgStyle = labelBgStyle;
  if (markerStart) edge.markerStart = markerStart;
  if (markerEnd) edge.markerEnd = markerEnd;
  if (Array.isArray(source.labelBgPadding) && source.labelBgPadding.length >= 2) {
    edge.labelBgPadding = source.labelBgPadding.slice(0, 2).map((item) => number(item, 0, 100, 0));
  }
  const labelBgBorderRadius = number(source.labelBgBorderRadius, 0, 100, undefined);
  if (labelBgBorderRadius !== undefined) edge.labelBgBorderRadius = labelBgBorderRadius;
  return edge;
}

function cleanState(nodes, edges) {
  const cleanNodes = [];
  const nodeIds = new Set();
  for (const raw of nodes.slice(0, MAX_NODES * 4)) {
    const node = cleanNode(raw);
    if (!node || nodeIds.has(node.id)) continue;
    cleanNodes.push(node);
    nodeIds.add(node.id);
    if (cleanNodes.length === MAX_NODES) break;
  }
  const cleanEdges = [];
  const edgeIds = new Set();
  for (const raw of edges.slice(0, MAX_EDGES * 4)) {
    const edge = cleanEdge(raw, nodeIds);
    if (!edge || edgeIds.has(edge.id)) continue;
    cleanEdges.push(edge);
    edgeIds.add(edge.id);
    if (cleanEdges.length === MAX_EDGES) break;
  }
  return { nodes: cleanNodes, edges: cleanEdges };
}

function parseStored(raw) {
  if (typeof raw !== "string" || !raw || raw.length > MAX_SERIALIZED_LENGTH) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function readLastWorkspace(storage) {
  const target = storageOrDefault(storage);
  if (!target?.getItem) return null;
  try {
    const payload = parseStored(target.getItem(LAST_WORKSPACE_KEY));
    if (typeof payload === "string") return cleanWorkspace(payload);
    const source = record(payload);
    if (!source || (source.version !== undefined && Number(source.version) !== WORKSPACE_STATE_VERSION)) return null;
    return cleanWorkspace(source.workspace || source);
  } catch { return null; }
}

export function readWorkspaceState(workspace, storage) {
  const expectedWorkspace = cleanWorkspace(workspace);
  const key = workspaceStorageKey(expectedWorkspace);
  const target = storageOrDefault(storage);
  if (!key || !target?.getItem) return null;
  try {
    const payload = record(parseStored(target.getItem(key)));
    if (!payload) return null;
    const version = payload.version === undefined ? 0 : Number(payload.version);
    if (version !== 0 && version !== WORKSPACE_STATE_VERSION) return null;
    const storedWorkspace = cleanWorkspace(payload.workspace);
    if (storedWorkspace && workspaceIdentity(storedWorkspace) !== workspaceIdentity(expectedWorkspace)) return null;
    const source = record(payload.state) || payload;
    if (!Array.isArray(source.nodes) || (source.edges !== undefined && !Array.isArray(source.edges))) return null;
    return { version: WORKSPACE_STATE_VERSION, workspace: expectedWorkspace, ...cleanState(source.nodes, source.edges || []) };
  } catch { return null; }
}

export function saveWorkspaceState(workspace, state, storage) {
  const cleanWorkspaceValue = cleanWorkspace(workspace);
  const key = workspaceStorageKey(cleanWorkspaceValue);
  const target = storageOrDefault(storage);
  if (!key || !target?.setItem || !Array.isArray(state?.nodes) || !Array.isArray(state?.edges)) return false;
  const payload = { version: WORKSPACE_STATE_VERSION, workspace: cleanWorkspaceValue, ...cleanState(state.nodes, state.edges) };
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_SERIALIZED_LENGTH) return false;
  try {
    target.setItem(key, serialized);
    target.setItem(LAST_WORKSPACE_KEY, JSON.stringify({ version: WORKSPACE_STATE_VERSION, workspace: cleanWorkspaceValue }));
    return true;
  } catch { return false; }
}

export function clearWorkspaceState(workspace, storage) {
  const cleanWorkspaceValue = cleanWorkspace(workspace);
  const key = workspaceStorageKey(cleanWorkspaceValue);
  const target = storageOrDefault(storage);
  if (!key || !target?.removeItem) return false;
  try {
    target.removeItem(key);
    const last = readLastWorkspace(target);
    if (last && workspaceIdentity(last) === workspaceIdentity(cleanWorkspaceValue)) target.removeItem(LAST_WORKSPACE_KEY);
    return true;
  } catch { return false; }
}
