import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type {
  FavoritePathDto,
  FavoritePathMutationRequestDto,
  FavoritePathMutationResponseDto,
  PathHistoryAddRequestDto,
  PathHistoryAddResponseDto,
  PathHistoryClearResponseDto,
  PathHistoryEntryDto,
} from '@nexus-terminal/protocol/filesystem-catalog';
import { httpClient } from '@/client/http';
import type { FavoritePath, FavoritePathSort, PathHistoryEntry } from '../model/catalog';

const requireFavoritePath = (value: FavoritePathDto | null): FavoritePath => {
  if (!value) throw new Error('Favorite path response did not include a favoritePath.');
  return value;
};

export const filesystemCatalogApi = {
  async listFavorites(sort: FavoritePathSort): Promise<FavoritePath[]> {
    return (await httpClient.get<FavoritePathDto[]>('/favorite-paths', { params: { sortBy: sort } })).data;
  },
  async addFavorite(path: string, name: string | null): Promise<FavoritePath> {
    const request: FavoritePathMutationRequestDto = { path, name };
    const response = await httpClient.post<FavoritePathMutationResponseDto>('/favorite-paths', request);
    return requireFavoritePath(response.data.favoritePath);
  },
  async updateFavorite(id: number, path: string, name: string | null): Promise<FavoritePath> {
    const request: FavoritePathMutationRequestDto = { path, name };
    const response = await httpClient.put<FavoritePathMutationResponseDto>(`/favorite-paths/${id}`, request);
    return requireFavoritePath(response.data.favoritePath);
  },
  async touchFavorite(id: number): Promise<FavoritePath> {
    const response = await httpClient.put<FavoritePathMutationResponseDto>(`/favorite-paths/${id}/update-last-used`);
    return requireFavoritePath(response.data.favoritePath);
  },
  async removeFavorite(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/favorite-paths/${id}`);
  },
  async listHistory(): Promise<PathHistoryEntry[]> {
    return (await httpClient.get<PathHistoryEntryDto[]>('/path-history')).data;
  },
  async addHistory(path: string): Promise<void> {
    const request: PathHistoryAddRequestDto = { path };
    await httpClient.post<PathHistoryAddResponseDto>('/path-history', request);
  },
  async removeHistory(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/path-history/${id}`);
  },
  async clearHistory(): Promise<void> {
    await httpClient.delete<PathHistoryClearResponseDto>('/path-history');
  },
};
