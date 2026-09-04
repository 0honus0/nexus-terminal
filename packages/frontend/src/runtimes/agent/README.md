# Agent Runtime

Agent owns an independent conversation/execution runtime and protocol composition.

It may consume reusable capability ports exposed by features, but must never reuse Workspace raw sockets, session state, terminal/SFTP managers, upload channels or current runtime process/path state.
