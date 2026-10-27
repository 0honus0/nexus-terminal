import type { RemoteTool, ToolPackageManager, ToolPrivilege } from './values.js';

export interface RemoteToolCheck {
	targetId: number;
	tools: RemoteTool[];
	missing: RemoteTool[];
	manager: ToolPackageManager | null;
	privilege: ToolPrivilege;
	planId: string | null;
	expiresAt: number | null;
}
