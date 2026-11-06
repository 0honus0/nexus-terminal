import { dirname, join } from 'node:path';

interface DataPaths {
	appearance: string;
	artifacts: string;
	toolLogs: string;
	plugins: string;
}

export function resolveDataPaths(databasePath: string): DataPaths {
	const directory = dirname(databasePath);
	return {
		appearance: join(directory, 'appearance'),
		artifacts: join(directory, 'artifacts'),
		toolLogs: join(directory, 'tool-logs'),
		plugins: join(directory, 'plugins'),
	};
}
