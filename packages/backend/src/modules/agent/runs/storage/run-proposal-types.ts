/** Durable proposal contract shared by the step and context journals. */
export interface StoredStepProposal {
	providerCallId: string;
	toolName: string;
	argumentsJson: string;
}
