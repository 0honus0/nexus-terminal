import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Converts the original ACP relation; all descendants keep the original tool journal. */
export async function generalizeToolChildren(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_tool_children(
	 tool_id TEXT PRIMARY KEY REFERENCES agent_run_tools(id) ON DELETE CASCADE,
	 parent_id TEXT NOT NULL REFERENCES agent_run_tools(id) ON DELETE CASCADE,
	 parent_hash TEXT NOT NULL CHECK(length(parent_hash)=64),request_key TEXT NOT NULL,
	 kind TEXT NOT NULL CHECK(kind IN ('acp_permission','plugin_tool')),
	 package_id TEXT,installation_revision INTEGER,instance_id TEXT,instance_revision INTEGER,
	 CHECK(tool_id!=parent_id),UNIQUE(parent_id,request_key),
	 CHECK((kind='acp_permission' AND package_id IS NULL AND installation_revision IS NULL AND instance_id IS NULL AND instance_revision IS NULL)
	 OR (kind='plugin_tool' AND package_id IS NOT NULL AND installation_revision IS NOT NULL AND installation_revision>=1 AND instance_id IS NOT NULL AND instance_revision IS NOT NULL AND instance_revision>=1)));
	 INSERT INTO agent_tool_children(tool_id,parent_id,parent_hash,request_key,kind)
	 SELECT tool_id,parent_id,parent_hash,request_key,'acp_permission' FROM agent_acp_permissions;
	 DROP TABLE agent_acp_permissions;
	 CREATE INDEX agent_tool_children_parent ON agent_tool_children(parent_id,tool_id);`);
}
