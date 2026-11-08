# Browser targets

An administrator configures CDP endpoints and permitted page URL patterns per Browser Tools instance. Lower priority endpoints are tried first. Plain WebSocket requires explicit approval; TLS verification should normally stay enabled. Patterns match an HTTP(S) origin and an exact path or final path wildcard. Models cannot change these trust settings. Saving replaces this instance configuration and retires its existing sessions; other instances remain independent.
