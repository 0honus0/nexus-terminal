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
import type { FavoritePathSortDto } from '../model/catalog';

const requireFavoritePath = (value: FavoritePathDto | null): FavoritePathDto => {
  if (!value) throw new Error('Favorite path response did not include a favoritePath.');
  return value;
};

export const filesystemCatalogApi = {
  async listFavorites(sort: FavoritePathSortDto): Promise<FavoritePathDto[]> {
    return (await httpClient.get<FavoritePathDto[]>('/favorite-paths', { params: { sortBy: sort } })).data;
  },
  async addFavorite(path: string, name: string | null): Promise<FavoritePathDto> {
    const request: FavoritePathMutationRequestDto = { path, name };
    const response = await httpClient.post<FavoritePathMutationResponseDto>('/favorite-paths', request);
    return requireFavoritePath(response.data.favoritePath);
  },
  async updateFavorite(id: number, path: string, name: string | null): Promise<FavoritePathDto> {
    const request: FavoritePathMutationRequestDto = { path, name };
    const response = await httpClient.put<FavoritePathMutationResponseDto>(`/favorite-paths/${id}`, request);
    return requireFavoritePath(response.data.favoritePath);
  },
  async touchFavorite(id: number): Promise<FavoritePathDto> {
    const response = await httpClient.put<FavoritePathMutationResponseDto>(`/favorite-paths/${id}/update-last-used`);
    return requireFavoritePath(response.data.favoritePath);
  },
  async removeFavorite(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/favorite-paths/${id}`);
  },
  async listHistory(): Promise<PathHistoryEntryDto[]> {
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
