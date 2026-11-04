export const AGENT_COLLABORATION_MESSAGE_MAX_PAGE = 32;

/** Existing encoded response budget; independent of saved execution or Child quotas. */
export const AGENT_COLLABORATION_MAX_RESPONSE_BYTES = 2_064_384;

export const AGENT_CHILD_PROFILES = ['explore', 'review', 'worker'] as const;

export type AgentChildProfile = (typeof AGENT_CHILD_PROFILES)[number];

export const AGENT_MESSAGE_METADATA_MAX_BODY_BYTES = 8 * 1024;
