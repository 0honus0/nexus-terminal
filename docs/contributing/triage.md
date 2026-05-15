# ISSUE_TRIAGE_POLICY

This repository uses an AI-assisted issue triage workflow for Nexus Terminal.

## Goals

- Reduce repeated support load for deployment and configuration issues
- Identify whether a problem belongs to frontend, backend, remote-gateway, or docs
- Provide actionable troubleshooting steps for operators
- Propose implementation plans for likely product defects
- Require explicit maintainer approval before code changes

## Product context

Nexus Terminal is a web-based remote access platform covering:

- SSH / SFTP
- RDP / VNC
- Docker-based deployment
- reverse proxy deployment
- authentication, captcha, and 2FA
- audit and security-related controls

Because of this, many reported issues are caused by:

- reverse proxy and websocket forwarding
- environment variables
- Docker deployment
- CORS
- auth/security configuration
- protocol-specific remote connection setup

## Classification

Every issue should be classified as one of:

- `deployment_or_proxy_issue`
- `auth_or_security_config_issue`
- `connection_protocol_issue`
- `frontend_behavior_issue`
- `backend_logic_issue`
- `docs_gap`
- `feature_request`
- `unclear`

## Decision rules

### deployment_or_proxy_issue

Use this when the issue is likely caused by:

- nginx or reverse proxy configuration
- websocket upgrade handling
- Docker / compose deployment
- environment variables
- port exposure
- TLS / forwarded headers
- CORS or browser-origin behavior

### auth_or_security_config_issue

Use this when the issue is likely caused by:

- login flow configuration
- captcha configuration
- 2FA behavior
- IP whitelist / blacklist
- security restriction misunderstanding

### connection_protocol_issue

Use this when the issue is mainly related to:

- SSH
- SFTP
- RDP
- VNC
- keyboard-interactive auth
- remote desktop gateway behavior
- remote session stability

### frontend_behavior_issue

Use this when the issue is mainly:

- UI rendering
- theme/layout
- terminal display or interaction
- file manager UX
- client-side caching/state
- browser-only failures

### backend_logic_issue

Use this only when repository context strongly suggests a real backend or gateway defect.

### docs_gap

Use this when the likely answer exists but the documentation is missing, insufficient, or hard to find.

### feature_request

Use this when the report is asking for a new capability rather than describing a broken one.

### unclear

Use this when the report lacks enough detail for responsible diagnosis.

## Automation policy

### May auto-reply

- deployment_or_proxy_issue
- auth_or_security_config_issue
- connection_protocol_issue caused by configuration
- docs_gap
- unclear

### Must not auto-implement

- auth/session logic
- security controls
- audit logic
- credential handling
- access control
- IP ban/allow logic
- low-confidence diagnoses
- issues without a plausible reproduction path

### May propose implementation plan

- backend_logic_issue
- frontend_behavior_issue
- connection_protocol_issue with clear defect evidence
- feature_request

### May implement only after maintainer approval

A maintainer must comment:

`/codex implement`

## Required follow-up information

When more information is required, ask only for:

- Nexus Terminal version
- deployment method (Docker / source / other)
- reverse proxy in use (nginx / caddy / none / other)
- browser and OS if UI-related
- exact protocol affected (SSH / SFTP / RDP / VNC)
- exact steps to reproduce
- exact error output
- sanitized config snippet if relevant
- whether the issue reproduces behind direct access vs reverse proxy

## Default doc lookup order

1. `README.md`
2. `doc/NGINX_PROXY.md`
3. `doc/DOCKER_ENV.md`
4. `doc/CORS_CONFIG.md`
5. other `doc/**`
6. matching workspace source and tests
