import { expect, type APIRequestContext } from '@playwright/test';
import {
	readCommandList,
	readCommandDelete,
	readCommandTagList,
} from '../../../packages/shared/src/preferences/commands/http-codec';
import type { QuickCommand, QuickCommandTag } from '../../../packages/shared/src/preferences/commands/model';
import { E2E_URLS } from './test-env';

export async function listTestCommands(request: APIRequestContext): Promise<QuickCommand[]> {
	const entries: QuickCommand[] = [];
	let offset = 0;
	for (;;) {
		const query = { limit: 50, offset, sortBy: 'name' } as const;
		const response = await request.get('/api/v1/quick-commands', { params: query });
		expect(response.status()).toBe(200);
		const page = readCommandList(await response.json(), query);
		entries.push(...page.entries);
		if (page.nextOffset === null) {
			return entries;
		}
		expect(page.nextOffset).toBeGreaterThan(offset);
		offset = page.nextOffset;
	}
}

export async function removeTestCommand(request: APIRequestContext, command: QuickCommand): Promise<void> {
	const response = await request.delete('/api/v1/quick-commands/' + command.id, {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { expectedVersion: command.version },
	});
	expect(response.status()).toBe(200);
	readCommandDelete(await response.json());
}

export async function listTestCommandTags(request: APIRequestContext): Promise<QuickCommandTag[]> {
	const entries: QuickCommandTag[] = [];
	let offset = 0;
	for (;;) {
		const query = { limit: 50, offset, sortBy: 'name' } as const;
		const response = await request.get('/api/v1/quick-command-tags', { params: query });
		expect(response.status()).toBe(200);
		const page = readCommandTagList(await response.json(), query);
		entries.push(...page.entries);
		if (page.nextOffset === null) {
			return entries;
		}
		expect(page.nextOffset).toBeGreaterThan(offset);
		offset = page.nextOffset;
	}
}

export async function removeTestCommandTag(request: APIRequestContext, tag: QuickCommandTag): Promise<void> {
	const response = await request.delete('/api/v1/quick-command-tags/' + tag.id, {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { expectedVersion: tag.version },
	});
	expect(response.status()).toBe(200);
	readCommandDelete(await response.json());
}

/** Cleanup also runs after a successful UI deletion, so an absent record is expected. */
export async function cleanupTestCommand(request: APIRequestContext, id: number): Promise<void> {
	const command = (await listTestCommands(request)).find((item) => item.id === id);
	if (command) {
		await removeTestCommand(request, command);
	}
}

export async function cleanupTestCommandTag(request: APIRequestContext, id: number): Promise<void> {
	const tag = (await listTestCommandTags(request)).find((item) => item.id === id);
	if (tag) {
		await removeTestCommandTag(request, tag);
	}
}
