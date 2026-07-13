const { contextBridge, ipcRenderer } = require("electron");

function idPayload(value) {
  return value && typeof value === "object" ? value : { id: value };
}

const api = Object.freeze({
  isDesktop: true,
  listAgents: () => ipcRenderer.invoke("agents:list"),
  metricsSnapshot: () => ipcRenderer.invoke("metrics:snapshot"),
  startMission: (payload) => ipcRenderer.invoke("mission:start", payload),
  missionDelivered: (nodeId) => ipcRenderer.invoke("mission:delivered", { nodeId }),
  missionSnapshot: () => ipcRenderer.invoke("mission:snapshot"),
  cancelMission: (reason) => ipcRenderer.invoke("mission:cancel", { reason }),
  syncContext: (payload) => ipcRenderer.invoke("context:sync", payload),
  registerBrowser: (nodeId, guestId) => ipcRenderer.invoke("browser:register", { nodeId, guestId }),
  unregisterBrowser: (nodeId, guestId) => ipcRenderer.invoke("browser:unregister", { nodeId, guestId }),
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  readWorkspaceFile: (path) => ipcRenderer.invoke("workspace:read-file", { path }),
  writeWorkspaceFile: (path, content, revision) => ipcRenderer.invoke("workspace:write-file", { path, content, revision }),
  onWorkspaceUpdate: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("workspace:update", handler);
    return () => ipcRenderer.removeListener("workspace:update", handler);
  },
  createTerminal: (payload) => ipcRenderer.invoke("terminal:create", payload),
  writeTerminal: (id, data) => ipcRenderer.invoke(
    "terminal:write",
    id && typeof id === "object" ? id : { id, data },
  ),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke(
    "terminal:resize",
    id && typeof id === "object" ? id : { id, cols, rows },
  ),
  closeTerminal: (value) => ipcRenderer.invoke("terminal:close", idPayload(value)),
  terminalSnapshot: (value) => ipcRenderer.invoke("terminal:snapshot", idPayload(value)),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", { text }),
  onTerminalData: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalExit: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
  onContextNote: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("context:note", handler);
    return () => ipcRenderer.removeListener("context:note", handler);
  },
  onContextRequest: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("context:request", handler);
    return () => ipcRenderer.removeListener("context:request", handler);
  },
  onContextReply: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("context:reply", handler);
    return () => ipcRenderer.removeListener("context:reply", handler);
  },
  onMissionUpdate: (listener) => {
    if (typeof listener !== "function") throw new TypeError("Listener inválido.");
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("mission:update", handler);
    return () => ipcRenderer.removeListener("mission:update", handler);
  },
});

contextBridge.exposeInMainWorld("kordaDesktop", api);
