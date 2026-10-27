export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'error';

export type EditorLineEnding = 'lf' | 'crlf' | 'cr';

export interface EditorDocument {
	id: string;
	scopeId?: string;
	scopeLabel?: string;
	path: string;
	name: string;
	content: string;
	originalContent: string;
	encoding: string;
	dirty: boolean;
	saveState: EditorSaveState;
	scrollTop: number;
	scrollLeft: number;
	error?: string;
}

export interface LoadedEditorDocument {
	path: string;
	content: string;
	encoding: string;
}

export interface EditorSearchState {
	current: number;
	total: number;
}

export interface EditorSearchController {
	setSearchQuery(query: string): EditorSearchState;
	findNextSearch(query: string): EditorSearchState;
	findPreviousSearch(query: string): EditorSearchState;
	clearSearch(): void;
}
