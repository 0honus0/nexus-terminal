import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import {
  projectArtifactsForModel,
  readArtifactTextLinesForAgent,
} from '../../../packages/backend/src/modules/agent/ai/artifact-model-projection';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { clock, emptyModelContinuations, scenarioDelegationModel } from './scenario-fixtures';
import { EmptyRecallRepository, StaticConversationRepository } from './scenario-context-helpers';

export const artifactModelInputScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-model-input-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'artifact-model-input.sqlite',
    nodeEnv: 'test',
  });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 16 * 1024 * 1024,
      maxGlobalArtifactBytes: 64 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const artifactScope: Scope = { userId: 1, appId: 'artifact-model-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const rootRuntimeId = randomUUID();
  const childRuntimeId = randomUUID();
  const delegationId = randomUUID();
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const source = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-model-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [artifactScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'artifact model input', 'manual', ?, ?)`,
      [threadId, artifactScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', '{}', '{}', '{}', '{}', 2, ?, ?, ?)`,
      [runId, artifactScope.appId, threadId, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [rootRuntimeId, runId, modelRef, `owner-${rootRuntimeId}`, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:artifact', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [childRuntimeId, runId, modelRef, `owner-${childRuntimeId}`, now, now],
    );

    const textBytes = Buffer.from('alpha\nbeta\ngamma\n', 'utf8');
    const largeTextBytes = Buffer.from(
      Array.from({ length: 2400 }, (_, index) => `line-${String(index + 1).padStart(4, '0')} ${'x'.repeat(12)}`).join(
        '\n',
      ),
      'utf8',
    );
    const imageBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

    const writeArtifact = async (name: string, mediaType: string, bytes: Buffer) => {
      const reservation = await artifacts.begin(artifactScope, {
        name,
        mediaType,
        declaredBytes: bytes.byteLength,
      });
      return artifacts.write(artifactScope, reservation.artifactId, source(bytes), new AbortController().signal);
    };

    const textArtifact = await writeArtifact('notes.txt', 'text/plain', textBytes);
    const largeArtifact = await writeArtifact('large.txt', 'text/plain', largeTextBytes);
    const imageArtifact = await writeArtifact('image.png', 'image/png', imageBytes);

    for (const artifactId of [textArtifact.id, largeArtifact.id, imageArtifact.id]) {
      await db.execute(
        `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
         VALUES (?, ?, 'input', ?)`,
        [artifactId, runId, now],
      );
    }
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', ?, 'parent-child', ?, 'read delegated text artifact', '[]', ?, '[]',
               'settled', 'running', 1, 'isolate', 10, ?, ?, ?, ?, ?)`,
      [
        delegationId,
        runId,
        rootRuntimeId,
        childRuntimeId,
        JSON.stringify([{ capability: 'artifacts.read', schemaVersion: 2, scope: { kind: 'global' } }]),
        scenarioDelegationModel(modelRef),
        JSON.stringify([textArtifact.id, largeArtifact.id]),
        `artifact-model-key-${delegationId}`,
        `artifact-model-hash-${delegationId}`,
        now + 600,
        now,
        now,
      ],
    );

    const rootText = await readArtifactTextLinesForAgent(
      artifacts,
      artifactScope,
      { runId, runtimeId: rootRuntimeId },
      textArtifact.id,
      2,
      1,
    );
    assert.equal(rootText.text, 'beta');

    const largeProjection = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [largeArtifact.id], {
      supportsImageInput: false,
      supportsFileInput: false,
    });
    assert.equal(largeProjection.contentParts.length, 0, 'large text must stay in Artifact storage');
    assert.ok(
      largeProjection.textSuffix.includes('"projection":"metadata"'),
      'large text must project metadata instead of full contents',
    );
    const largeRead = await readArtifactTextLinesForAgent(
      artifacts,
      artifactScope,
      { runId, runtimeId: rootRuntimeId },
      largeArtifact.id,
      1500,
      2,
    );
    assert.ok(largeRead.text.startsWith('line-1500 '), 'large Artifact must remain readable on demand');

    const childText = await artifacts.getForAgent(artifactScope, { runId, runtimeId: childRuntimeId }, textArtifact.id);
    const childImage = await artifacts.getForAgent(
      artifactScope,
      { runId, runtimeId: childRuntimeId },
      imageArtifact.id,
    );
    assert.equal(childText?.id, textArtifact.id, 'Child must read explicitly delegated Artifact');
    assert.equal(childImage, null, 'Child must not inherit non-delegated Root Artifact');

    const unsupportedImage = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [imageArtifact.id], {
      supportsImageInput: false,
      supportsFileInput: true,
    });
    assert.equal(unsupportedImage.contentParts.length, 0, 'file capability must not bypass missing image capability');
    assert.ok(unsupportedImage.textSuffix.includes('"projection":"metadata"'));

    const nativeImage = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [imageArtifact.id], {
      supportsImageInput: true,
      supportsFileInput: false,
    });
    assert.equal(nativeImage.contentParts.length, 1);
    assert.equal(nativeImage.contentParts[0]?.type, 'image');
    assert.equal(nativeImage.contentParts[0]?.artifactId, imageArtifact.id);
    assert.equal(
      nativeImage.contentParts[0]?.dataBase64,
      imageBytes.toString('base64'),
      'native image payload must be sourced from canonical Artifact bytes',
    );
    assert.ok(
      nativeImage.textSuffix.includes(imageArtifact.sha256!),
      'model-facing metadata must retain Artifact hash',
    );
    assert.ok(
      nativeImage.textSuffix.includes(artifactScope.appId),
      'model-facing metadata must retain source App provenance',
    );

    const conversations = new ConversationService(new StaticConversationRepository([]), clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      artifacts,
    );
    const resumed = await context.compose({
      scope: artifactScope,
      threadId,
      runId,
      currentInput: '',
      currentInputArtifactRefs: [textArtifact.id],
      modelInputCapabilities: { supportsImageInput: false, supportsFileInput: false },
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
    const resumedUser = resumed.messages.find((message) => message.role === 'user');
    assert.ok(
      resumedUser?.content.includes('alpha\nbeta\ngamma'),
      'attachment-only resume must project the durable Artifact',
    );
    assert.ok(
      resumedUser?.content.includes(textArtifact.sha256!),
      'resume projection must preserve Artifact hash provenance',
    );

    return [
      { name: 'run_scoped_text_reads', value: 1, unit: 'reads' },
      { name: 'large_artifacts_kept_on_demand', value: 1, unit: 'artifacts' },
      { name: 'child_non_delegated_artifacts_exposed', value: childImage ? 1 : 0, unit: 'artifacts' },
      { name: 'unsupported_images_sent_native', value: unsupportedImage.contentParts.length, unit: 'parts' },
      { name: 'explicit_native_image_parts', value: nativeImage.contentParts.length, unit: 'parts' },
      { name: 'attachment_only_resumes', value: resumedUser ? 1 : 0, unit: 'runs' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
