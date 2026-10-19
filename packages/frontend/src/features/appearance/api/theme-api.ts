import {
	readTerminalThemeCreate,
	readTerminalThemeUpdate,
	readTerminalThemeDelete,
	readTerminalThemeId,
	readTerminalThemeView,
	readTerminalThemeList,
	readTerminalThemeError,
	readTerminalThemeDeleted,
	readTerminalThemeColors,
} from '@nexus-terminal/shared/preferences/themes/http-codec';
import {
	TERMINAL_THEME_REQUEST_MAX_BYTES,
	TERMINAL_THEME_RESPONSE_MAX_BYTES,
	TERMINAL_THEME_IMPORT_MAX_BYTES,
	TERMINAL_THEME_MULTIPART_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/themes/values';
import { structurallyEqual } from '@/foundation/data';
import { requestAppearance, requestAppearanceBytes } from './appearance-request';
import { fromTheme, projectThemeColors } from '../model/appearance-mapper';
import { AppearanceRequestFailure } from '../model/appearance-failure';
import type { TerminalTheme, ThemeColors } from '../model/appearance-types';

const protocol = {
	maxRequestBytes: TERMINAL_THEME_REQUEST_MAX_BYTES,
	maxResponseBytes: TERMINAL_THEME_RESPONSE_MAX_BYTES,
	decodeError: readTerminalThemeError,
};

function validate<T>(read: () => T): T {
	try {
		return read();
	} catch (cause) {
		throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
}

function checked(raw: unknown, name: string, colors: ThemeColors, original?: TerminalTheme): TerminalTheme {
	const result = readTerminalThemeView(raw);
	if (
		result.preset ||
		result.name !== name ||
		!structurallyEqual(result.themeData, colors) ||
		(original &&
			(result.id !== original.id ||
				result.version !== original.version + 1 ||
				result.createdAt !== original.createdAt))
	) {
		throw new Error('Unrelated terminal theme');
	}
	return fromTheme(result);
}

export const themeApi = {
	async list(signal?: AbortSignal): Promise<TerminalTheme[]> {
		return (
			await requestAppearance({
				...protocol,
				method: 'GET',
				path: '/terminal-themes',
				decode: readTerminalThemeList,
				signal,
			})
		).map(fromTheme);
	},

	async create(name: string, colors: ThemeColors, signal?: AbortSignal): Promise<TerminalTheme> {
		const command = validate(() => readTerminalThemeCreate({ name, themeData: projectThemeColors(colors) }));
		return requestAppearance({
			...protocol,
			method: 'POST',
			path: '/terminal-themes',
			status: 201,

			input: () => command,

			decode: (raw) => checked(raw, command.name, command.themeData),

			signal,
		});
	},

	async update(
		original: TerminalTheme,
		name: string,
		colors: ThemeColors,
		signal?: AbortSignal,
	): Promise<TerminalTheme> {
		const id = validate(() => readTerminalThemeId(String(original.id)));
		const command = validate(() =>
			readTerminalThemeUpdate({ name, themeData: projectThemeColors(colors), expectedVersion: original.version }),
		);
		return requestAppearance({
			...protocol,
			method: 'PUT',
			path: '/terminal-themes/' + id,

			input: () => command,

			decode: (raw) => checked(raw, command.name, command.themeData, original),

			signal,
		});
	},

	async remove(original: TerminalTheme, signal?: AbortSignal): Promise<void> {
		const id = validate(() => readTerminalThemeId(String(original.id)));
		await requestAppearance({
			...protocol,
			method: 'DELETE',
			path: '/terminal-themes/' + id,

			input: () => readTerminalThemeDelete({ expectedVersion: original.version }),

			decode: readTerminalThemeDeleted,
			signal,
		});
	},

	async importFile(file: File, signal?: AbortSignal): Promise<TerminalTheme> {
		if (signal?.aborted) {
			throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
		}
		if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > TERMINAL_THEME_IMPORT_MAX_BYTES) {
			throw new AppearanceRequestFailure('invalid_input', 'not_dispatched');
		}
		let command;
		try {
			const bytes = await file.arrayBuffer();
			command = readTerminalThemeCreate({
				name: file.name.replace(/\.json$/iu, ''),
				themeData: readTerminalThemeColors(
					JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)),
				),
			});
		} catch (cause) {
			throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		if (signal?.aborted) {
			throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
		}
		const form = new FormData();
		form.append(
			'themeFile',
			new Blob([JSON.stringify(command.themeData)], { type: 'application/json' }),
			'theme.json',
		);
		form.append('name', command.name);
		const response = await requestAppearanceBytes({
			method: 'POST',
			path: '/terminal-themes/import',
			body: form,
			maxRequestBytes: TERMINAL_THEME_MULTIPART_MAX_BYTES,
			maxResponseBytes: TERMINAL_THEME_RESPONSE_MAX_BYTES,
			maxErrorBytes: TERMINAL_THEME_REQUEST_MAX_BYTES,
			decodeError: readTerminalThemeError,
			signal,
		});
		try {
			if (
				response.status !== 201 ||
				!response.contentType ||
				!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.contentType)
			) {
				throw new Error('Invalid import response');
			}
			return checked(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)),
				command.name,
				command.themeData,
			);
		} catch (cause) {
			throw new AppearanceRequestFailure('protocol_failure', 'unknown', { cause });
		}
	},

	async exportFile(theme: TerminalTheme, signal?: AbortSignal): Promise<void> {
		const id = validate(() => readTerminalThemeId(String(theme.id)));
		const colors = await requestAppearance({
			...protocol,
			method: 'GET',
			path: '/terminal-themes/' + id + '/export',
			decode: readTerminalThemeColors,
			signal,
		});
		if (signal?.aborted) {
			throw new AppearanceRequestFailure('cancelled', 'confirmed');
		}
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(projectThemeColors(colors), null, 2)], { type: 'application/json' }),
		);
		const anchor = document.createElement('a');
		try {
			anchor.href = url;
			anchor.download = 'terminal-theme.json';
			anchor.rel = 'noopener';
			document.body.append(anchor);
			anchor.click();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		} finally {
			anchor.remove();
			URL.revokeObjectURL(url);
		}
	},
};
