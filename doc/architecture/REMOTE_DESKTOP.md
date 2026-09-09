# Remote Desktop Architecture

Nexus Terminal's browser RDP/VNC runtime runs inside the main Backend process. The Backend owns the public HTTP/WebSocket boundary and embeds `guacamole-lite`; `guacd` remains a separate service reached over its native TCP protocol.

## Responsibilities

The Remote Desktop capability is split across normal Backend layers:

- `RemoteDesktopSessionService` resolves stored connections, decrypts credentials, validates display options and records connection attempts;
- `GuacamoleRuntimeAdapter` creates short-lived opaque browser tickets and stores the concrete connection request only in Backend memory;
- `/ws/remote-desktop` stays under the Backend's single WebSocket upgrade owner, so Origin, IP policy, HTTP session and 2FA checks run before Guacamole is reached;
- a valid ticket is consumed once, is bound to the authenticated user, and expires after a short TTL;
- after ticket consumption, the in-process Guacamole runtime connects directly to `guacd`;
- shutdown closes Backend WebSockets and Guacamole connections as part of the normal application lifecycle.

Connection credentials are never returned to the browser. The browser receives only an opaque random ticket.

## Guacamole compatibility bridge

`guacamole-lite` 1.2.0 expects its own encrypted connection token internally. Nexus keeps this only as an implementation shim inside the Backend process: the internal token contains a one-time bridge id, never hostname, username, password or RemoteApp credentials. The Guacamole runtime adapter resolves that bridge id synchronously to the already-consumed in-memory ticket record before connecting to `guacd`.

This compatibility detail is private to `infrastructure/guacamole` and is not part of the frontend or HTTP API contract.

## Runtime endpoints

The public runtime has no dedicated Remote Desktop ports:

```text
Backend HTTP/WebSocket   PORT, default 3001
Guacd TCP                GUACD_PORT, default 4822
```

The frontend continues to use:

```text
POST /api/v1/connections/:id/rdp-session
POST /api/v1/connections/:id/vnc-session
WS   /ws/remote-desktop?ticket=...
```

There is no private 9090 token API and no 8080 Guacamole WebSocket listener.

## Deployment relationship

The unified image has `frontend` and `backend` runtime roles. `docker-compose.yml` runs `guacd` as its own service and wires the Backend to the internal `guacd:4822` endpoint. Standalone Backend deployments can still override `GUACD_HOST` / `GUACD_PORT` directly in their process environment.

The resulting path is:

```text
browser -> frontend/nginx -> backend:3001 -> guacamole-lite -> guacd:4822 -> RDP/VNC target
```
