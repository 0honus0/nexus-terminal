import {
	readPreferencesResponse,
	readLayoutResponse,
	readFocusResponse,
	readSidebarResponse,
	readPresentationUpdateResponse,
	readPresentationError,
	readPreferencesUpdate,
	readLayoutUpdate,
	readFocusUpdate,
	readSidebarUpdate,
	readWorkspaceLayoutUpdate,
} from '@nexus-terminal/shared/preferences/presentation/http-codec';
import {
	PRESENTATION_REQUEST_MAX_BYTES,
	PRESENTATION_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/presentation/values';
import { structurallyEqual } from '@/foundation/data';
import { requestPreference, PreferenceRequestFailure } from '@/client/preferences/preference-request';
import {
	fromPresentation,
	projectPreferences,
	projectLayout,
	projectFocus,
	projectSidebar,
} from '../model/presentation-mapper';
import type { UserPresentation, PresentationChange } from '../model/preferences-types';

const transport = {
	maxRequestBytes: PRESENTATION_REQUEST_MAX_BYTES,
	maxResponseBytes: PRESENTATION_RESPONSE_MAX_BYTES,
	decodeError: readPresentationError,
};

export const presentationApi = {
	async load(signal?: AbortSignal): Promise<UserPresentation> {
		const results = await Promise.allSettled([
			requestPreference({
				...transport,
				method: 'GET',
				path: '/settings/preferences',
				status: 200,
				decode: readPreferencesResponse,
				signal,
			}),
			requestPreference({
				...transport,
				method: 'GET',
				path: '/settings/layout',
				status: 200,
				decode: readLayoutResponse,
				signal,
			}),
			requestPreference({
				...transport,
				method: 'GET',
				path: '/settings/focus-switcher-sequence',
				status: 200,
				decode: readFocusResponse,
				signal,
			}),
			requestPreference({
				...transport,
				method: 'GET',
				path: '/settings/sidebar',
				status: 200,
				decode: readSidebarResponse,
				signal,
			}),
		]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length)
			throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Presentation reads failed');

		function value<T>(result: PromiseSettledResult<T>): T {
			if (result.status === 'rejected') throw result.reason;
			return result.value;
		}

		const preferences = value(results[0]);
		const layout = value(results[1]);
		const focus = value(results[2]);
		const sidebar = value(results[3]);
		if ([layout.version, focus.version, sidebar.version].some((version) => version !== preferences.version))
			throw new PreferenceRequestFailure('version_conflict', 'confirmed');
		return fromPresentation({
			version: preferences.version,
			value: {
				preferences: preferences.preferences,
				layout: layout.layout,
				focus: focus.focus,
				sidebar: sidebar.sidebar,
			},
		});
	},

	async update(change: PresentationChange, signal: AbortSignal): Promise<UserPresentation> {
		const expectedVersion = change.expectedVersion;

		function input(): unknown {
			switch (change.action) {
				case 'preferences':
					return readPreferencesUpdate({
						expectedVersion,
						preferences: projectPreferences(change.preferences),
					});
				case 'layout':
					return readLayoutUpdate({ expectedVersion, layout: projectLayout(change.layout) });
				case 'focus':
					return readFocusUpdate({ expectedVersion, focus: projectFocus(change.focus) });
				case 'sidebar':
					return readSidebarUpdate({ expectedVersion, sidebar: projectSidebar(change.sidebar) });
				case 'workspace':
					return readWorkspaceLayoutUpdate({
						expectedVersion,
						layout: projectLayout(change.layout),
						sidebar: projectSidebar(change.sidebar),
					});
			}
		}

		const endpoint = {
			preferences: 'preferences',
			layout: 'layout',
			focus: 'focus-switcher-sequence',
			sidebar: 'sidebar',
			workspace: 'workspace-layout',
		}[change.action];
		const result = await requestPreference({
			...transport,
			method: 'PUT',
			path: '/settings/' + endpoint,
			status: 200,
			decode: readPresentationUpdateResponse,
			input,
			signal,
		});
		if (result.version !== expectedVersion + 1) throw new PreferenceRequestFailure('protocol_failure', 'unknown');

		function matchesChange(): boolean {
			switch (change.action) {
				case 'workspace':
					return (
						structurallyEqual(result.value.layout, change.layout) &&
						structurallyEqual(result.value.sidebar, change.sidebar)
					);
				case 'preferences':
					return structurallyEqual(result.value.preferences, change.preferences);
				case 'layout':
					return structurallyEqual(result.value.layout, change.layout);
				case 'focus':
					return structurallyEqual(result.value.focus, change.focus);
				case 'sidebar':
					return structurallyEqual(result.value.sidebar, change.sidebar);
			}
		}

		if (!matchesChange()) throw new PreferenceRequestFailure('protocol_failure', 'unknown');
		return fromPresentation(result);
	},
};
