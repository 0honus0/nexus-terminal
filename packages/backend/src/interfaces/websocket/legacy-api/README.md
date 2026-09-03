# Legacy WebSocket compatibility layer

This directory is a temporary adapter for the current frontend WebSocket contract.

Responsibilities:

- translate legacy client message names/payload shapes into the new Workspace application-service calls;
- translate protocol-neutral Workspace events/results back to the current frontend message shapes;
- contain compatibility-only field aliases and historical message naming inconsistencies.

It must NOT:

- own SSH/SFTP/Docker/session business logic;
- import Bootstrap or Infrastructure concrete implementations;
- be imported by Modules, Platform, Infrastructure, Bootstrap, HTTP, or non-WebSocket interfaces.

Deletion condition:
When the frontend is migrated to the new WebSocket contract, remove this entire directory and point the WebSocket router/event adapter directly at the new protocol DTOs. No Module or Platform changes should be required.
