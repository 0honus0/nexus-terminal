import type { RemoteFileKind } from '../../remote/files/values.js';

export interface AgentPluginRemoteTextPageRequest {
	connectionId: number;
	path: string;
	offset: number;
	maxBytes: number;
}

export interface AgentPluginRemoteListPageRequest {
	connectionId: number;
	path: string;
	after: string;
}

export interface AgentPluginRemoteTextPage {
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

export interface AgentPluginRemoteListPage {
	entries: { name: string; kind: RemoteFileKind; size: number; modifiedAt: number }[];
	nextAfter: string | null;
	fingerprint: string;
}

export type AgentPluginRemoteTextPageResult =
	{ status: 'ok'; value: AgentPluginRemoteTextPage } | { status: 'not_found' | 'not_text' };

export type AgentPluginRemoteListPageResult =
	{ status: 'ok'; value: AgentPluginRemoteListPage } | { status: 'not_found' };
