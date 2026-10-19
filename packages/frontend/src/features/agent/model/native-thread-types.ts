export interface NativeThread {
	id: string;
	appId: string;
	title: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface NativeThreadScope {
	appId: string;
	appVersion: number;
}

export type NativeThreadIntent =
	| { kind: 'create'; scope: NativeThreadScope; operationId: string; title: string }
	| { kind: 'rename'; scope: NativeThreadScope; operationId: string; thread: NativeThread; title: string };

export interface NativeThreadPage {
	items: NativeThread[];
	nextCursor: string | null;
}
