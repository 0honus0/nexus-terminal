// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** A process incarnation and its installation/configuration revisions are distinct from its persisted logical instance. */
export async function bindPluginRuntimeInstances(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_runtime_instances_next (
	 user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,
	 logical_instance_id TEXT NOT NULL,instance_id TEXT NOT NULL UNIQUE,generation TEXT NOT NULL,
	 revision INTEGER NOT NULL CHECK(revision>=1),configuration_revision INTEGER NOT NULL CHECK(configuration_revision>=0),
	 state TEXT NOT NULL CHECK(state IN ('opening','active','closed','unknown')),updated_at INTEGER NOT NULL,
	 unknown_at INTEGER,acknowledged_at INTEGER,
	 PRIMARY KEY(user_id,app_id,logical_instance_id),
	 FOREIGN KEY(user_id,app_id,logical_instance_id) REFERENCES agent_plugin_instances(user_id,app_id,id)
	) STRICT;
	INSERT INTO agent_plugin_runtime_instances_next
	 SELECT r.user_id,r.app_id,r.package_id,l.id,r.instance_id,r.instance_id,r.revision,l.configuration_revision,
	 r.state,r.updated_at,r.unknown_at,r.acknowledged_at
	 FROM agent_plugin_runtime_instances r JOIN agent_plugin_instances l
	 ON l.user_id=r.user_id AND l.app_id=r.app_id AND l.package_id=r.package_id;
	DROP TABLE agent_plugin_runtime_instances;
	ALTER TABLE agent_plugin_runtime_instances_next RENAME TO agent_plugin_runtime_instances;
	CREATE INDEX agent_plugin_runtime_package ON agent_plugin_runtime_instances(user_id,app_id,package_id);
	ALTER TABLE agent_plugin_runtime_history ADD COLUMN logical_instance_id TEXT;
	ALTER TABLE agent_plugin_runtime_history ADD COLUMN generation TEXT;
	ALTER TABLE agent_plugin_runtime_history ADD COLUMN configuration_revision INTEGER;
	UPDATE agent_plugin_runtime_history SET logical_instance_id=(SELECT l.id FROM agent_plugin_instances l WHERE
	 l.user_id=agent_plugin_runtime_history.user_id AND l.app_id=agent_plugin_runtime_history.app_id AND
	 l.package_id=agent_plugin_runtime_history.package_id LIMIT 1),generation=instance_id,configuration_revision=0;`);
}
