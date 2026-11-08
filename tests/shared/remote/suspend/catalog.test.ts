import { expect, test } from 'vitest';
import {
	readSuspendedSessionCatalog,
	InvalidSuspendedHttpPayload,
} from '@nexus-terminal/shared/remote/suspend/http-codec';
import { SUSPENDED_CATALOG_MAX_JSON_BYTES } from '@nexus-terminal/shared/remote/suspend/values';

const session = (index: number) => ({
	id: 'suspend-' + index,
	originalWorkspaceId: 'workspace-' + index,
	connectionId: 1,
	connectionName: 'SSH',
	suspendedAt: '2026-10-18T00:00:00.000Z',
	status: 'active',
	ownershipState: 'available',
	ownershipGeneration: 1,
});

test('catalog cardinality follows the complete encoded byte budget', () => {
	const rows = Array.from({ length: 128 }, (_, index) => session(index));
	expect(readSuspendedSessionCatalog(rows)).toEqual(rows);
});

test('removing the count ceiling preserves the full envelope budget', () => {
	const rows = Array.from({ length: 6000 }, (_, index) => session(index));
	expect(new TextEncoder().encode(JSON.stringify(rows)).length).toBeGreaterThan(SUSPENDED_CATALOG_MAX_JSON_BYTES);
	expect(() => readSuspendedSessionCatalog(rows)).toThrow(InvalidSuspendedHttpPayload);
});

test('catalog identities and attachment evidence remain strictly correlated', () => {
	expect(() => readSuspendedSessionCatalog([session(0), session(0)])).toThrow(InvalidSuspendedHttpPayload);
	expect(() => readSuspendedSessionCatalog([{ ...session(0), ownershipState: 'attached' }])).toThrow(
		InvalidSuspendedHttpPayload,
	);
	expect(() => readSuspendedSessionCatalog([{ ...session(0), secret: 'private' }])).toThrow(
		InvalidSuspendedHttpPayload,
	);
});
