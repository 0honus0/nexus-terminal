import { test, expect } from 'vitest';
import {
	readCommandAssign,
	readCommandAssignResponse,
} from '../../../../packages/shared/src/preferences/commands/http-codec.ts';
import { readTagConnectionsRequest } from '../../../../packages/shared/src/targets/tags/http-codec.ts';

test('association codecs enforce identity and uniqueness without a separate count ceiling', () => {
	const commands = Array.from({ length: 1025 }, (_, index) => ({ id: index + 1, expectedVersion: 1 }));
	expect(readCommandAssign({ commands, tagId: 1 }).commands).toEqual(commands);
	expect(readCommandAssignResponse({ count: commands.length })).toEqual({ count: commands.length });
	expect(() => readCommandAssign({ commands: [...commands, commands[0]], tagId: 1 })).toThrow();
	const ids = Array(10001).fill(1);
	expect(readTagConnectionsRequest({ connectionIds: ids }).connectionIds).toEqual(ids);
	expect(() => readTagConnectionsRequest({ connectionIds: [...ids, 0] })).toThrow();
});
