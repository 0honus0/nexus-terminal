export interface TerminalViewport {
	columns: number;
	rows: number;
}

export type TerminalConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TerminalOutput {
	data: string | Uint8Array;
	/** Apply after data has been parsed and before subsequent output. */
	viewport?: TerminalViewport;
	consumed?: () => void;
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
