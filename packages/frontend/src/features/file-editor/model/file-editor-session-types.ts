import type { ComputedRef, Ref } from 'vue';
import type { FileDocumentPort } from '../ports/file-document-port';
import type { EditorDocument, EditorLineEnding } from './editor';

export interface FileEditorOpenContext {
	scopeId?: string;
	scopeLabel?: string;
	port: FileDocumentPort;
}

export interface FileEditorCloseActions {
	close(id: string): Promise<boolean>;
	closeOthers(id: string): Promise<boolean>;
	closeToRight(id: string): Promise<boolean>;
	closeToLeft(id: string): Promise<boolean>;
	closeAll(): Promise<boolean>;
}

export interface FileEditorCloseRegistration extends FileEditorCloseActions {
	dispose(): void;
}

export interface FileEditorSessionController extends FileEditorCloseActions {
	tabs: Ref<EditorDocument[]>;
	activeId: Ref<string | null>;
	active: ComputedRef<EditorDocument | null>;
	loading: Ref<boolean>;
	open(path: string, context?: FileEditorOpenContext): Promise<EditorDocument>;
	update(content: string): void;
	save(doc?: EditorDocument | null): Promise<void>;
	reload(id: string): Promise<void>;
	changeEncoding(id: string, encoding: string): Promise<void>;
	changeLineEnding(id: string, lineEnding: EditorLineEnding): void;
	updateScrollPosition(id: string, scrollTop: number, scrollLeft: number): void;
	setCloseConfirmation(confirm: () => Promise<boolean>): FileEditorCloseRegistration;
	closeScope(scopeId: string): void;
	reset(): void;
	invalidatePaths(scopeId: string, paths: readonly string[]): boolean;
	activateRelative(delta: number): void;
}
