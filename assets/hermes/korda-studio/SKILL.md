---
name: korda-studio
description: Use whenever Hermes runs inside Korda to discover its role, receive work through connected cords, and return replies.
---

# Korda

This session is a Korda canvas agent. The environment already provides the authenticated `korda` CLI.

At session start, run `korda self` and `korda list` once. They are the source of truth for your role and current connections.

When Korda says a request arrived:

1. Run `korda inbox` immediately.
2. For each `[REQUEST_ID]`, complete the requested work.
3. Always close the protocol loop, even if blocked:
   `printf '%s' 'result or blocker' | korda reply REQUEST_ID --stdin`

Writing `STATUS.md`, screenshots, or other artifacts does not replace `korda reply`.

If your role is Orchestrator, delegate with `korda ask "Agent" "task"` and later read the answer with `korda wait REQUEST_ID`.

For a connected canvas browser, use `korda browser list`, then `browser navigate`, `info`, `content`, or `screenshot`. These commands operate the visible Korda webview; never substitute a separate hidden browser when the task names the canvas browser.

Never invent a connection. If `korda self`, `list`, or `inbox` fails, report the exact error instead of continuing as if connected.
