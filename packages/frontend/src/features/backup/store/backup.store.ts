import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { backupApi } from '../api/backup-api';
import { BackupRequestFailure, type RestoreState } from '../model/backup-types';

export const useBackupStore = defineStore('backup', () => {
	const state = shallowRef<RestoreState>({ status: 'idle' });
	const busy = ref(false);
	let scope = new AbortController();

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		// Restore affects global data, so an accepted restore remains fenced across identity changes.
	}

	async function exportFull(password: string, permission: AbortSignal): Promise<void> {
		if (busy.value || state.value.status !== 'idle') {
			throw new BackupRequestFailure('busy', 'not_dispatched');
		}
		const signal = AbortSignal.any([scope.signal, permission]);
		if (signal.aborted) {
			throw new BackupRequestFailure('cancelled', 'not_dispatched');
		}
		busy.value = true;
		try {
			await backupApi.exportFull(password, signal);
		} finally {
			busy.value = false;
		}
	}

	async function importFull(file: File, password: string | null, permission: AbortSignal): Promise<void> {
		if (busy.value || state.value.status !== 'idle') {
			throw new BackupRequestFailure('busy', 'not_dispatched');
		}
		const signal = AbortSignal.any([scope.signal, permission]);
		if (signal.aborted) {
			throw new BackupRequestFailure('cancelled', 'not_dispatched');
		}
		busy.value = true;
		state.value = { status: 'restoring' };
		try {
			const receipt = await backupApi.importFull(file, password, signal);
			state.value = { status: 'restored', receipt };
		} catch (cause) {
			const unknown = !(cause instanceof BackupRequestFailure) || cause.outcome === 'unknown';
			state.value = unknown ? { status: 'unknown' } : { status: 'idle' };
			throw cause;
		} finally {
			busy.value = false;
		}
	}

	return { state, busy, blocked: computed(() => state.value.status !== 'idle'), exportFull, importFull, reset };
});

registerAuthenticatedSessionReset('backup', () => useBackupStore().reset());
