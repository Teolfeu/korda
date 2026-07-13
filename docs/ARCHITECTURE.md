# Architecture

```text
React renderer
  React Flow canvas, workbench, xterm and views
        │ validated IPC exposed by preload
        ▼
Electron main process
  node-pty, CLI detection, broker, run coordinator,
  workspace watcher, browser controller and metrics
        │
        ▼
User-selected local workspace
  real files and private ephemeral Korda spool
```

The Electron window uses context isolation, disables Node integration in the renderer and exposes a bounded preload API. The main process validates the sender and arguments of IPC handlers.

Cord connections authorize bidirectional broker requests. They do not broadcast terminal transcripts or automatically merge every agent's history. Agent tasks flow through authenticated `ask`, `inbox`, `reply` and `wait` operations.

Browser automation is limited to HTTP(S), fresh ephemeral interaction IDs and bounded visible-content extraction. Password, token, OTP and payment-card fields remain blocked.

See [MVP-CONTRACT.md](../MVP-CONTRACT.md) for the execution invariants and the tests for executable behavior.
