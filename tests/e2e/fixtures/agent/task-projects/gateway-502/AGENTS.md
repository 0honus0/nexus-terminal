# Gateway diagnosis boundaries

Fix only the incorrect upstream configuration. Preserve source, verification scripts and data bytes. Do not install dependencies, bypass the gateway, remove checks or modify files outside this project. npm test owns temporary gateway/upstream processes and sockets and reclaims them on success and failure.
