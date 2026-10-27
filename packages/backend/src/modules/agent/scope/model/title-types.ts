export interface TitleScope {
	userId: number;
	appId: string;
	runId: string;
	creationHash: string;
}

export interface TitleClaim {
	threadId: string;
	version: number;
}

export interface TitleCommand extends TitleScope {
	claim: TitleClaim;
	requestHash: string;
	estimatedTokens: number;
}
