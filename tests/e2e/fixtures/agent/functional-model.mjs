/** Controlled model scenarios use current tool arguments, never retired public result envelopes. */
export function respondFunctionalModel(messages, userText, response, send) {
	const connection = /connection=(\d+)/.exec(userText);
	const connectionId = connection ? Number(connection[1]) : null;

	const result = (id) => {
		const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
		return message ? JSON.parse(message.content) : null;
	};

	const call = (id, name, input) =>
		send(
			response,
			{ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] },
			'tool_calls',
		);

	const sequence = (steps, final) => {
		for (const [id, name, input] of steps) {
			if (!result(id)) {
				call(id, name, typeof input === 'function' ? input() : input);
				return;
			}
		}
		send(response, { content: JSON.stringify(typeof final === 'function' ? final() : final) });
	};

	const shell = (script, mode = 'foreground') => ({ connectionId, kind: 'shell', script, mode });

	const file = (path) => ({ connectionId, path });

	if (userText.includes('E2E_BLOCKED_DEPLOY')) {
		if (!result('blocked_shell')) {
			call('blocked_shell', 'shell_execute', shell('printf unauthorized > "$NEXUS_E2E_ROOT/blocked-deploy.txt"'));
		} else {
			send(response, {
				content: 'No service was deployed. Mutation denied; partial result is not success evidence.',
			});
		}
		return true;
	}
	const repair = userText.includes('E2E_GATEWAY_502')
		? {
				root: '/gateway-502',
				path: '/gateway-502/config.json',
				oldText: './upstream-wrong.sock',
				newText: './upstream.sock',
				before: 'npm test',
				after: 'npm test',
			}
		: userText.includes('E2E_API_500_REPAIR')
			? {
					root: '/api-500',
					path: '/api-500/server.mjs',
					oldText: 'catalog.products.map',
					newText: 'catalog.items.map',
					before: 'npm test',
					after: 'npm test',
				}
			: userText.includes('E2E_BUILD_REPAIR')
				? {
						root: '/build-repair',
						path: '/build-repair/src/catalog.mjs',
						oldText: 'totalPrices',
						newText: 'totalPrice',
						before: 'npm run build',
						after: 'npm run build && npm test',
					}
				: null;
	if (repair) {
		sequence(
			[
				['repair_read', 'file_read', file(repair.path)],
				['repair_before', 'shell_execute', shell(`cd "$NEXUS_E2E_ROOT${repair.root}" && ${repair.before}`)],
				[
					'repair_patch',
					'file_patch',
					() => ({
						...file(repair.path),
						expectedSha256: result('repair_read').sha256,
						oldText: repair.oldText,
						newText: repair.newText,
					}),
				],
				['repair_after', 'shell_execute', shell(`cd "$NEXUS_E2E_ROOT${repair.root}" && ${repair.after}`)],
			],
			() => ({ before: result('repair_before'), patch: result('repair_patch'), after: result('repair_after') }),
		);
		return true;
	}
	if (userText.includes('E2E_FILE_LIFECYCLE')) {
		sequence(
			[
				[
					'file_create',
					'file_write',
					{ ...file('/file-lifecycle/original.txt'), content: 'alpha\nkeep\n', expectedSha256: 'absent' },
				],
				['file_read_original', 'file_read', file('/file-lifecycle/original.txt')],
				[
					'file_patch',
					'file_patch',
					() => ({
						...file('/file-lifecycle/original.txt'),
						expectedSha256: result('file_read_original').sha256,
						oldText: 'alpha',
						newText: 'ALPHA',
					}),
				],
				['file_patched', 'file_read', file('/file-lifecycle/original.txt')],
				['file_inspect_original', 'file_inspect', file('/file-lifecycle/original.txt')],
				[
					'file_move',
					'file_move',
					() => ({
						...file('/file-lifecycle/original.txt'),
						destinationPath: '/file-lifecycle/moved.txt',
						expectedFingerprint: result('file_inspect_original').fingerprint,
					}),
				],
				['file_moved', 'file_read', file('/file-lifecycle/moved.txt')],
				['file_inspect_moved', 'file_inspect', file('/file-lifecycle/moved.txt')],
				[
					'file_delete',
					'file_delete',
					() => ({
						...file('/file-lifecycle/moved.txt'),
						expectedFingerprint: result('file_inspect_moved').fingerprint,
						scope: 'entry',
					}),
				],
				['file_remaining', 'file_list', file('/file-lifecycle')],
				['file_preserved', 'file_read', file('/file-lifecycle/preserved.json')],
			],
			() => ({
				patched: result('file_patched'),
				moved: result('file_moved'),
				remaining: result('file_remaining'),
				preserved: result('file_preserved'),
			}),
		);
		return true;
	}
	if (userText.includes('E2E_FILE_PATCH_REJECT')) {
		sequence(
			[
				['reject_read', 'file_read', file('/file-lifecycle/preserved.json')],
				[
					'reject_patch',
					'file_patch',
					() => ({
						...file('/file-lifecycle/preserved.json'),
						expectedSha256: result('reject_read').sha256,
						oldText: 'wrong context',
						newText: 'must-not-write',
					}),
				],
			],
			{ unexpected: 'A context mismatch must not succeed.' },
		);
		return true;
	}
	if (userText.includes('E2E_SEARCH_SCAN')) {
		sequence(
			[['search_scan', 'file_search', { ...file('/search-scan'), query: 'SCAN_SENTINEL', maxResults: 10 }]],
			() => result('search_scan'),
		);
		return true;
	}
	if (userText.includes('E2E_TASK_A01_READONLY')) {
		const files = ['AGENTS.md', 'README.md', 'package.json', 'config.json', 'server.mjs', 'data/catalog.json'];
		sequence(
			files.map((name, index) => ['handover_' + index, 'file_read', file('/task-a01/' + name)]),
			() => {
				const reads = files.map((_, index) => result('handover_' + index));
				const config = JSON.parse(reads[3].text),
					pkg = JSON.parse(reads[2].text);
				return {
					start: pkg.scripts.start,
					configKey: reads[4].text.includes('config.catalogPath') ? 'catalogPath' : null,
					configuredKey: Object.keys(config)[0],
					requiredEnvironment: 'PORT',
					interfaces: ['/health', '/catalog'],
					serviceStarted: false,
					files: files.map((name, index) => ({ path: '/task-a01/' + name, sha256: reads[index].sha256 })),
				};
			},
		);
		return true;
	}
	const deployment = /E2E_DEPLOY_API connection=\d+ port=(\d+)/.exec(userText);
	if (deployment) {
		const withSkill = userText.includes('E2E_OPERATIONS_SKILL');
		sequence(
			[
				...(withSkill
					? [
							['operations_search', 'skill_search', { query: 'operations', limit: 1 }],
							[
								'operations_read',
								'skill_read',
								() => {
									const match = result('operations_search').matches[0];
									return { name: match.name, version: match.version, sha256: match.sha256 };
								},
							],
						]
					: []),
				[
					'deploy_launch',
					'shell_execute',
					shell(
						`cd "$NEXUS_E2E_ROOT/deploy-api" && exec env PORT=${deployment[1]} node server.mjs`,
						'background',
					),
				],
				[
					'deploy_check',
					'shell_execute',
					shell(
						`node --input-type=module -e 'const end=Date.now()+5000;for(;;){try{for(const path of ["health","catalog"]){const r=await fetch("http://127.0.0.1:${deployment[1]}/"+path);if(!r.ok)throw Error("HTTP_"+r.status);console.log(path+"="+await r.text())}break}catch(e){if(Date.now()>=end)throw e;await new Promise(r=>setTimeout(r,50))}}'`,
					),
				],
				[
					'deploy_status',
					'shell_job_control',
					() => ({ connectionId, action: 'status', jobId: result('deploy_launch').jobId }),
				],
				[
					'deploy_stop',
					'shell_execute',
					shell(
						`node --input-type=module -e 'const r=await fetch("http://127.0.0.1:${deployment[1]}/shutdown",{method:"POST"});if(!r.ok||!(await r.json()).stopping)process.exit(1)'`,
					),
				],
				[
					'deploy_wait',
					'shell_job_control',
					() => ({ connectionId, action: 'wait', jobId: result('deploy_launch').jobId, waitSeconds: 10 }),
				],
			],
			() => ({
				launch: result('deploy_launch'),
				health: result('deploy_check'),
				status: result('deploy_status'),
				stop: result('deploy_stop'),
				settled: result('deploy_wait'),
				...(withSkill ? { skill: result('operations_read') } : {}),
			}),
		);
		return true;
	}

	const browser = /E2E_BROWSER_DEPLOY version=(\d+) url=([^\s"\\]+)/.exec(userText);
	if (browser) {
		const session = () => result('browser_open').sessionId;

		const click = (id) => {
			const snapshot = result(id);
			// CDP DOM.getDocument retains uppercase nodeName on elements and
			// places visible button labels in child #text nodes, not BUTTON.nodeValue.
			const button = snapshot.nodes.find(
				(node) =>
					node.tag === 'BUTTON' &&
					snapshot.nodes.some(
						(child) => child.parentRef === node.ref && child.text.includes('Deploy fixture-v1'),
					),
			);
			if (!button) {
				throw new Error('Deployment button missing from actual snapshot');
			}
			return { sessionId: session(), snapshotId: snapshot.snapshotId, nodeRef: button.ref };
		};

		const stale = userText.includes('stale=true');
		sequence(
			[
				['browser_open', 'browser_open', { targetId: 'e2e-deployment', expectedVersion: Number(browser[1]) }],
				['browser_navigate', 'browser_navigate', () => ({ sessionId: session(), url: browser[2] })],
				['browser_old', 'browser_snapshot', () => ({ sessionId: session() })],
				...(stale ? [['browser_fresh', 'browser_snapshot', () => ({ sessionId: session() })]] : []),
				['browser_click', 'browser_click', () => click('browser_old')],
				['browser_after', 'browser_snapshot', () => ({ sessionId: session() })],
				['browser_capture', 'browser_screenshot', () => ({ sessionId: session() })],
				['browser_close', 'browser_close', () => ({ sessionId: session() })],
			],
			() => ({
				page: result('browser_after'),
				capture: result('browser_capture'),
				closed: result('browser_close'),
			}),
		);
		return true;
	}
	return false;
}
