import {
	readAppearanceUpdate,
	readAppearanceView,
	readAppearanceError,
	readBackgroundUploadFields,
	readBackgroundDelete,
	readBackgroundMutation,
} from '@nexus-terminal/shared/preferences/appearance/http-codec';
import {
	APPEARANCE_REQUEST_MAX_BYTES,
	APPEARANCE_RESPONSE_MAX_BYTES,
	BACKGROUND_MAX_BYTES,
	BACKGROUND_MULTIPART_MAX_BYTES,
	BACKGROUND_MEDIA_TYPES,
	type BackgroundKind,
} from '@nexus-terminal/shared/preferences/appearance/values';
import { structurallyEqual } from '@/foundation/data';
import { requestAppearance, requestAppearanceBytes } from './appearance-request';
import { fromAppearance, toAppearancePatch } from '../model/appearance-mapper';
import { AppearanceRequestFailure } from '../model/appearance-failure';
import type { AppearanceSettings, AppearancePatch, BackgroundChange } from '../model/appearance-types';

const protocol = {
	maxRequestBytes: APPEARANCE_REQUEST_MAX_BYTES,
	maxResponseBytes: APPEARANCE_RESPONSE_MAX_BYTES,
	decodeError: readAppearanceError,
};

function background(value: unknown, kind: BackgroundKind, expectedVersion: number, deleted: boolean): BackgroundChange {
	const result = readBackgroundMutation(value);
	if (
		result.appearance.version !== expectedVersion + 1 ||
		(deleted &&
			(kind === 'page' ? result.appearance.pageBackgroundImage : result.appearance.terminalBackgroundImage) !==
				null)
	) {
		throw new Error('Unrelated background mutation');
	}
	return { appearance: fromAppearance(result.appearance), cleanupPending: result.cleanupPending };
}

export const appearanceApi = {
	async load(signal?: AbortSignal): Promise<AppearanceSettings> {
		return fromAppearance(
			await requestAppearance({
				...protocol,
				method: 'GET',
				path: '/appearance',
				decode: readAppearanceView,
				signal,
			}),
		);
	},

	async update(patch: AppearancePatch, expectedVersion: number, signal?: AbortSignal): Promise<AppearanceSettings> {
		let command;
		try {
			command = readAppearanceUpdate(toAppearancePatch(patch, expectedVersion));
		} catch (cause) {
			throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const value = await requestAppearance({
			...protocol,
			method: 'PUT',
			path: '/appearance',

			input: () => command,

			decode: (raw) => {
				const result = readAppearanceView(raw);
				if (result.version !== command.expectedVersion + 1) {
					throw new Error('Unrelated appearance revision');
				}
				for (const [key, entry] of Object.entries(command)) {
					if (key !== 'expectedVersion' && !structurallyEqual(Reflect.get(result, key), entry)) {
						throw new Error('Unrelated appearance value');
					}
				}
				return fromAppearance(result);
			},

			signal,
		});
		return value;
	},

	async uploadBackground(
		kind: BackgroundKind,
		file: File,
		expectedVersion: number,
		signal?: AbortSignal,
	): Promise<BackgroundChange> {
		let form: FormData;
		try {
			readBackgroundUploadFields({ expectedVersion });
			if (
				!Number.isSafeInteger(file.size) ||
				file.size < 1 ||
				file.size > BACKGROUND_MAX_BYTES ||
				!BACKGROUND_MEDIA_TYPES.some((type) => type === file.type)
			) {
				throw new Error('Invalid image');
			}
			form = new FormData();
			form.append('expectedVersion', String(expectedVersion));
			form.append(kind === 'page' ? 'pageBackgroundFile' : 'terminalBackgroundFile', file);
		} catch (cause) {
			throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const response = await requestAppearanceBytes({
			method: 'POST',
			path: '/appearance/background/' + kind,
			body: form,
			maxRequestBytes: BACKGROUND_MULTIPART_MAX_BYTES,
			maxResponseBytes: APPEARANCE_RESPONSE_MAX_BYTES,
			maxErrorBytes: APPEARANCE_REQUEST_MAX_BYTES,
			decodeError: readAppearanceError,
			signal,
		});
		try {
			if (
				response.status !== 200 ||
				!response.contentType ||
				!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.contentType)
			) {
				throw new Error('Invalid background response');
			}
			return background(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)),
				kind,
				expectedVersion,
				false,
			);
		} catch (cause) {
			throw new AppearanceRequestFailure('protocol_failure', 'unknown', { cause });
		}
	},

	async removeBackground(
		kind: BackgroundKind,
		expectedVersion: number,
		signal?: AbortSignal,
	): Promise<BackgroundChange> {
		return requestAppearance({
			...protocol,
			method: 'DELETE',
			path: '/appearance/background/' + kind,

			input: () => readBackgroundDelete({ expectedVersion }),

			decode: (raw) => background(raw, kind, expectedVersion, true),

			signal,
		});
	},
};
