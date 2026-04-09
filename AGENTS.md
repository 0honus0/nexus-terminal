# AGENTS.md

## Repository purpose

Nexus Terminal is a modern web-based remote access platform for SSH, SFTP, RDP, and VNC.
It includes a frontend application, a backend service, and a remote-gateway workspace.
It also contains deployment and operation documentation for Docker, nginx reverse proxy, CORS, and environment configuration.

## Repository structure

Important paths:

- `packages/backend` — backend APIs, auth, connections, audit, data and business logic
- `packages/frontend` — web UI, terminal workspace, file manager, settings, remote desktop UI
- `packages/remote-gateway` — gateway / remote protocol related logic
- `doc/DOCKER_ENV.md` — deployment environment variables and Docker-related setup
- `doc/NGINX_PROXY.md` — reverse proxy setup and websocket-related deployment notes
- `doc/CORS_CONFIG.md` — CORS behavior and multi-origin configuration guidance
- `README.md` — product overview, feature list, quick start, supported deployment notes

## Triage goals

When analyzing GitHub issues, classify each issue into exactly one category:

- deployment_or_proxy_issue
- auth_or_security_config_issue
- connection_protocol_issue
- frontend_behavior_issue
- backend_logic_issue
- docs_gap
- feature_request
- unclear

## Classification guidance

### deployment_or_proxy_issue

Use this when the issue is likely caused by Docker, environment variables, reverse proxy, websocket forwarding, CORS, network, port exposure, or deployment topology.

Typical examples:

- nginx reverse proxy misconfiguration
- websocket upgrade failure
- container startup failure
- wrong environment variable values
- Docker compose deployment problems
- CORS misconfiguration
- TLS / domain / proxy header issues

### auth_or_security_config_issue

Use this when the issue is likely caused by authentication, captcha, 2FA, access restrictions, IP allow/deny rules, or other security configuration.

Typical examples:

- login rejected because of captcha config
- 2FA flow mismatch
- IP whitelist / blacklist confusion
- audit or security policy misunderstanding

### connection_protocol_issue

Use this when the issue is related to SSH, SFTP, RDP, VNC, terminal session stability, keyboard-interactive auth, file transfer, remote desktop negotiation, or gateway protocol behavior.

Typical examples:

- SSH connection fails
- SFTP upload/download/archive problems
- RDP/VNC connection initialization fails
- keyboard-interactive / TOTP SSH auth issues
- remote-gateway handshake behavior

### frontend_behavior_issue

Use this when the backend and deployment look healthy but the issue is mainly about UI behavior, rendering, theme/layout, terminal interaction, file manager UX, caching, or client-side errors.

### backend_logic_issue

Use this only when repository context strongly suggests an actual backend or gateway defect rather than configuration or usage error.

### docs_gap

Use this when the product behavior is reasonable but the documentation is missing, hard to find, outdated, or misleading.

### feature_request

Use this when the user is asking for new behavior rather than reporting a broken one.

### unclear

Use this when the report lacks enough information for responsible diagnosis.

## Context priorities

When searching for an answer, prioritize sources in this order:

1. `AGENTS.md`
2. `README.md`
3. `doc/NGINX_PROXY.md`
4. `doc/DOCKER_ENV.md`
5. `doc/CORS_CONFIG.md`
6. Other files under `doc/**`
7. `packages/backend/**`
8. `packages/remote-gateway/**`
9. `packages/frontend/**`
10. Relevant tests for the same module

## Required triage output

For every issue analysis, always determine:

- classification
- confidence
- needs_code_change
- needs_more_info
- likely_workspace
- related_paths
- root_cause_hypothesis
- reporter_next_steps
- maintainer_action_plan
- concise_comment_markdown

## High-risk areas

If the issue touches any of the following, do not auto-implement unless a maintainer explicitly requests it:

- authentication or session handling
- captcha / 2FA / login enforcement
- IP whitelist / blacklist / ban logic
- audit logs
- permission checks
- secret handling
- user account security
- data deletion / credential storage
- remote execution authorization

## Auto-reply policy

The assistant may auto-reply when confidence is high and the issue is likely:

- deployment_or_proxy_issue
- auth_or_security_config_issue
- connection_protocol_issue caused by configuration
- docs_gap
- unclear

Prefer operational guidance first:

- exact config to verify
- exact doc path to check
- exact logs / reproduction info to request

## Auto-implementation gate

Only implement code changes when a maintainer explicitly comments:

`/codex implement`

## Implementation rules

If implementation is explicitly requested:

1. Make the smallest viable change.
2. Avoid unrelated refactors.
3. Prefer fixing the correct workspace only.
4. Update tests if needed.
5. Summarize root cause, fix, deployment impact, and residual risk in the PR body.
6. If the issue is security-sensitive or could weaken access control, stop and return a plan instead of a patch.

## Comment style

When replying to issues:

- Start with a short diagnosis.
- Mention the most likely workspace (`backend`, `frontend`, `remote-gateway`, or docs/deployment).
- Provide 2-5 concrete next steps.
- If more info is needed, ask only for the minimum reproducible details.
- For deployment issues, request sanitized config only.
- Never ask users to paste secrets, passwords, private keys, tokens, or full database credentials.

## Labels guidance

Use these labels where relevant:

- triaged
- needs-info
- deployment
- proxy
- auth
- security-config
- ssh
- sftp
- rdp
- vnc
- frontend
- backend
- remote-gateway
- docs
- feature
- bug-candidate
- ai-proposed-fix
