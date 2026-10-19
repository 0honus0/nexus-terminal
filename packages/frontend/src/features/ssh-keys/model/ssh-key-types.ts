import type { ComputedRef } from 'vue';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';

export interface SshKeySummary {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface SshKeyDraft {
	name: string;
	privateKey: string;
	passphrase: string;
	clearPassphrase: boolean;
}

export interface SshKeysController {
	keys: ComputedRef<SshKeySummary[]>;
	loaded: ComputedRef<boolean>;
	busy: ComputedRef<boolean>;
	needsRefresh: ComputedRef<boolean>;
	load(force?: boolean): Promise<SshKeySummary[]>;
	create(input: TargetSshKeyInput, signal?: AbortSignal): Promise<SshKeySummary>;
	update(snapshot: SshKeySummary, input: TargetSshKeyChanges, signal?: AbortSignal): Promise<SshKeySummary>;
	remove(id: number, signal?: AbortSignal): Promise<void>;
}
