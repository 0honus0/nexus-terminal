# Remote Gateway Architecture

The Remote Gateway is a small, separate runtime that bridges Nexus Terminal to `guacd` for browser RDP/VNC sessions. It is intentionally isolated from the main backend application graph.

The package targets ES2025 and is built independently from the backend and frontend.

## Responsibilities

The gateway owns only remote-desktop transport concerns:

- start the Guacamole WebSocket endpoint;
- expose the private remote-desktop token API;
- validate RDP/VNC connection parameters before issuing a token;
- encrypt Guacamole connection tokens with an in-memory process key;
- authenticate backend-to-gateway API calls with the shared gateway secret;
- connect GuacamoleLite to `guacd`;
- close the HTTP and Guacamole servers on process shutdown.

Nexus product policy, stored connections, credential decryption, authorization, and user/session ownership remain in the main backend. The backend `RemoteDesktopSessionService` resolves product state and sends only the concrete connection request needed by the gateway.

## Runtime endpoints

The gateway has two listeners:

```text
REMOTE_GATEWAY_API_PORT   private HTTP API, default 9090
REMOTE_GATEWAY_WS_PORT    Guacamole WebSocket endpoint, default 8080
```

The token API is under `/api/remote-desktop` and requires `x-nexus-gateway-secret`. The shared secret must be at least 32 characters.

The gateway loads environment data from the configured Nexus data environment path and the supported local/container fallback paths. In the unified Docker deployment, backend and gateway share the persisted Nexus data environment so the backend-generated gateway secret is available to both processes.

## Deployment relationship

The unified image exposes independent runtime roles through `docker/entrypoint.sh`:

```text
backend
remote-gateway
frontend
```

`docker-compose.yml` runs the Remote Gateway as its own service and points the backend to its private API/WebSocket addresses. `guacd` remains a separate service behind the gateway.

## Build

From the repository root:

```bash
npm run build:remote-gateway
```

Mandatory project-wide engineering rules live in [Engineering Constraints](../software-requirements/engineering-constraints.md).
