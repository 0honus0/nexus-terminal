# Workspace Runtime

Workspace is a live composition owner, not a reusable capability owner.

It may compose feature public surfaces and implement their capability ports through Workspace protocol adapters. It owns Workspace lifecycle, connection-to-session binding, pane/layout composition, reconnect orchestration and suspend handoff.

It must not be imported by lower-level features or Agent internals.
