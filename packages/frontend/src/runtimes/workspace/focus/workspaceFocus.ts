import { computed, ref } from 'vue';
import type { WorkspaceFocusConfig } from '../model/presentation-types';
import type { WorkspaceSettingsRepository } from '../ports/workspace-settings-repository';

export const workspaceFocusTargets = [
	'quickCommandsSearch',
	'commandHistorySearch',
	'fileManagerSearch',
	'commandInput',
	'terminalSearch',
	'connectionListSearch',
	'fileEditorActive',
	'fileManagerPathInput',
] as const;

export const normalizeWorkspaceFocusShortcut = (value: string): string | null => {
	const match = value.trim().match(/^Alt\+([A-Za-z0-9])$/);
	return match ? `Alt+${match[1]?.toUpperCase()}` : null;
};

export function cloneWorkspaceFocus(value: WorkspaceFocusConfig): WorkspaceFocusConfig {
	return { sequence: value.sequence.map((id) => id), shortcuts: Object.fromEntries(Object.entries(value.shortcuts)) };
}

export const createWorkspaceFocusController = (
	settingsRepository: WorkspaceSettingsRepository,
	capturePermission: () => AbortSignal,
) => {
	const config = ref<WorkspaceFocusConfig>({ sequence: [...workspaceFocusTargets], shortcuts: {} });
	const loaded = ref(false);
	const version = ref(0);
	let revision = 0;
	return {
		resetState(): void {
			revision++;
			loaded.value = false;
			version.value = 0;
			config.value = { sequence: [...workspaceFocusTargets], shortcuts: {} };
		},

		config,
		loaded: computed(() => loaded.value),
		version: computed(() => version.value),

		async load(force = false): Promise<void> {
			if (loaded.value && !force) return;
			const permission = capturePermission();
			const originalRevision = ++revision;
			const value = await settingsRepository.loadFocus(force);
			if (permission.aborted || revision !== originalRevision) return;
			config.value = cloneWorkspaceFocus(value.focus);
			version.value = value.version;
			loaded.value = true;
		},

		async save(
			next: WorkspaceFocusConfig,
			expectedVersion = version.value,
			permission = capturePermission(),
		): Promise<void> {
			const focus = cloneWorkspaceFocus(next);
			const originalRevision = ++revision;
			const result = await settingsRepository.saveFocus({ version: expectedVersion, focus }, permission);
			if (permission?.aborted || revision !== originalRevision) return;
			config.value = focus;
			version.value = result;
			loaded.value = true;
		},
	};
};

export type WorkspaceFocusController = ReturnType<typeof createWorkspaceFocusController>;
