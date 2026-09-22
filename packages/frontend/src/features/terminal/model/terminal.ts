import type { WorkspaceTerminalViewportDto } from '@nexus-terminal/protocol/workspace';
export type { WorkspaceTerminalViewportDto };

export type TerminalConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface TerminalOutput {
  data: string | Uint8Array;
}
export interface TerminalSnapshot {
  text: string;
}

export interface TerminalVisualOptions {
  backgroundEnabled?: boolean;
  backgroundImageUrl?: string;
  backgroundOverlayOpacity?: number;
  customHtml?: string | null;
  textStroke?: { enabled: boolean; width: number; color: string };
  textShadow?: { enabled: boolean; offsetX: number; offsetY: number; blur: number; color: string };
}
