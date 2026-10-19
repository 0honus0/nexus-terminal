import { defineStore } from 'pinia';
import { shallowRef, ref } from 'vue';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { presentationApi } from '../api/presentation-api';
import { snapshotPresentationChange, projectPreferences } from '../model/presentation-mapper';
import type { UserPresentation, PresentationChange, PanelScaleKind } from '../model/preferences-types';

export const usePresentationStore = defineStore('presentation', () => {
	const snapshot = shallowRef<UserPresentation | null>(null);
	const error = shallowRef<unknown>(null);
	const blocked = ref(false);
	let scope = new AbortController();
	let failureRevision = 0;
	let queue: Promise<unknown> = Promise.resolve();
	let pendingRead: Promise<UserPresentation> | null = null;

	function reset(): void {
		scope.abort();
		failureRevision++;
		scope = new AbortController();
		queue = Promise.resolve();
		pendingRead = null;
		snapshot.value = null;
		error.value = null;
		blocked.value = false;
	}

	function enqueue<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const signal = scope.signal;
		const task = queue.then(() => {
			if (signal.aborted) throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			return work(signal);
		});
		queue = task.catch(() => undefined);
		return task;
	}

	function load(recover = false): Promise<UserPresentation> {
		if (!recover && blocked.value)
			return Promise.reject(new PreferenceRequestFailure('refresh_required', 'not_dispatched'));
		if (!recover && snapshot.value) return Promise.resolve(snapshot.value);
		if (!recover && pendingRead) return pendingRead;
		const recoveryRevision = failureRevision;
		const task = enqueue(async (signal) => {
			try {
				const value = await presentationApi.load(signal);
				if (signal.aborted) throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
				snapshot.value = value;
				if (recover && blocked.value && recoveryRevision !== failureRevision)
					throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
				if (recover && recoveryRevision === failureRevision) {
					blocked.value = false;
					error.value = null;
				}
				return value;
			} catch (cause) {
				if (!signal.aborted) error.value = cause;
				throw cause;
			}
		});
		pendingRead = task;
		void task
			.finally(() => {
				if (pendingRead === task) pendingRead = null;
			})
			.catch(() => undefined);
		return task;
	}

	function mutate(resolveChange: () => PresentationChange, permission?: AbortSignal): Promise<UserPresentation> {
		return enqueue(async (signal) => {
			if (permission?.aborted) throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			if (blocked.value) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			try {
				const value = await presentationApi.update(resolveChange(), signal);
				if (signal.aborted) throw new PreferenceRequestFailure('cancelled', 'unknown');
				snapshot.value = value;
				error.value = null;
				return value;
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					if (
						cause instanceof PreferenceRequestFailure &&
						(cause.outcome === 'unknown' || cause.code === 'version_conflict')
					) {
						blocked.value = true;
						failureRevision++;
					}
				}
				throw cause;
			}
		});
	}

	function update(change: PresentationChange, permission?: AbortSignal): Promise<UserPresentation> {
		const frozen = snapshotPresentationChange(change);
		return mutate(() => frozen, permission);
	}

	function savePanelScale(kind: PanelScaleKind, scale: number, permission: AbortSignal): Promise<UserPresentation> {
		return mutate(() => {
			const current = snapshot.value;
			if (!current) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			const preferences = projectPreferences(current.preferences);
			switch (kind) {
				case 'status':
					preferences.statusMonitorScale = scale;
					break;
				case 'files':
					preferences.fileManagerRowSizeMultiplier = scale;
					break;
				case 'quick-commands':
					preferences.quickCommandRowSizeMultiplier = scale;
					break;
			}
			return { action: 'preferences', expectedVersion: current.version, preferences };
		}, permission);
	}

	return { snapshot, error, blocked, load, update, savePanelScale, reset };
});

registerAuthenticatedSessionReset('presentation', () => usePresentationStore().reset());
