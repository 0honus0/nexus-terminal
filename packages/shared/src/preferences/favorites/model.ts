export interface FavoritePath {
	id: number;
	version: number;
	name: string | null;
	path: string;
	lastUsedAt: number | null;
	createdAt: number;
	updatedAt: number;
}
