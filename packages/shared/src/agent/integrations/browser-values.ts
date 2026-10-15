export const AGENT_BROWSER_MAX_BODY_BYTES = 32 * 1024;

export const AGENT_BROWSER_MAX_TARGETS = 32;

export const AGENT_BROWSER_MAX_TRANSFER_BYTES = 8 * 1024 * 1024;

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
