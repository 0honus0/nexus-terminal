export interface QuickCommandTag {
  id: number;
  name: string;
}

export interface QuickCommandTagService {
  list(): Promise<QuickCommandTag[]>;
}
