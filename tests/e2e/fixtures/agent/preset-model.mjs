/** Signed-plugin scenarios exercise native tools and validate complete model/tool turns. */
export function respondPresetModel(messages, userText, response, send) {
	if (!userText.includes('E2E_NATIVE_PLUGIN_')) {
		return false;
	}
	const connectionId = Number(/connection=(\d+)/.exec(userText)?.[1]);

	const result = (id) => {
		const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
		return message ? JSON.parse(message.content) : null;
	};

	const call = (id, name, input) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(input) } });

	const calls = (items) =>
		send(response, { tool_calls: items.map((item, index) => ({ index, ...item })) }, 'tool_calls');

	const complete = (content) =>
		send(response, { content: typeof content === 'string' ? content : JSON.stringify(content) });

	const sequence = (steps, final) => {
		for (const [id, name, input] of steps) {
			if (!result(id)) {
				calls([call(id, name, typeof input === 'function' ? input() : input)]);
				return;
			}
		}
		complete(final());
	};

	const validateBatch = (ids) => {
		const index = messages.findIndex(
			(item) =>
				item.role === 'assistant' &&
				item.tool_calls?.length === ids.length &&
				ids.every((id, i) => item.tool_calls[i].id === id),
		);
		const positions = ids.map((id) =>
			messages.findIndex((item) => item.role === 'tool' && item.tool_call_id === id),
		);
		if (index < 0 || positions.some((position, i) => position <= (i ? positions[i - 1] : index))) {
			throw new Error('Native plugin tool batch was truncated or reordered');
		}
	};

	const shell = (script) => ({ connectionId, kind: 'shell', script, mode: 'foreground' });

	if (userText.includes('E2E_NATIVE_PLUGIN_SKILL')) {
		const name = userText.includes('operations') ? 'operations' : 'developer';
		sequence(
			[
				['skill_find', 'skill_search', { query: name }],
				[
					'skill_body',
					'skill_read',
					() => {
						const entry = result('skill_find').matches.find((item) => item.name === name);
						if (
							!entry ||
							JSON.stringify(result('skill_find')).includes('Prefer structured diagnostics') ||
							JSON.stringify(result('skill_find')).includes(
								'Use an explicitly selected and authorized SSH connection',
							)
						) {
							throw new Error('Skill metadata must not contain the document body');
						}
						return { name: entry.name, version: entry.version, sha256: entry.sha256 };
					},
				],
			],
			() => ({ marker: 'SKILL_OK', metadata: result('skill_find'), document: result('skill_body') }),
		);
	} else if (userText.includes('E2E_NATIVE_PLUGIN_BATCH')) {
		const ids = ['native_batch_first', 'native_batch_second'];
		if (!result(ids[0]) && !result(ids[1])) {
			calls(
				userText.includes('read=true')
					? [
							call(ids[0], 'machine_connection_list', {}),
							call(ids[1], 'file_read', { connectionId, path: '/seed.txt' }),
						]
					: ids.map((id, index) =>
							call(id, 'collaboration_fact_write', { key: id, value: String(index), expectedVersion: 0 }),
						),
			);
		} else {
			validateBatch(ids);
			complete({ marker: 'BATCH_OK', first: result(ids[0]), second: result(ids[1]) });
		}
	} else if (userText.includes('E2E_NATIVE_PLUGIN_DUPLICATE')) {
		sequence(
			[
				[
					'duplicate_first',
					'shell_execute',
					shell('printf "duplicate-e2e\\n" >> "$NEXUS_E2E_ROOT/duplicate-proof.txt"'),
				],
				[
					'duplicate_second',
					'shell_execute',
					shell('printf "duplicate-e2e\\n" >> "$NEXUS_E2E_ROOT/duplicate-proof.txt"'),
				],
				['duplicate_read', 'file_read', { connectionId, path: '/duplicate-proof.txt' }],
			],
			() => ({
				marker: 'DUPLICATE_OK',
				first: result('duplicate_first'),
				second: result('duplicate_second'),
				file: result('duplicate_read'),
			}),
		);
	} else if (userText.includes('E2E_NATIVE_PLUGIN_READ')) {
		sequence([['plugin_read', 'file_read', { connectionId, path: '/seed.txt' }]], () => result('plugin_read'));
	} else if (userText.includes('E2E_NATIVE_PLUGIN_APPROVAL')) {
		sequence([['plugin_shell', 'shell_execute', shell('printf approval-e2e')]], () => result('plugin_shell'));
	} else if (userText.includes('E2E_NATIVE_PLUGIN_CHILD_BATCH')) {
		const ids = ['child_first', 'child_second'];
		if (!messages.some((item) => item.role === 'tool' && ids.includes(item.tool_call_id))) {
			calls(ids.map((id) => call(id, 'collaboration_fact_read', { key: id })));
		} else {
			validateBatch(ids);
			complete('CHILD_BATCH_OK');
		}
	} else if (userText.includes('E2E_NATIVE_PLUGIN_DELEGATE')) {
		sequence(
			[
				[
					'native_delegate',
					'collaboration_delegate',
					{
						profile: 'worker',
						objective: userText.includes('browser=true')
							? `E2E_BROWSER_LIFECYCLE ${crypto.randomUUID()} version=${Number(/version=(\d+)/.exec(userText)?.[1])} E2E_CHILD_BROWSER_LIFECYCLE`
							: 'E2E_NATIVE_PLUGIN_CHILD_BATCH Validate both tool results in one model turn.',
						dependencyMode: 'success',
					},
				],
				[
					'native_join',
					'collaboration_join',
					() => ({ childIds: [result('native_delegate').id], mode: 'all', waitSeconds: 30 }),
				],
			],
			() => ({ child: result('native_delegate'), joined: result('native_join') }),
		);
	} else if (userText.includes('E2E_NATIVE_PLUGIN_FAIL')) {
		calls([call('missing_tool', 'e2e_missing_tool', {})]);
	} else {
		complete('OK');
	}
	return true;
}
