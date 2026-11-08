import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../support/fixtures';

for (const [name, file, pattern] of [
	[
		'signed package admission, immutable bytes and SDK4 sandbox headers',
		'http/backend-next-plugin-package-security.integration.mjs',
		'',
	],
	[
		'SDK4 original-process lifecycle and explicit recovery',
		'http/backend-next-plugin-runtime-lifecycle.integration.mjs',
		'',
	],
	['RPC authority after kernel-confirmed Blob open', 'http/backend-next-plugin-rpc-races.integration.mjs', ''],
	[
		'repository download cancellation, revocation and shutdown',
		'http/backend-next-plugin-repository-faults.integration.mjs',
		'',
	],
	['UI protocol identity and byte-range decoders', '../frontend/agent-chat-ui-codecs.integration.mjs', ''],
	[
		'trusted tool summaries and multilingual target projections',
		'../frontend/agent-tool-summary.integration.mjs',
		'',
	],
	['subscriber asynchronous authority isolation', 'storage/backend-next-run-changes.integration.mjs', ''],
	[
		'streamed Artifact cancellation, revoked intents and package upgrade fences',
		'http/backend-next-plugin-artifact-streams.integration.mjs',
		'',
	],
	[
		'signed App intent receipts and cross-App Artifact authority',
		'http/backend-next-plugin-intents.integration.mjs',
		'',
	],
	[
		'runtime concurrency, retained history and unknown private-data commits',
		'http/backend-next-plugin-owner-faults.integration.mjs',
		'',
	],
	[
		'independent publisher retirement failures and explicit original-instance recovery',
		'http/backend-next-plugin-retirement-failures.integration.mjs',
		'',
	],
	[
		'lost commit acknowledgements stop the original task family without rewriting evidence',
		'http/backend-next-agent-ledger-faults.integration.mjs',
		'',
	],
	['SSH Job failures and definite host trust refusals', 'http/backend-next-agent-job-failure.integration.mjs', ''],
	[
		'event-driven authority faults wait for actual SSH owner drainage',
		'http/backend-next-agent-monitor-faults.integration.mjs',
		'',
	],
	[
		'Provider model-set capacity, strict codecs and registry persistence',
		'http/backend-next-provider-capacity.integration.mjs',
		'',
	],
	[
		'App-owned runtime, generic Operations, exact tool bindings and settings CAS',
		'http/backend-next-agent-sdk4.integration.mjs',
		'',
	],
	[
		'independent provider and UI replacement with retained protocol resources',
		'http/backend-next-sdk4-updates.integration.mjs',
		'',
	],
	['official MCP and ACP over actual governed transports', 'http/backend-next-agent-protocols.integration.mjs', ''],
	[
		'MCP fixed HTTP connection ownership, byte limits and independent cleanup',
		'storage/backend-next-mcp-lifecycle.integration.mjs',
		'',
	],
	[
		'ACP Host permissions, pending writes and channel drainage',
		'storage/backend-next-acp-lifecycle.integration.mjs',
		'',
	],
	[
		'dynamic service visibility, exact schemas and capability containment',
		'storage/backend-next-service-registry.integration.mjs',
		'',
	],
	[
		'dynamic Registry, multiple instances, schemas, events and stale bindings',
		'storage/backend-next-sdk4-registry.integration.mjs',
		'',
	],
	[
		'real plugin processes beyond former instance and construction ceilings with shared starts and complete drainage',
		'http/backend-next-plugin-runtime-capacity.integration.mjs',
		'',
	],
	[
		'public SDK isolation, typed refusal and resource release',
		'storage/backend-next-sdk4-runtime.integration.mjs',
		'',
	],
	[
		'live managed catalog branches, frozen selection identity and complete discovery pages',
		'storage/backend-next-tool-registry.integration.mjs',
		'',
	],
	[
		'App checkpoints, exact receipts, Root history isolation, family drainage and model reasoning',
		'storage/backend-next-app-phase-ledger.integration.mjs',
		'App phase ledger:',
	],
	[
		'large mailbox pages and unread-message consumption fences',
		'http/backend-next-agent-message-capacity.integration.mjs',
		'',
	],
	[
		'large plugin namespaces, atomic migrations, CAS and tombstone receipts',
		'storage/backend-next-plugin-data-capacity.integration.mjs',
		'',
	],
	[
		'deep and wide browser snapshots, exact field content and stale node rejection',
		'storage/backend-next-browser-capacity.integration.mjs',
		'',
	],
	[
		'Agent capacity contracts, model groups, pending writes and Skill envelopes',
		'storage/backend-next-agent-capacity.integration.mjs',
		'',
	],
	[
		'Agent long paths, paged trees, streaming hashes and large mutations',
		'remote/backend-next-agent-file-capacity.integration.mjs',
		'',
	],
	[
		'isolated module source IPC ownership, deadlines and actual drainage',
		'storage/backend-next-module-runtime.integration.mjs',
		'',
	],
	[
		'late ready artifact evidence and original failure categories',
		'storage/backend-next-artifact-output-evidence.integration.mjs',
		'',
	],
	[
		'archive removal upgrades, rollback, SDK4 preservation and obsolete snapshot rejection',
		'storage/backend-next-agent-archive-removal.integration.mjs',
		'',
	],
	[
		'all-tools migration chain and snapshot registration',
		'storage/backend-next-all-tools-snapshot-registration.integration.mjs',
		'',
	],
	[
		'all-tools mutation whole-batch preflight',
		'http/backend-next-agent-batch-preflight.integration.mjs',
		'Agent mutation batches',
	],
	[
		'result source authority and completed history',
		'storage/backend-next-result-sources.integration.mjs',
		'Result sources:',
	],
	[
		'all-tools required capabilities, output references, identities and legacy retirement',
		'storage/backend-next-all-tools-migrations.integration.mjs',
		'All tools migration:',
	],
	[
		'public frontend SDK terminal ACK ownership and real port subscriptions',
		'../frontend/plugin-frontend-sdk-port.integration.mjs',
		'',
	],
	[
		'meaningful approval summaries and Unicode byte boundaries',
		'storage/backend-next-tool-approval-summary.integration.mjs',
		'Approval summary:',
	],
	[
		'signed UI asset bursts, disconnect cancellation and shutdown',
		'http/backend-next-plugin-asset-concurrency.integration.mjs',
		'Plugin asset concurrency:',
	],
	[
		'independent UI and tool version visibility, exact references and user isolation',
		'storage/backend-next-plugin-version-visibility.integration.mjs',
		'Plugin version visibility:',
	],
	[
		'readonly hidden primitive Child authorization and revocation',
		'storage/backend-next-readonly-tool-participant.integration.mjs',
		'Readonly tool participant:',
	],
	[
		'restored App history, namespaced migration and exact dependency updates',
		'http/backend-next-plugin-composition-lifecycle.integration.mjs',
		'Plugin composition lifecycle:',
	],
	[
		'Node permissions, readonly profiles and stale invocation provenance',
		'http/backend-next-plugin-runtime-security.integration.mjs',
		'',
	],
	[
		'user-scoped package migrations, SDK4 retention and obsolete data removal',
		'storage/backend-next-plugin-package-migrations.integration.mjs',
		'Plugin package migration:',
	],
	[
		'schema rebuild integrity, foreign key rollback and restart version ownership',
		'storage/backend-next-schema-migrations.integration.mjs',
		'Schema migration',
	],
	[
		'context preference migrations, staged provenance and final archive removal',
		'storage/backend-next-context-profile-migration.integration.mjs',
		'',
	],
	[
		'signed schemas, multiplex contracts and shared-package App isolation',
		'http/backend-next-agent-modular.integration.mjs',
		'Agent modular:',
	],
	[
		'historical relation migration, recursive Operation joins and unknown fences',
		'storage/backend-next-tool-children.integration.mjs',
		'Tool children:',
	],
	[
		'state transactions, scoped notifications, SQL retention and upgrade',
		'storage/backend-next-performance.integration.mjs',
		'Performance:',
	],
	['authority monitoring and unknown Job fences', 'storage/backend-next-authority-monitor.integration.mjs', ''],
	[
		'catalog budgets, exact approvals, actual SSH writes and live revocation',
		'http/backend-next-agent-tools.integration.mjs',
		'',
	],
	[
		'configuration queue authorization, durable intent recovery and independent resource drainage',
		'storage/backend-next-integration-races.integration.mjs',
		'',
	],
	[
		'complete logs, disk-space recovery and cancellation',
		'storage/backend-next-tool-output.integration.mjs',
		'Tool output:',
	],
	[
		'lazy tool discovery, both protocols and live authorization',
		'http/backend-next-agent-tool-loading.integration.mjs',
		'Agent tool loading:',
	],
	[
		'MCP typed Host and RPC continuation map contract and malformed request rejection',
		'storage/backend-next-mcp-host-contract.integration.mjs',
		'MCP Host contract:',
	],
	['MCP negotiation, tool catalogs and governed execution', 'http/backend-next-agent-mcp.integration.mjs', 'B10'],
	[
		'ACP execution, inherited entry points and inner permissions',
		'http/backend-next-agent-acp.integration.mjs',
		'B10',
	],
	['Docker targeted batch reads and lifecycle', 'http/backend-next-docker.integration.mjs', 'B10'],
	[
		'Browser per-session isolation and combined observations',
		'http/backend-next-agent-browser.integration.mjs',
		'B10',
	],
	['Browser resource cancellation and cleanup', 'storage/backend-next-browser-lifecycle.integration.mjs', 'Browser'],
	['file batches, UTF-8 paging and cursor integrity', 'http/backend-next-agent-files.integration.mjs', 'B10 Agent'],
	[
		'live Job output, yielding and mutation admission',
		'http/backend-next-agent-shell-yield.integration.mjs',
		'Shell yield',
	],
	[
		'collaboration authorization and event-driven joins',
		'http/backend-next-agent-collaboration.integration.mjs',
		'B10',
	],
	['ordered SQLite migrations, rollback and data preservation', 'storage/backend-next-phase2.integration.mjs', ''],
	[
		'resource expiration, confirmation and exact-session cleanup',
		'http/backend-next-agent-resources.integration.mjs',
		'Resource lifecycle:',
	],
	[
		'model outcomes, streamed prefixes and immutable instructions',
		'http/backend-next-agent-flow.integration.mjs',
		'Agent flow model outcomes',
	],
	[
		'signed plugin hooks, isolated tool RPC and approvals',
		'http/backend-next-agent-flow.integration.mjs',
		'Agent signed contribution',
	],
	[
		'parallel scheduling, exclusive barriers and cancellation drain',
		'http/backend-next-agent-scheduling.integration.mjs',
		'Agent',
	],
	[
		'file delivery streams, source failures and compound authorization',
		'remote/backend-next-file-delivery.integration.mjs',
		'File delivery',
	],
	[
		'Run resource reuse, concurrent isolation and lifecycle cleanup',
		'remote/backend-next-machine-reuse.integration.mjs',
		'Agent reuse:',
	],
] satisfies Array<[string, string, string]>) {
	test('Agent execution: ' + name, async ({}, testInfo) => {
		test.setTimeout(240_000);
		const result = await promisify(execFile)(
			process.execPath,
			[
				'--test',
				'--test-reporter=tap',
				...(pattern ? ['--test-name-pattern=' + pattern] : []),
				path.resolve(__dirname, '../../../backend/' + file),
			],
			{ timeout: 210_000, maxBuffer: 4 * 1024 * 1024 },
		).catch(async (error: unknown) => {
			if (error instanceof Error) {
				const stdout = 'stdout' in error ? error.stdout : null;
				const stderr = 'stderr' in error ? error.stderr : null;
				if (typeof stdout === 'string') {
					await testInfo.attach('backend-test-stdout', { body: stdout, contentType: 'text/plain' });
					console.error(stdout);
				}
				if (typeof stderr === 'string') {
					await testInfo.attach('backend-test-stderr', { body: stderr, contentType: 'text/plain' });
					console.error(stderr);
				}
			}
			throw error;
		});
		if (file.includes('agent-tool-loading')) {
			await testInfo.attach('tool-loading-execution', { body: result.stdout, contentType: 'text/plain' });
		}
		expect(result.stdout).toMatch(/# fail 0(?:\r?\n|$)/);
		expect(result.stdout).toMatch(/# pass [1-9]\d*(?:\r?\n|$)/);
		expect(result.stdout).not.toMatch(/# cancelled [1-9]/);
	});
}
