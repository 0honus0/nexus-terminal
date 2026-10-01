import type { ToolContext } from '../capabilities/tool.types';
import type { ProjectInstructionSnapshot } from './project-instruction-source.port';

export interface ProjectDirectoryBinding {
  connectionId: number;
  directory: string;
  configurationHash: string;
}

export interface ProjectDirectoryPort {
  read(context: ToolContext, connectionId: number): Promise<ProjectDirectoryBinding | null>;
  bind(context: ToolContext, binding: ProjectDirectoryBinding): Promise<void>;
  clear(context: ToolContext, connectionId: number): Promise<void>;
  instructions(context: ToolContext, targetDirectories: readonly string[]): Promise<ProjectInstructionSnapshot[]>;
}
