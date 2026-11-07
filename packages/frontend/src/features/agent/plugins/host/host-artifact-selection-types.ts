import type {
	AgentPluginUiAnchor,
	AgentPluginUiArtifactSelection,
} from '@nexus-terminal/shared/agent/plugins/ui-events';
import type { ManagedArtifact } from '../../model/artifact-types';

export type HostArtifactSelectionAnchor = AgentPluginUiAnchor;

/** Trusted parent-page data; this object and its resource references never enter the frame. */
export interface HostArtifactPickerRequest {
	appId: string;
	items: ManagedArtifact[];
	anchor(): HostArtifactSelectionAnchor;
	element: HTMLIFrameElement;
}

export interface HostArtifactSelection {
	open(
		anchor: HostArtifactSelectionAnchor,
		keys: string[],
		signal: AbortSignal,
	): Promise<AgentPluginUiArtifactSelection[]>;
	read(keys: string[], signal: AbortSignal): Promise<AgentPluginUiArtifactSelection[]>;
	attach(key: string, threadId: string, signal: AbortSignal): Promise<AgentPluginUiArtifactSelection>;
	close(): void;
}

export interface HostArtifactSelectionOptions {
	appId: string;
	frame(): HTMLIFrameElement | null;
	pick(request: HostArtifactPickerRequest, signal: AbortSignal): Promise<ManagedArtifact[]>;
}
