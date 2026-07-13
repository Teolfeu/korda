import { useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  Code,
  FileCode,
  FloppyDisk,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";

function filterTree(items, query) {
  const wanted = query.trim().toLocaleLowerCase("pt-BR");
  if (!wanted) return items;
  return items.flatMap((item) => {
    const children = filterTree(item.children || [], wanted);
    if (item.name.toLocaleLowerCase("pt-BR").includes(wanted) || children.length) return [{ ...item, children }];
    return [];
  });
}

function TreeItem({ item, depth = 0, activePath, onOpenFile }) {
  const [open, setOpen] = useState(depth < 3);
  const directory = item.type === "directory";
  return <div className="tree-branch">
    <button
      type="button"
      className={`tree-item ${!directory && activePath === item.path ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 15 }}
      onClick={() => directory ? setOpen((value) => !value) : onOpenFile?.(item)}
      title={item.path || item.name}
    >
      <span className="tree-caret">{directory && <CaretDown size={11} className={open ? "" : "closed"} />}</span>
      {directory ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileCode size={14} />}
      <span>{item.name}</span>
    </button>
    {directory && open && item.children?.map((child) => <TreeItem key={child.path || `${item.name}/${child.name}`} item={child} depth={depth + 1} activePath={activePath} onOpenFile={onOpenFile} />)}
  </div>;
}

export function WorkspaceExplorer({ tree, name, root, ready, watchError, activePath, onPick, onOpenFile, onResizeStart }) {
  const [query, setQuery] = useState("");
  const hasFiles = tree.length > 0;
  const filteredTree = useMemo(() => filterTree(tree, query), [query, tree]);
  return <aside className="workspace-drawer" aria-label="Explorer do workspace">
    <header><b>Explorer</b><button onClick={onPick} title="Abrir pasta" aria-label="Abrir pasta"><Plus size={17} /></button></header>
    {hasFiles ? <>
      <div className="file-search"><MagnifyingGlass size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar arquivos" aria-label="Buscar arquivos" /><SlidersHorizontal size={14} /></div>
      <div className="workspace-folder-label" title={root || name}><CaretDown size={11} /><FolderOpen size={14} /><b>{name}</b></div>
      <div className="workspace-tree">{filteredTree.length ? filteredTree.map((item) => <TreeItem key={item.path || item.name} item={item} activePath={activePath} onOpenFile={onOpenFile} />) : <p className="workspace-no-results">Nenhum arquivo encontrado.</p>}</div>
      <footer className="drawer-status" title={root || undefined}><span><FolderOpen size={14} />{name}</span><small role={watchError ? "alert" : undefined}>{watchError ? "Atualização pausada" : "Pasta local · ao vivo"}</small></footer>
    </> : <div className="workspace-empty"><FolderOpen size={24} /><b>{ready ? "Pasta vazia" : "Nenhuma pasta aberta"}</b><span>{ready ? watchError || "Esta pasta ainda não possui arquivos visíveis." : "Abra uma pasta local para explorar seus arquivos."}</span><button type="button" onClick={onPick}>Abrir pasta</button></div>}
    <button type="button" className="explorer-resize-handle" onPointerDown={onResizeStart} aria-label="Redimensionar Explorer" title="Arraste para redimensionar" />
  </aside>;
}

function Breadcrumbs({ path }) {
  const parts = path.split("/").filter(Boolean);
  return <nav className="file-breadcrumbs" aria-label="Caminho do arquivo">
    {parts.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <i>›</i>}{index === parts.length - 1 ? <FileCode size={13} /> : <Folder size={13} />}{part}</span>)}
  </nav>;
}

function SourceEditor({ document, onChange, onSave, onReload }) {
  const gutterRef = useRef(null);
  if (document.loading) return <div className="file-state"><span className="file-loader" />Carregando arquivo…</div>;
  if (document.error) return <div className="file-state error" role="alert"><b>Não foi possível abrir o arquivo</b><span>{document.error}</span><button type="button" onClick={() => onReload(document.path)}><ArrowClockwise size={13} />Recarregar</button></div>;
  const lines = String(document.content ?? "").split("\n");
  return <div className="source-editor-shell">
    {document.saveError && <div className="editor-error-banner" role="alert"><span><b>Não foi possível salvar.</b> {document.saveError}</span><button type="button" onClick={() => onReload(document.path)}><ArrowClockwise size={13} />Recarregar</button></div>}
    <div className="source-editor" role="region" aria-label={`Editor de ${document.path}`}>
      <pre ref={gutterRef} className="source-editor-gutter" aria-hidden="true">{lines.map((_, index) => index + 1).join("\n")}</pre>
      <textarea
        value={document.content ?? ""}
        onChange={(event) => onChange(document.path, event.target.value)}
        onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void onSave(document.path);
          }
        }}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Editar ${document.path}`}
      />
    </div>
  </div>;
}

function saveLabel(document) {
  if (document.saving) return "Salvando…";
  if (document.saveError) return "Erro ao salvar";
  if (document.content !== document.savedContent) return "Alterações não salvas";
  return document.saved ? "Salvo" : "Sem alterações";
}

export function WorkbenchDeck({ documents, activeView, onActivate, onClose, onChange, onSave, onReload, canvas }) {
  const activeDocument = documents.find((document) => document.path === activeView);
  return <section className="workbench-deck">
    <div className="workbench-tabs" role="tablist" aria-label="Arquivos e canvas abertos">
      <button type="button" role="tab" aria-selected={activeView === "canvas"} className={activeView === "canvas" ? "active" : ""} onClick={() => onActivate("canvas")}><Code size={14} />Canvas</button>
      {documents.map((document) => <div className={`file-tab ${activeView === document.path ? "active" : ""}`} key={document.path} title={document.path}>
        <button type="button" role="tab" aria-selected={activeView === document.path} onClick={() => onActivate(document.path)}><FileCode size={14} /><span>{document.name}</span>{document.content !== document.savedContent && <i className="file-tab-dirty" title="Alterações não salvas" aria-label="Alterações não salvas" />}</button>
        <button type="button" className="file-tab-close" aria-label={`Fechar ${document.name}`} onClick={() => onClose(document.path)}><X size={12} /></button>
      </div>)}
    </div>
    <div className="workbench-panes">
      <div className={`workbench-pane canvas-pane ${activeView === "canvas" ? "active" : "inactive"}`} aria-hidden={activeView !== "canvas"}>{canvas}</div>
      <div className={`workbench-pane file-pane ${activeDocument ? "active" : "inactive"}`} aria-hidden={!activeDocument}>
        {activeDocument && <><Breadcrumbs path={activeDocument.path} /><div className="file-editor-toolbar"><span role="status" aria-live="polite" className={`editor-save-state ${activeDocument.saveError ? "error" : activeDocument.content !== activeDocument.savedContent ? "dirty" : ""}`}>{saveLabel(activeDocument)}</span><button type="button" onClick={() => void onSave(activeDocument.path)} disabled={activeDocument.loading || activeDocument.saving || activeDocument.content === activeDocument.savedContent}><FloppyDisk size={14} />Salvar <kbd>Ctrl/⌘ S</kbd></button></div><SourceEditor document={activeDocument} onChange={onChange} onSave={onSave} onReload={onReload} /><footer className="file-statusbar"><span>Editável</span><span>{activeDocument.bytes != null ? `${activeDocument.bytes.toLocaleString("pt-BR")} bytes` : "Arquivo local"}</span><span>UTF-8</span></footer></>}
      </div>
    </div>
  </section>;
}
