import { expect, type APIRequestContext } from '@playwright/test';
import {
	readLayoutResponse,
	readSidebarResponse,
	readFocusResponse,
	readPresentationUpdateResponse,
} from '../../../packages/shared/src/preferences/presentation/http-codec';
import type {
	LayoutResponse,
	SidebarResponse,
	FocusResponse,
} from '../../../packages/shared/src/preferences/presentation/http';
import type {
	PresentationLayout,
	PresentationSidebar,
	PresentationFocus,
} from '../../../packages/shared/src/preferences/presentation/model';
import { E2E_URLS } from './test-env';

const headers = { Origin: E2E_URLS.frontendOrigin };

export async function getTestLayout(request: APIRequestContext): Promise<LayoutResponse> {
	const response = await request.get('/api/v1/settings/layout');
	expect(response.status()).toBe(200);
	return readLayoutResponse(await response.json());
}

export async function updateTestLayout(request: APIRequestContext, layout: PresentationLayout): Promise<void> {
	const current = await getTestLayout(request);
	const response = await request.put('/api/v1/settings/layout', {
		headers,
		data: { expectedVersion: current.version, layout },
	});
	expect(response.status()).toBe(200);
	expect(readPresentationUpdateResponse(await response.json()).version).toBe(current.version + 1);
}

export async function getTestSidebar(request: APIRequestContext): Promise<SidebarResponse> {
	const response = await request.get('/api/v1/settings/sidebar');
	expect(response.status()).toBe(200);
	return readSidebarResponse(await response.json());
}

export async function updateTestSidebar(request: APIRequestContext, sidebar: PresentationSidebar): Promise<void> {
	const current = await getTestSidebar(request);
	const response = await request.put('/api/v1/settings/sidebar', {
		headers,
		data: { expectedVersion: current.version, sidebar },
	});
	expect(response.status()).toBe(200);
	expect(readPresentationUpdateResponse(await response.json()).version).toBe(current.version + 1);
}

export async function getTestFocus(request: APIRequestContext): Promise<FocusResponse> {
	const response = await request.get('/api/v1/settings/focus-switcher-sequence');
	expect(response.status()).toBe(200);
	return readFocusResponse(await response.json());
}

export async function updateTestFocus(request: APIRequestContext, focus: PresentationFocus): Promise<void> {
	const current = await getTestFocus(request);
	const response = await request.put('/api/v1/settings/focus-switcher-sequence', {
		headers,
		data: { expectedVersion: current.version, focus },
	});
	expect(response.status()).toBe(200);
	expect(readPresentationUpdateResponse(await response.json()).version).toBe(current.version + 1);
}
