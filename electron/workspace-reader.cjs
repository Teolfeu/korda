const fs = require("node:fs/promises");
const { constants, watch } = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist"]);
const MAX_TREE_DEPTH = 5;
const MAX_TREE_ENTRIES = 1200;
const MAX_TEXT_BYTES = 256 * 1024;
const WORKSPACE_WATCH_DEBOUNCE_MS = 180;

function isIgnoredWatchPath(filename) {
  if (filename == null) return false;
  const relative = Buffer.isBuffer(filename) ? filename.toString("utf8") : String(filename);
  return relative.split(/[\\/]+/u).some((part) => IGNORED_DIRECTORIES.has(part) || part.startsWith(".korda-runtime-") || part.startsWith(".korda-write-"));
}

function isIgnoredEntry(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith(".korda-runtime-") || name.startsWith(".korda-write-");
}

async function realRoot(root) {
  if (typeof root !== "string" || !root || root.includes("\0")) throw new TypeError("Workspace inválido.");
  const resolved = await fs.realpath(root);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error("Workspace inválido.");
  return resolved;
}

async function walk(root, directory, depth, state) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const nodes = [];
  for (const entry of entries) {
    if (state.count >= MAX_TREE_ENTRIES) {
      state.truncated = true;
      break;
    }
    if (entry.isSymbolicLink() || isIgnoredEntry(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;

    const absolute = path.join(directory, entry.name);
    const node = {
      name: entry.name,
      path: path.relative(root, absolute).split(path.sep).join("/"),
      type: entry.isDirectory() ? "directory" : "file",
    };
    state.count += 1;
    if (entry.isDirectory()) {
      if (depth < MAX_TREE_DEPTH) node.children = await walk(root, absolute, depth + 1, state);
      else {
        node.children = [];
        state.truncated = true;
      }
    }
    nodes.push(node);
  }
  return nodes;
}

async function readWorkspaceTree(root) {
  const resolved = await realRoot(root);
  const state = { count: 0, truncated: false };
  return {
    root: resolved,
    name: path.basename(resolved),
    tree: await walk(resolved, resolved, 0, state),
    truncated: state.truncated,
  };
}

function createWorkspaceWatcher(root, listener, options = {}) {
  if (typeof root !== "string" || !root || root.includes("\0")) throw new TypeError("Workspace inválido.");
  if (typeof listener !== "function") throw new TypeError("Listener inválido.");
  const debounceMs = options.debounceMs ?? WORKSPACE_WATCH_DEBOUNCE_MS;
  if (!Number.isInteger(debounceMs) || debounceMs < 0) throw new TypeError("Debounce inválido.");

  let active = true;
  let timer = null;
  let reading = false;
  let refreshQueued = false;

  const notifyFailure = (error) => {
    if (!active) return;
    listener({ root, error: error instanceof Error ? error.message : String(error) });
  };

  const refresh = async () => {
    timer = null;
    if (!active) return;
    if (reading) {
      refreshQueued = true;
      return;
    }
    reading = true;
    try {
      const result = await readWorkspaceTree(root);
      if (active) listener(result);
    } catch (error) {
      notifyFailure(error);
    } finally {
      reading = false;
      if (active && refreshQueued) {
        refreshQueued = false;
        timer = setTimeout(refresh, debounceMs);
      }
    }
  };

  const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
    if (!active || isIgnoredWatchPath(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  });
  watcher.on("error", (error) => {
    notifyFailure(error);
    dispose();
  });

  function dispose() {
    if (!active) return;
    active = false;
    refreshQueued = false;
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  }

  return dispose;
}

async function readWorkspaceText(root, relativePath) {
  const resolvedRoot = await realRoot(root);
  if (typeof relativePath !== "string" || !relativePath || relativePath.length > 4096 || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new TypeError("Caminho de arquivo inválido.");
  }
  if (relativePath.split(/[\\/]+/u).some((part) => part === "..")) throw new Error("Travessia de caminho não é permitida.");
  const requested = path.resolve(resolvedRoot, relativePath);
  if (requested === resolvedRoot || !requested.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Arquivo fora do workspace.");
  const resolved = await fs.realpath(requested);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Arquivo fora do workspace.");
  if (resolved !== requested) throw new Error("Links simbólicos não são permitidos.");

  const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let content;
  try {
    if (process.platform === "linux") {
      const opened = await fs.realpath(`/proc/self/fd/${handle.fd}`);
      if (opened === resolvedRoot || !opened.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Arquivo fora do workspace.");
    }
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("O caminho não é um arquivo.");
    if (stat.size > MAX_TEXT_BYTES) throw new Error("Arquivo grande demais para visualização.");
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > MAX_TEXT_BYTES) throw new Error("Arquivo grande demais para visualização.");
    content = buffer.subarray(0, bytes);
  } finally {
    await handle.close();
  }
  if (content.includes(0)) throw new Error("Arquivo binário não pode ser visualizado.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error("Arquivo binário não pode ser visualizado.");
  }
  return {
    path: path.relative(resolvedRoot, resolved).split(path.sep).join("/"),
    content: text,
    bytes: content.length,
    revision: contentRevision(content),
  };
}

function contentRevision(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function revisionConflict() {
  const error = new Error("O arquivo mudou no disco. Reabra-o antes de salvar novamente.");
  error.code = "WORKSPACE_REVISION_CONFLICT";
  return error;
}

async function writeWorkspaceText(root, relativePath, content, expectedRevision) {
  if (typeof content !== "string" || content.includes("\0")) throw new TypeError("Conteúdo de arquivo inválido.");
  const encoded = Buffer.from(content, "utf8");
  if (encoded.toString("utf8") !== content) throw new TypeError("Conteúdo de arquivo inválido.");
  if (encoded.length > MAX_TEXT_BYTES) throw new Error("Arquivo grande demais para salvar.");
  if (typeof expectedRevision !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(expectedRevision)) {
    throw new TypeError("Revisão de arquivo inválida.");
  }

  // The existing safe reader proves that the target already exists, is a
  // regular UTF-8 file, is not reached through a symlink and stays in root.
  const current = await readWorkspaceText(root, relativePath);
  if (current.revision !== expectedRevision) throw revisionConflict();

  const resolvedRoot = await realRoot(root);
  const target = path.resolve(resolvedRoot, current.path);
  const directory = path.dirname(target);
  const realDirectory = await fs.realpath(directory);
  if (realDirectory !== resolvedRoot && !realDirectory.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Arquivo fora do workspace.");
  const targetStat = await fs.lstat(target);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error("O caminho não é um arquivo regular.");

  const temporary = path.join(realDirectory, `.korda-write-${process.pid}-${crypto.randomUUID()}`);
  let temporaryHandle = null;
  let renamed = false;
  try {
    temporaryHandle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
      targetStat.mode & 0o777,
    );
    // fs.open aplica a umask do processo ao `mode`; restaure explicitamente as
    // permissões do arquivo original antes do commit atômico.
    await temporaryHandle.chmod(targetStat.mode & 0o777);
    await temporaryHandle.writeFile(encoded);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;

    // Recheck immediately before commit so two Korda saves cannot silently
    // overwrite each other. rename replaces the entry atomically.
    const beforeCommit = await readWorkspaceText(resolvedRoot, current.path);
    if (beforeCommit.revision !== expectedRevision) throw revisionConflict();
    if (await fs.realpath(directory) !== realDirectory) throw new Error("A pasta do arquivo mudou durante a gravação.");
    const commitTarget = await fs.lstat(target);
    if (!commitTarget.isFile() || commitTarget.isSymbolicLink()) throw new Error("O arquivo mudou durante a gravação.");

    await fs.rename(temporary, target);
    renamed = true;
    const directoryHandle = await fs.open(realDirectory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {});
    if (!renamed) await fs.rm(temporary, { force: true }).catch(() => {});
  }

  return {
    path: current.path,
    content,
    bytes: encoded.length,
    revision: contentRevision(encoded),
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_TREE_DEPTH,
  MAX_TREE_ENTRIES,
  WORKSPACE_WATCH_DEBOUNCE_MS,
  createWorkspaceWatcher,
  readWorkspaceText,
  readWorkspaceTree,
  writeWorkspaceText,
};
