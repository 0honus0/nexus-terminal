import assert from 'node:assert/strict';
import { readAgentApprovalPage } from '../../../packages/shared/dist/agent/governance/http-codec.js';

export async function listAgentApprovalHistory(api, appId, runId) {
	let after = null;
	const items = [];
	while (true) {
		const path =
			'/api/v1/apps/' +
			appId +
			'/runs/' +
			runId +
			'/approvals' +
			(after === null ? '' : '?after=' + encodeURIComponent(after));
		const response = await api('GET', path);
		assert.equal(response.status, 200);
		const page = readAgentApprovalPage(response.body, after);
		assert.ok(page.items.every((item) => item.appId === appId && item.runId === runId));
		items.push(...page.items);
		if (!page.hasMore) return items;
		after = page.nextCursor;
	}
}
