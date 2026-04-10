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

---

## Operating modes

This repository supports **two distinct working modes**:

### 1. Issue triage mode

Use this mode only when the task is clearly about:

- GitHub issues
- issue comments
- support-style diagnosis
- bug triage
- implementation planning before approval
- orchestrator / automation initiated issue handling

In this mode, the agent should:

- diagnose first
- classify the issue
- prefer user-side or operator-side fixes when appropriate
- propose an implementation plan before changing code
- avoid making code changes unless explicitly approved by the workflow

### 2. Direct coding mode

Use this mode when the user is directly asking to:

- modify code
- implement a feature
- refactor code
- fix a bug in the local repository
- update tests
- edit files directly
- make a patch in the working tree

In this mode, the agent should:

- directly inspect the repository
- make the requested code changes
- update tests if needed
- avoid unnecessary ticket-style diagnosis output
- avoid blocking on issue-approval rules unless the user explicitly asked for issue-style planning first

**Important rule:**  
If the user is working directly in the repository (for example via local Codex CLI / `codex code`) and asks to change code, default to **Direct coding mode**, not Issue triage mode.

---

## Mode selection rule

Choose the mode using this priority:

1. If the request explicitly references a GitHub issue, issue comment, triage, support response, or orchestrator workflow:
   - use **Issue triage mode**

2. If the request explicitly asks to implement, modify, edit, refactor, or patch code in the current repository:
   - use **Direct coding mode**

3. If uncertain:
   - prefer **Direct coding mode** for local repository work
   - prefer **Issue triage mode** only for support / issue handling contexts

---

## Issue triage categories

When in **Issue triage mode**, classify each issue into exactly one category:

- deployment_or_proxy_issue
- auth_or_security_config_issue
- connection_protocol_issue
- frontend_behavior_issue
- backend_logic_issue
- docs_gap
- feature_request
- unclear

### deployment_or_proxy_issue

Use this when the issue is likely caused by Docker, environment variables, reverse proxy, websocket forwarding, CORS, network, port exposure, or deployment topology.

### auth_or_security_config_issue

Use this when the issue is likely caused by authentication, captcha, 2FA, access restrictions, IP allow/deny rules, or other security configuration.

### connection_protocol_issue

Use this when the issue is related to SSH, SFTP, RDP, VNC, terminal session stability, keyboard-interactive auth, file transfer, remote desktop negotiation, or gateway protocol behavior.

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

---

## Context priorities

When searching for an answer or implementation path, prioritize sources in this order:

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

---

## Required behavior in Issue triage mode

When in **Issue triage mode**, determine:

- classification
- confidence
- needs_code_change
- needs_more_info
- likely_workspace
- related_paths
- root_cause_hypothesis
- reporter_next_steps
- maintainer_action_plan

### Issue triage comment style

When replying in issue triage mode:

- start with a short diagnosis
- mention the most likely workspace
- provide 2–5 concrete next steps
- ask only for the minimum reproducible details if more info is needed
- prefer operator guidance before code changes

### Issue triage approval rule

Only in **Issue triage mode**, implementation should be treated as approval-gated.

For orchestrator / issue workflow usage:

- code changes should be proposed only after explicit approval
- maintainer approval comment is:

`/codex implement`

**This rule applies only to issue automation / triage workflows.**  
**It does NOT block direct local repository coding requests.**

---

## Required behavior in Direct coding mode

When in **Direct coding mode**:

- directly make the requested code changes
- inspect the relevant files first
- keep changes minimal and scoped
- avoid unnecessary diagnosis-only output
- update tests if relevant
- summarize what was changed and any remaining risks

### Direct coding response style

In direct coding mode:

- do not respond like an issue triage bot
- do not require `/codex implement`
- do not stop at “建议下一步” unless the user explicitly asked for planning only
- prefer implementation over support-style analysis

---

## High-risk areas

For both modes, be conservative in these areas:

- authentication or session handling
- captcha / 2FA / login enforcement
- IP whitelist / blacklist / ban logic
- audit logs
- permission checks
- secret handling
- user account security
- data deletion / credential storage
- remote execution authorization

### High-risk rule

If a change affects these areas:

- avoid broad refactors
- prefer the smallest viable patch
- call out security or behavior risks clearly
- add or update tests where practical

---

## Implementation rules

Whenever actually implementing code:

1. Make the smallest viable change.
2. Avoid unrelated refactors.
3. Prefer fixing the correct workspace only.
4. Update tests if needed.
5. Summarize root cause, fix, deployment impact, and residual risk.
6. If the change is security-sensitive or could weaken access control, be extra conservative.

---

## Labels guidance

These labels are relevant only for issue automation / triage workflows:

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

Do not treat label logic as relevant for direct local coding work unless explicitly requested.
