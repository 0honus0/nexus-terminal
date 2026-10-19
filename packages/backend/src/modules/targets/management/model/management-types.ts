/** Original server-authenticated actor; never serialized or logged. */
export interface ManagementActor {
	userId: number;
	token: string;
}

export interface ManagementIdentity {
	userId: number | null;
}
