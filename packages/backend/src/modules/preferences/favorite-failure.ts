import type { FavoriteErrorCode } from '@nexus-terminal/shared/preferences/favorites/values';

export class FavoriteFailure extends Error {
	constructor(
		readonly code: FavoriteErrorCode,
		options?: ErrorOptions,
	) {
		super('Favorite failed: ' + code, options);
		this.name = 'FavoriteFailure';
	}
}
