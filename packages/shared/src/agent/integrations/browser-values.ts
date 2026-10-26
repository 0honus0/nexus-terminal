export const AGENT_BROWSER_MAX_BODY_BYTES = 32 * 1024;

export const AGENT_BROWSER_MAX_TARGETS = 32;

export const AGENT_BROWSER_TARGET_ID_MAX_BYTES = 128;

export const AGENT_BROWSER_MAX_ENDPOINTS = 8;

export const AGENT_BROWSER_ENDPOINT_MAX_BYTES = 4096;

export const AGENT_BROWSER_MAX_PATTERNS = 32;

export const AGENT_BROWSER_PATTERN_MAX_BYTES = 2048;

export const AGENT_BROWSER_MAX_PRIORITY = 100;

export const AGENT_BROWSER_ACTIONS = [
	'open',
	'close',
	'snapshot',
	'screenshot',
	'console',
	'navigate',
	'back',
	'scroll',
	'press',
	'select',
	'wait',
	'click',
	'type',
	'upload',
	'download',
] as const;

export type AgentBrowserAction = (typeof AGENT_BROWSER_ACTIONS)[number];

export const AGENT_BROWSER_MAX_SETTLE_MS = 2000;
