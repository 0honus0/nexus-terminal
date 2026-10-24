import {
	COMMAND_TEXT_MAX_BYTES,
	COMMAND_NAME_MAX_BYTES,
	COMMAND_MAX_TAGS,
	COMMAND_MAX_VARIABLES,
	COMMAND_VARIABLE_MAX_BYTES,
	COMMAND_BATCH_MAX_ENTRIES,
	COMMAND_MAX_ENTRIES,
} from '@nexus-terminal/shared/preferences/commands/values';
import type { CommandTask, CommandInput } from './model/command-types.js';
import { CommandFailure } from '../command-failure.js';

function text(value: string, max: number, nonempty = false): void {
	if (
		value.includes('\0') ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value ||
		(nonempty && !value.trim())
	) {
		throw new CommandFailure('invalid_input');
	}
}

function id(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new CommandFailure('invalid_input');
	}
}

function version(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
		throw new CommandFailure('invalid_input');
	}
}

function input(value: CommandInput): void {
	if (value.name !== null) {
		text(value.name, COMMAND_NAME_MAX_BYTES);
	}
	text(value.command, COMMAND_TEXT_MAX_BYTES, true);
	if (value.tagIds.length > COMMAND_MAX_TAGS || new Set(value.tagIds).size !== value.tagIds.length) {
		throw new CommandFailure('invalid_input');
	}
	value.tagIds.forEach(id);
	if (Object.keys(value.variables).length > COMMAND_MAX_VARIABLES) {
		throw new CommandFailure('invalid_input');
	}
	for (const [key, entry] of Object.entries(value.variables)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new CommandFailure('invalid_input');
		}
		text(entry, COMMAND_VARIABLE_MAX_BYTES);
	}
}

export function validateCommandTask(task: CommandTask): void {
	switch (task.action) {
		case 'create':
			input(task.input);
			break;
		case 'update':
			id(task.id);
			version(task.expectedVersion);
			input(task.input);
			break;
		case 'delete':
		case 'increment':
		case 'delete_tag':
			id(task.id);
			version(task.expectedVersion);
			break;
		case 'create_tag':
			text(task.name, COMMAND_NAME_MAX_BYTES, true);
			break;
		case 'update_tag':
			id(task.id);
			version(task.expectedVersion);
			text(task.name, COMMAND_NAME_MAX_BYTES, true);
			break;
		case 'delete_group':
			id(task.id);
			version(task.expectedVersion);
			if (
				task.commands.length > COMMAND_MAX_ENTRIES ||
				new Set(task.commands.map((row) => row.id)).size !== task.commands.length
			) {
				throw new CommandFailure('invalid_input');
			}
			for (const row of task.commands) {
				id(row.id);
				version(row.expectedVersion);
			}
			break;
		case 'assign_tag':
			id(task.tagId);
			if (
				!task.commands.length ||
				task.commands.length > COMMAND_BATCH_MAX_ENTRIES ||
				new Set(task.commands.map((row) => row.id)).size !== task.commands.length
			) {
				throw new CommandFailure('invalid_input');
			}
			for (const row of task.commands) {
				id(row.id);
				version(row.expectedVersion);
			}
			break;
	}
}

export function prepareCommandTask(task: CommandTask): CommandTask {
	validateCommandTask(task);
	if (task.action === 'create_tag') {
		return { action: 'create_tag', name: task.name.trim() };
	}
	if (task.action === 'update_tag') {
		return { action: 'update_tag', id: task.id, expectedVersion: task.expectedVersion, name: task.name.trim() };
	}
	return task;
}
