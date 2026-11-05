import { defineStore } from 'pinia';
import { shallowRef, ref } from 'vue';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { structurallyEqual } from '@/foundation/data';
import { presentationApi } from '../api/presentation-api';
import {
	snapshotPresentationChange,
	projectPreferences,
	projectLayout,
	projectWorkspaceLayout,
} from '../model/presentation-mapper';
import { mergeLayoutSizes } from '../model/layout-size-merge';
import type {
	UserPresentation,
	PresentationChange,
	PanelScaleKind,
	PersonalLayout,
	PersonalWorkspaceLayout,
	WorkspacePreferenceKey,
} from '../model/preferences-types';

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

	function mutate(
		work: (signal: AbortSignal) => Promise<UserPresentation>,
		permission?: AbortSignal,
	): Promise<UserPresentation> {
		return enqueue(async (signal) => {
			if (permission?.aborted) throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			if (blocked.value) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			try {
				const value = await work(signal);
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
		return mutate((signal) => presentationApi.update(frozen, signal), permission);
	}

	function savePanelScale(kind: PanelScaleKind, scale: number, permission: AbortSignal): Promise<UserPresentation> {
		return mutate((signal) => {
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
			return presentationApi.update(
				{ action: 'preferences', expectedVersion: current.version, preferences },
				signal,
			);
		}, permission);
	}

	function mutateLayout(
		work: (value: UserPresentation, signal: AbortSignal) => Promise<UserPresentation>,
		permission?: AbortSignal,
	): Promise<UserPresentation> {
		return mutate(async (signal) => {
			const current = snapshot.value;
			if (!current) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');

			function save(value: UserPresentation): Promise<UserPresentation> {
				if (signal.aborted || permission?.aborted) {
					throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
				}
				return work(value, signal);
			}

			try {
				return await save(current);
			} catch (cause) {
				if (
					!(cause instanceof PreferenceRequestFailure) ||
					cause.code !== 'version_conflict' ||
					cause.outcome !== 'confirmed'
				) {
					throw cause;
				}
				if (signal.aborted || permission?.aborted) {
					throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
				}
				// This write was explicitly rejected. Re-read inside this task, never enqueue behind ourselves.
				let latest: UserPresentation;
				try {
					latest = await presentationApi.load(signal);
				} catch (readCause) {
					// A failed recovery read does not turn the rejected write into an unknown commit.
					throw new PreferenceRequestFailure('version_conflict', 'confirmed', {
						cause: new AggregateError([cause, readCause], 'Layout conflict recovery read failed'),
					});
				}
				return save(latest);
			}
		}, permission);
	}

	function saveLayoutSizes(
		layout: PersonalLayout,
		baseline: PersonalLayout,
		permission?: AbortSignal,
	): Promise<UserPresentation> {
		const frozen = projectLayout(layout);
		const original = projectLayout(baseline);
		return mutateLayout((value, signal) => {
			const merged = mergeLayoutSizes(original, frozen, value.layout);
			if (!merged) throw new PreferenceRequestFailure('version_conflict', 'not_dispatched');
			if (structurallyEqual(merged, value.layout)) return Promise.resolve(value);
			return presentationApi.update({ action: 'layout', expectedVersion: value.version, layout: merged }, signal);
		}, permission);
	}

	function saveWorkspaceLayout(
		layout: PersonalWorkspaceLayout,
		baseline: PersonalWorkspaceLayout,
		permission?: AbortSignal,
	): Promise<UserPresentation> {
		const frozen = projectWorkspaceLayout(layout);
		const original = projectWorkspaceLayout(baseline);
		return mutateLayout((value, signal) => {
			const current = projectWorkspaceLayout(value);
			if (structurallyEqual(frozen, original) || structurallyEqual(frozen, current)) {
				return Promise.resolve(value);
			}
			// Layout and sidebars are one configuration: merging them independently can duplicate panes.
			if (!structurallyEqual(original, current)) {
				throw new PreferenceRequestFailure('version_conflict', 'not_dispatched');
			}
			return presentationApi.update(
				{ action: 'workspace', expectedVersion: value.version, layout: frozen.layout, sidebar: frozen.sidebar },
				signal,
			);
		}, permission);
	}

	function saveWorkspacePreference(
		key: WorkspacePreferenceKey,
		value: boolean,
		permission: AbortSignal,
	): Promise<UserPresentation> {
		return mutate((signal) => {
			const current = snapshot.value;
			if (!current) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			const preferences = projectPreferences(current.preferences);
			preferences[key] = value;
			return presentationApi.update(
				{ action: 'preferences', expectedVersion: current.version, preferences },
				signal,
			);
		}, permission);
	}

	return {
		snapshot,
		error,
		blocked,
		load,
		update,
		savePanelScale,
		saveLayoutSizes,
		saveWorkspaceLayout,
		saveWorkspacePreference,
		reset,
	};
});

registerAuthenticatedSessionReset('presentation', () => usePresentationStore().reset());
