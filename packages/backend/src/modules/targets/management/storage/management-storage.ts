export interface ManagementAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

/** Apply authorization to each actual storage transaction owned by the awaited work. */
export interface ManagementStorage {
	withAuthorization(authorization: ManagementAuthorization, work: () => Promise<void>): Promise<void>;
}
