export interface BrowserEndpointDraft {
	url: string;
	priority: number;
	allowPlaintext: boolean;
	verifyTls: boolean;
}

export interface BrowserTargetDraft {
	id: string;
	endpoints: BrowserEndpointDraft[];
	patternsText: string;
}

export interface BrowserConfiguration {
	version: number;
	targets: BrowserTargetDraft[];
}
