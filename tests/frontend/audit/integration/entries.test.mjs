import { test, expect } from 'vitest';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { useFilesystemCatalogStore } from '../../../../packages/frontend/src/features/filesystem/composables/useFilesystemCatalog.ts';

test('real audit event filtering, milliseconds and server pagination retain distinct identities', async () => {
	await openAuthenticatedFrontendApplication();
	for (let index = 0; index < 3; index++)
		await useFilesystemCatalogStore().saveFavorite({ name: 'Audit ' + index, path: '/audit-' + index });
	const { auditApi } = await import('../../../../packages/frontend/src/features/audit/public.ts');
	const { OperationsRequestFailure } =
		await import('../../../../packages/frontend/src/client/operations/operations-request.ts');
	const first = await auditApi.list({ event: 'HTTP_MUTATION', limit: 2 });
	if (
		first.items.length !== 2 ||
		first.nextOffset !== 2 ||
		first.items.some((row) => row.event !== 'HTTP_MUTATION' || row.createdAt < 1000000000000)
	)
		throw Error('audit first page');
	const second = await auditApi.list({ event: 'HTTP_MUTATION', limit: 2, offset: first.nextOffset });
	if (second.items.some((row) => first.items.some((previous) => previous.id === row.id)))
		throw Error('audit pagination duplicate');
	try {
		await auditApi.list({ limit: 201 });
		throw Error('invalid audit query accepted');
	} catch (cause) {
		if (
			!(cause instanceof OperationsRequestFailure) ||
			cause.code !== 'invalid_input' ||
			cause.outcome !== 'not_dispatched'
		)
			throw cause;
	}
	expect(second.items.length).toBeGreaterThan(0);
});
