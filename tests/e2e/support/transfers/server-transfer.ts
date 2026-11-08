import { expect, type APIRequestContext } from '../fixtures';
import { E2E_SSH, trustTestSshHostKey } from '../ssh';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { readTestConnectionImportId } from '../../../support/http/target-import';

export async function target(request: APIRequestContext, port: number): Promise<number> {
	await trustTestSshHostKey(request, port);
	const response = await request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: `Transfer peer ${port}`,
						type: 'SSH',
						host: E2E_SSH.host,
						port,
						username: E2E_SSH.username,
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: E2E_SSH.password },
				},
			],
		},
	});
	expect(response.status()).toBe(200);
	return readTestConnectionImportId(await response.json());
}
