import type { LoadedEditorDocument } from '../model/editor';
export interface FileDocumentPort {
  load(path: string, encoding?: string): Promise<LoadedEditorDocument>;
  save(path: string, content: string, encoding?: string): Promise<void>;
}
