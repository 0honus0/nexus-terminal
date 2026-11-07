import type {
	BrowserCatalog,
	BrowserSessionRecord,
	BrowserSnapshot,
	BrowserCapture,
	BrowserConsoleRead,
	BrowserPageResult,
} from '../../integrations/model/browser-types.js';

/** Browser domain facts projected to the finite Host SDK operations. */
export type HostBrowserOperationResult =
	| { operation: 'browser.catalog'; value: BrowserCatalog }
	| { operation: 'browser.open'; value: BrowserSessionRecord }
	| { operation: 'browser.close'; value: { status: 'closed' } }
	| { operation: 'browser.snapshot'; value: BrowserSnapshot }
	| { operation: 'browser.screenshot' | 'browser.download'; value: BrowserCapture }
	| { operation: 'browser.console'; value: BrowserConsoleRead }
	| {
			operation:
				| 'browser.navigate'
				| 'browser.back'
				| 'browser.scroll'
				| 'browser.press'
				| 'browser.select'
				| 'browser.wait'
				| 'browser.click'
				| 'browser.type'
				| 'browser.upload';
			value: BrowserPageResult;
	  };

export function cloneHostBrowserOperationResult(result: HostBrowserOperationResult): HostBrowserOperationResult {
	switch (result.operation) {
		case 'browser.catalog':
			return {
				operation: result.operation,
				value: {
					targets: result.value.targets.map((target) => ({
						targetId: target.targetId,
						expectedVersion: target.expectedVersion,
						allowedUrlPatterns: target.allowedUrlPatterns.map((pattern) => pattern),
					})),
				},
			};
		case 'browser.open':
			return {
				operation: result.operation,
				value: {
					sessionId: result.value.sessionId,
					targetId: result.value.targetId,
					targetVersion: result.value.targetVersion,
					runId: result.value.runId,
					createdAt: result.value.createdAt,
				},
			};
		case 'browser.close':
			return { operation: result.operation, value: { status: result.value.status } };
		case 'browser.snapshot':
			return {
				operation: result.operation,
				value: {
					snapshotId: result.value.snapshotId,
					url: result.value.url,
					title: result.value.title,
					nodes: result.value.nodes.map((node) => ({
						ref: node.ref,
						parentRef: node.parentRef,
						tag: node.tag,
						text: node.text,
						attributes: node.attributes.map((attribute) => ({
							name: attribute.name,
							value: attribute.value,
						})),
					})),
					truncated: result.value.truncated,
				},
			};
		case 'browser.screenshot':
		case 'browser.download':
			return {
				operation: result.operation,
				value: {
					artifactId: result.value.artifactId,
					version: result.value.version,
					sha256: result.value.sha256,
					sizeBytes: result.value.sizeBytes,
					mediaType: result.value.mediaType,
				},
			};
		case 'browser.console':
			return {
				operation: result.operation,
				value: {
					entries: result.value.entries.map((entry) => ({
						sequence: entry.sequence,
						type: entry.type,
						text: entry.text,
					})),
					nextCursor: result.value.nextCursor,
					truncated: result.value.truncated,
				},
			};
		case 'browser.navigate':
		case 'browser.back':
		case 'browser.scroll':
		case 'browser.press':
		case 'browser.select':
		case 'browser.wait':
		case 'browser.click':
		case 'browser.type':
		case 'browser.upload':
			return {
				operation: result.operation,
				value: { kind: result.value.kind, url: result.value.url, title: result.value.title },
			};
	}
}
