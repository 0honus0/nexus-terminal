import type { RemoteFileKind } from '@nexus-terminal/shared/remote/files/values';

export type ToolRemoteFileCommand =
	| { kind: 'read'; connectionId: number; input: ToolRemoteTextPageInput }
	| { kind: 'list'; connectionId: number; input: ToolRemoteListPageInput };

export interface ToolRemoteTextPageInput {
	path: string;
	offset: number;
	maxBytes: number;
}

export interface ToolRemoteListPageInput {
	path: string;
	after: string;
}

export interface ToolRemoteTextPage {
	path: string;
	text: string;
	bytes: number;
	sizeBytes: number;
	offset: number;
	nextOffset: number | null;
	sha256: string | null;
	pageSha256: string;
	fingerprint: string;
}

export interface ToolRemoteListPage {
	entries: { name: string; kind: RemoteFileKind; size: number; modifiedAt: number }[];
	nextAfter: string | null;
	fingerprint: string;
}

export type ToolRemoteTextPageResult =
	{ status: 'ok'; value: ToolRemoteTextPage } | { status: 'not_found' | 'not_text' };

export type ToolRemoteListPageResult = { status: 'ok'; value: ToolRemoteListPage } | { status: 'not_found' };
