import { expect, type APIRequestContext } from '@playwright/test';
import {
	readTerminalThemeList,
	readTerminalThemeView,
	readTerminalThemeDeleted,
} from '../../../packages/shared/src/preferences/themes/http-codec';
import type { TerminalThemeView } from '../../../packages/shared/src/preferences/themes/model';
import { E2E_URLS } from './test-env';

export const themeHeaders = { Origin: E2E_URLS.frontendOrigin };

export async function listTestThemes(request: APIRequestContext): Promise<TerminalThemeView[]> {
	const response = await request.get('/api/v1/terminal-themes');
	expect(response.ok()).toBe(true);
	return readTerminalThemeList(await response.json());
}

export async function getTestTheme(request: APIRequestContext, id: number): Promise<TerminalThemeView> {
	const response = await request.get('/api/v1/terminal-themes/' + id);
	expect(response.ok()).toBe(true);
	return readTerminalThemeView(await response.json());
}

export async function removeTestTheme(request: APIRequestContext, theme: TerminalThemeView): Promise<void> {
	const response = await request.delete('/api/v1/terminal-themes/' + theme.id, {
		headers: themeHeaders,
		data: { expectedVersion: theme.version },
	});
	expect(response.ok()).toBe(true);
	readTerminalThemeDeleted(await response.json());
}
