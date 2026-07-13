# Privacy model

Korda is a local desktop workbench. It does not include analytics, an account system or a Korda cloud service.

## What stays local

- Canvas layout and configuration are stored locally per workspace.
- PTY output, prompts, broker tokens and credentials are not persisted in the canvas state.
- The local broker stores bounded, authenticated request state inside a private ephemeral workspace directory and removes it when the workspace closes.
- Session metrics use locally observed structured data and do not read terminal transcripts.

## What may leave the computer

Korda starts third-party agent CLIs selected by the user. Those CLIs may contact their own providers according to their configuration, authentication and privacy policies. A browser block also loads the URL chosen by the user. Korda does not make those external services local or offline.

## Workspace access

Agents and terminals run with the current operating-system user's permissions. Open only trusted workspaces. File reading and saving through the Korda UI are root-confined, reject symlinks/traversal and apply size and text checks, but third-party CLIs have their own capabilities.
