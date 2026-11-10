import { dirname, join } from 'node:path';

interface DataPaths {
	appearance: string;
}

export function resolveDataPaths(databasePath: string): DataPaths {
	const directory = dirname(databasePath);
	return {
		appearance: join(directory, 'appearance'),
	};
}
