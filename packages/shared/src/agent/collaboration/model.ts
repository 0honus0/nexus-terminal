import type { AgentChildProfile } from './values.js';
import type { AgentRunStatus } from '../runs/values.js';

export interface AgentChildView {
	id: string;
	parentId: string;
	status: AgentRunStatus;
	version: number;
	profile: AgentChildProfile;
	deadlineAt: number;
}

export interface AgentMessageMetadata {
	sequence: number;
	senderId: string;
	bodyBytes: number;
	expiresAt: number;
}
