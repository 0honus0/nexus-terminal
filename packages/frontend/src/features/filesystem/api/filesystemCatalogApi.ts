import { httpClient } from '@/client/http';
import type { FavoritePath, FavoritePathSort, PathHistoryEntry } from '../model/catalog';

export const filesystemCatalogApi = {
  async listFavorites(sort: FavoritePathSort): Promise<FavoritePath[]> {
    return (await httpClient.get<FavoritePath[]>('/favorite-paths', { params: { sortBy: sort } })).data;
  },
  async addFavorite(path: string, name: string | null): Promise<FavoritePath> {
    return (await httpClient.post<{ favoritePath: FavoritePath }>('/favorite-paths', { path, name })).data.favoritePath;
  },
  async updateFavorite(id: number, path: string, name: string | null): Promise<FavoritePath> {
    return (await httpClient.put<{ favoritePath: FavoritePath }>(`/favorite-paths/${id}`, { path, name })).data
      .favoritePath;
  },
  async touchFavorite(id: number): Promise<FavoritePath> {
    return (await httpClient.put<{ favoritePath: FavoritePath }>(`/favorite-paths/${id}/update-last-used`)).data
      .favoritePath;
  },
  async removeFavorite(id: number): Promise<void> {
    await httpClient.delete(`/favorite-paths/${id}`);
  },
  async listHistory(): Promise<PathHistoryEntry[]> {
    return (await httpClient.get<PathHistoryEntry[]>('/path-history')).data;
  },
  async addHistory(path: string): Promise<void> {
    await httpClient.post('/path-history', { path });
  },
  async removeHistory(id: number): Promise<void> {
    await httpClient.delete(`/path-history/${id}`);
  },
  async clearHistory(): Promise<void> {
    await httpClient.delete('/path-history');
  },
};
