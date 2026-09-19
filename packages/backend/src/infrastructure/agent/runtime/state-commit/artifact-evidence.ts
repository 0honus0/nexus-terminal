import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import type { RunRow } from '../../repositories/sqlite-run.mapper';

const MAX_EVIDENCE_REFS = 4096;

export const linkVerifiedToolEvidence = async (
  tx: RelationalDatabase,
  run: RunRow,
  result: ToolResult,
  now: number,
): Promise<void> => {
  if (result.verification.status !== 'verified' || result.verification.evidenceRefs.length === 0) return;
  const evidenceRefs = [...new Set(result.verification.evidenceRefs)];
  if (evidenceRefs.length > MAX_EVIDENCE_REFS) throw new Error('TOOL_EVIDENCE_INVALID');
  const producedRefs = new Set(result.artifactRefs);
  for (const artifactId of evidenceRefs) {
    if (!producedRefs.has(artifactId)) throw new Error('TOOL_EVIDENCE_INVALID');
    const artifact = await tx.queryOne<{ id: string }>(
      `SELECT a.id
       FROM ai_artifacts a
       WHERE a.id=? AND a.user_id=? AND a.status='ready'
         AND (
           a.app_id=? OR
           EXISTS (
             SELECT 1 FROM agent_artifact_links l
             WHERE l.artifact_id=a.id AND l.run_id=?
           ) OR
           EXISTS (
             SELECT 1 FROM agent_artifact_grants g
             WHERE g.artifact_id=a.id
               AND g.receiver_user_id=?
               AND g.receiver_app_id=?
               AND g.receiver_run_id=?
               AND g.revoked_at IS NULL
               AND (g.expires_at IS NULL OR g.expires_at>?)
           )
         )
       LIMIT 1`,
      [artifactId, run.user_id, run.app_id, run.id, run.user_id, run.app_id, run.id, now],
    );
    if (!artifact) throw new Error('TOOL_EVIDENCE_INVALID');
    await tx.execute(
      `INSERT OR IGNORE INTO agent_artifact_links (artifact_id,run_id,role,created_at)
       VALUES (?,?,'evidence',?)`,
      [artifactId, run.id, now],
    );
  }
};
