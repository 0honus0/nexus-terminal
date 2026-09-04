export interface QuickCommandTag {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}
export interface QuickCommand {
  id: number;
  name: string | null;
  command: string;
  usageCount: number;
  variables: Record<string, string>;
  tagIds: number[];
  createdAt: number;
  updatedAt: number;
}
export interface QuickCommandInput {
  name: string | null;
  command: string;
  variables: Record<string, string>;
  tagIds: number[];
}
export interface QuickCommandGroup {
  id: number | null;
  name: string;
  commands: QuickCommand[];
}
export type QuickCommandSort = 'name' | 'usageCount' | 'lastUsed';
export interface ExecuteCommandIntent {
  command: string;
  sourceId?: number;
  allSessions?: boolean;
}
