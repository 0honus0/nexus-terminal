import type { AgentPluginUiStreamCommand, AgentPluginUiStreamPage, AgentPluginUiStreamFailure } from './ui-streams.js';
import type { AgentHttpErrorCode } from '../values.js';
import type { AgentRunStatus } from '../runs/values.js';
import type { AgentCloseResourcesRequest } from '../runs/http.js';
import type { AgentArtifactResponse } from '../artifacts/http.js';

export interface AgentPluginUiTarget {
	id: number;
	name: string;
	host: string;
	username: string;
}

/** Presentation projection only: authentication, browser storage and resources stay with Host. */
export interface AgentPluginUiCheckpoint {
	/** Schema version owned and decoded exclusively by the signed UI package. */
	version: number;
	valueJson: string;
}

export interface AgentPluginUiEnvironment {
	appId: string;
	appVersion: number;
	checkpoint: AgentPluginUiCheckpoint | null;
	active: boolean;
	minimized: boolean;
	compact: boolean;
	executionEnabled: boolean;
	resumeRevision: number;
	locale: string;
	dark: boolean;
	themeVariables: { name: string; value: string }[];
	imagePreviewMaxMiB: number;
	targets: AgentPluginUiTarget[];
	preferredTargetIds: number[];
}

export interface AgentPluginUiTask {
	runId: string;
	threadTitle: string;
	locallyStarted: boolean;
	status: AgentRunStatus;
	preview: string;
	blocked: boolean;
	failureMessage: string;
	failureKey: string;
}

/** Only explicitly chosen resources enter the frame, addressed through an opaque Host selection. */
export interface AgentPluginUiArtifactSelection {
	key: string;
	id: string;
	name: string;
	version: number;
	sha256: string;
	mediaType: string;
	sizeBytes: number;
}

export interface AgentPluginUiAnchor {
	left: number;
	top: number;
	width: number;
	height: number;
}

export type AgentPluginUiHostInput =
	| { kind: 'checkpoint.save'; checkpoint: AgentPluginUiCheckpoint }
	| { kind: 'targets.remember'; ids: number[] }
	| {
			kind: 'feedback.notify';
			tone: 'success' | 'error' | 'info' | 'warning';
			message: string;
			duration: number | null;
	  }
	| {
			kind: 'feedback.confirm';
			title: string;
			message: string;
			confirmText: string;
			cancelText: string;
			destructive: boolean;
	  }
	| { kind: 'resources.close'; target: AgentCloseResourcesRequest['target'] }
	| { kind: 'task.update'; task: AgentPluginUiTask | null }
	| { kind: 'window.open' }
	| { kind: 'artifact.upload'; artifactId: string; expectedVersion: number }
	| { kind: 'artifact.download'; artifactId: string }
	| { kind: 'artifact.selection.open'; anchor: AgentPluginUiAnchor; keys: string[] }
	| { kind: 'artifact.selection.read'; keys: string[] }
	| { kind: 'artifact.selection.attach'; key: string; threadId: string };

export type AgentPluginUiHostResult =
	| {
			kind:
				| 'checkpoint.save'
				| 'targets.remember'
				| 'feedback.notify'
				| 'task.update'
				| 'window.open'
				| 'artifact.download';
			accepted: true;
	  }
	| { kind: 'feedback.confirm'; confirmed: boolean }
	| { kind: 'resources.close'; closed: boolean }
	| { kind: 'artifact.upload'; result: AgentArtifactResponse }
	| { kind: 'artifact.selection.open' | 'artifact.selection.read'; selections: AgentPluginUiArtifactSelection[] }
	| { kind: 'artifact.selection.attach'; selection: AgentPluginUiArtifactSelection };

export interface AgentPluginUiHostFailure {
	code: AgentHttpErrorCode | 'request_failed' | 'protocol_failure' | 'cancelled';
	outcome: 'not_dispatched' | 'confirmed' | 'unknown';
}

export type AgentPluginUiClientMessage =
	| { type: 'nexus.ui.request'; id: string; input: AgentPluginUiHostInput; file?: File }
	| { type: 'nexus.ui.cancel'; id: string }
	| AgentPluginUiStreamCommand;

export type AgentPluginUiHostMessage =
	| { type: 'nexus.ui.environment'; environment: AgentPluginUiEnvironment }
	| { type: 'nexus.ui.task.open'; runId: string }
	| { type: 'nexus.ui.response'; id: string; result: AgentPluginUiHostResult }
	| { type: 'nexus.ui.failure'; id: string; error: AgentPluginUiHostFailure }
	| { type: 'nexus.ui.closed' }
	| AgentPluginUiStreamPage
	| AgentPluginUiStreamFailure;
