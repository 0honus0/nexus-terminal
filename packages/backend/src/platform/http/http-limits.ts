export const DEFAULT_JSON_BODY_BYTES = 16 * 1024;

/**
 * Technology ceiling only. Routes still opt in to their own much smaller
 * budgets; bounded text/JSON and binary multipart uploads have different encodings.
 */
export const MAX_HTTP_BODY_BYTES = 128 * 1024 * 1024;

/** Technology ceiling. Individual WS protocols must enforce their own smaller message budgets. */
export const MAX_WEBSOCKET_FRAME_BYTES = 32 * 1024 * 1024;

export const MAX_WEBSOCKET_INPUT_MESSAGES = 64;

export const MAX_WEBSOCKET_INPUT_BYTES = 2 * 1024 * 1024;

export const MAX_WEBSOCKET_BUFFER_BYTES = 1024 * 1024;
