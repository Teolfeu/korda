const bridge = typeof window === "undefined" ? null : window.kordaDesktop;

const unavailable = (feature) => Promise.reject(
  new Error(`${feature} requer o aplicativo desktop.`),
);

export const isDesktop = Boolean(bridge?.isDesktop);
export const listAgents = () => bridge?.listAgents() ?? Promise.resolve([]);
export const metricsSnapshot = () => bridge?.metricsSnapshot() ?? Promise.resolve({
  now: Date.now(),
  terminals: [],
  totals: { sessions: 0, active: 0, exited: 0, closed: 0, bytesIn: 0, bytesOut: 0, inputEvents: 0 },
});
export const syncContext = (payload) => bridge?.syncContext(payload) ?? Promise.resolve(false);
export const selectWorkspace = () => bridge?.selectWorkspace() ?? Promise.resolve(null);
export const readWorkspaceFile = (path) => bridge?.readWorkspaceFile(path) ?? unavailable("Workspace");
export const writeWorkspaceFile = (path, content, revision) => bridge?.writeWorkspaceFile(path, content, revision) ?? unavailable("Workspace");
export const createTerminal = (payload) => bridge?.createTerminal(payload) ?? unavailable("Terminal");
export const writeTerminal = (id, data) => bridge?.writeTerminal(id, data) ?? unavailable("Terminal");
export const resizeTerminal = (id, cols, rows) => bridge?.resizeTerminal(id, cols, rows) ?? unavailable("Terminal");
export const closeTerminal = (id) => bridge?.closeTerminal(id) ?? unavailable("Terminal");
export const terminalSnapshot = (id) => bridge?.terminalSnapshot(id) ?? unavailable("Terminal");
export const readClipboardText = () => bridge?.readClipboardText() ?? unavailable("Área de transferência");
export const writeClipboardText = (text) => bridge?.writeClipboardText(text) ?? unavailable("Área de transferência");
export const onTerminalData = (listener) => bridge?.onTerminalData(listener) ?? (() => {});
export const onContextNote = (listener) => bridge?.onContextNote(listener) ?? (() => {});

const desktop = Object.freeze({
  isDesktop,
  listAgents,
  metricsSnapshot,
  syncContext,
  selectWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  createTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  terminalSnapshot,
  readClipboardText,
  writeClipboardText,
  onTerminalData,
  onContextNote,
});

export default desktop;
