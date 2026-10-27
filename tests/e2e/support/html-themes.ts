import { expect, type APIRequestContext } from '@playwright/test';
import {
	readHtmlThemeList,
	readHtmlThemeDeleted,
	readHtmlThemeRepository,
} from '../../../packages/shared/src/preferences/html-themes/http-codec';
import type {
	HtmlThemeSummary,
	HtmlThemeRepositoryView,
} from '../../../packages/shared/src/preferences/html-themes/model';
import { E2E_URLS } from './test-env';

const path = '/api/v1/appearance/html-presets';
const headers = { Origin: E2E_URLS.frontendOrigin };

export async function listTestHtmlThemes(request: APIRequestContext): Promise<HtmlThemeSummary[]> {
	const response = await request.get(path + '/local');
	expect(response.status()).toBe(200);
	return readHtmlThemeList(await response.json());
}

export async function removeTestHtmlTheme(request: APIRequestContext, theme: HtmlThemeSummary): Promise<void> {
	const response = await request.delete(path + '/local/' + encodeURIComponent(theme.name), {
		headers,
		data: { expectedVersion: theme.version },
	});
	expect(response.status()).toBe(200);
	readHtmlThemeDeleted(await response.json());
}

export async function getTestHtmlRepository(request: APIRequestContext): Promise<HtmlThemeRepositoryView> {
	const response = await request.get(path + '/remote/repository-url');
	expect(response.status()).toBe(200);
	return readHtmlThemeRepository(await response.json());
}

export async function updateTestHtmlRepository(
	request: APIRequestContext,
	url: string | null,
): Promise<HtmlThemeRepositoryView> {
	const original = await getTestHtmlRepository(request);
	const response = await request.put(path + '/remote/repository-url', {
		headers,
		data: { expectedVersion: original.version, url },
	});
	expect(response.status()).toBe(200);
	const result = readHtmlThemeRepository(await response.json());
	expect(result.version).toBe(original.version + 1);
	expect(result.url).toBe(url);
	return result;
}
