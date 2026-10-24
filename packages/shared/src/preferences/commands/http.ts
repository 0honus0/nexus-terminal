import type { QuickCommand, QuickCommandTag } from './model.js';
import type { CommandSort, CommandErrorCode } from './values.js';

export interface QuickCommandCreateRequest {
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
}

export interface QuickCommandUpdateRequest {
	expectedVersion: number;
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
}

export interface CommandVersionRequest {
	expectedVersion: number;
}

export interface CommandTagCreateRequest {
	name: string;
}

export interface CommandTagUpdateRequest {
	name: string;
	expectedVersion: number;
}

export interface CommandGroupDeleteRequest {
	expectedVersion: number;
	commands: Array<{ id: number; expectedVersion: number }>;
}

export interface CommandAssignTagRequest {
	commands: Array<{ id: number; expectedVersion: number }>;
	tagId: number;
}

export interface CommandListQuery {
	offset: number;
	limit: number;
	sortBy: CommandSort;
}

export interface CommandListResponse {
	entries: QuickCommand[];
	nextOffset: number | null;
}

export interface CommandTagListResponse {
	entries: QuickCommandTag[];
	nextOffset: number | null;
}

export interface CommandMutationResponse {
	command: QuickCommand;
}

export interface CommandTagMutationResponse {
	tag: QuickCommandTag;
}

export interface CommandDeleteResponse {
	deleted: true;
}

export interface CommandAssignTagResponse {
	count: number;
}

export interface CommandErrorResponse {
	code: CommandErrorCode;
}
