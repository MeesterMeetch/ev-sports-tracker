---
name: GitHub push via connector token
description: How to push this repo to GitHub using the Replit GitHub connector credentials
---

The project is mirrored to a private repo: `MeesterMeetch/ev-sports-tracker` (created July 2026 to share code with an AI assistant). No git remote is configured locally — pushes are done ad hoc with an explicit URL so no token is stored in `.git/config`.

**Rule:** git-over-HTTPS to github.com rejects `Authorization: Bearer <token>` for connector OAuth tokens (git falls back to a username prompt → "could not read Username" error). Use Basic auth instead: `http.extraHeader="Authorization: Basic base64(x-access-token:<token>)"`.

**Why:** Bearer works for the GitHub REST API but not for git smart-HTTP with this token type; the failure mode is a misleading credential-prompt error, not a 401.

**How to apply:** Get the token via `listConnections('github')` in the code_execution sandbox, then from there run:
`git -c http.extraHeader="Authorization: Basic <b64>" push https://github.com/MeesterMeetch/ev-sports-tracker.git HEAD:main`
with `GIT_TERMINAL_PROMPT=0`. Keep the token out of console output and shell history (run via execSync in the sandbox, redact on error).
