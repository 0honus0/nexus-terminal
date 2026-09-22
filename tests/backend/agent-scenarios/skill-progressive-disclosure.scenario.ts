import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import {
  SkillRegistry,
  validatePluginSkillDocument,
} from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type {
  PluginSkillBundle,
  PluginSkillSourcePort,
} from '../../../packages/backend/src/modules/agent/host/plugin-skill-source.port';
import {
  createSkillReadTool,
  createSkillSearchTool,
} from '../../../packages/backend/src/modules/agent/tools/host/skill-tools';
import { clock, emptyModelContinuations } from './scenario-fixtures';
import { EmptyRecallRepository, StaticConversationRepository } from './scenario-context-helpers';

export const skillProgressiveDisclosureScenario = async () => {
  const skillScope: Scope = { userId: 1, appId: 'scenario.skills' };
  const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
  const standardDocument = (name: string, description: string, body: string) => {
    const content = [
      '---',
      `name: ${name}`,
      `description: "${description}"`,
      'license: Apache-2.0',
      'metadata:',
      '  scenario: "true"',
      'allowed-tools: "Read Grep"',
      '---',
      '',
      `# ${name}`,
      '',
      body,
      '',
    ].join('\n');
    return { path: `skills/${name}/SKILL.md`, content, sha256: sha256(content) };
  };
  const bundle = (documents: PluginSkillBundle['documents']): PluginSkillBundle => ({
    appId: skillScope.appId,
    version: '1.2.3',
    packageHash: sha256(documents.map((document) => document.sha256).join(':')),
    capabilities: [],
    documents,
  });
  class StaticSkillSource implements PluginSkillSourcePort {
    constructor(
      private readonly value: PluginSkillBundle,
      private readonly allowedScope: Scope = skillScope,
    ) {}

    async load(requested: Scope): Promise<PluginSkillBundle | null> {
      if (requested.userId !== this.allowedScope.userId || requested.appId !== this.allowedScope.appId) return null;
      return this.value;
    }
  }
  const composeWithSkills = async (registry: SkillRegistry, currentInput: string, targetScope = skillScope) => {
    const conversations = new ConversationService(new StaticConversationRepository([]), clock, null!, null!);
    return new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      registry,
      emptyModelContinuations,
      null!,
    ).compose({
      scope: targetScope,
      threadId: 'skill-progressive-thread',
      runId: 'skill-progressive-run',
      currentInput,
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
  };

  const lowDocuments = [
    standardDocument(
      'project-planner',
      'Plan implementation work while keeping signed Skill instructions on demand.',
      'STANDARD_BODY_ON_DEMAND_ONLY',
    ),
    standardDocument(
      'operations',
      'Investigate operational state using signed Skill instructions loaded on demand.',
      'OPERATIONS_BODY_ON_DEMAND_ONLY',
    ),
  ];
  const lowRegistry = new SkillRegistry(new StaticSkillSource(bundle(lowDocuments)));
  const lowMetadata = await lowRegistry.list(skillScope);
  assert.deepEqual(
    lowMetadata.map((item) => item.id).sort(),
    ['scenario.skills.operations', 'scenario.skills.project-planner'],
    'SKILL.md identity must derive only from the signed App id and canonical Skill name',
  );
  assert.equal(
    lowMetadata.find((item) => item.id === 'scenario.skills.project-planner')?.version,
    '1.2.3',
    'standard SKILL.md version must derive from the signed plugin version rather than document-authored authority',
  );
  const lowPlan = await composeWithSkills(lowRegistry, 'Plan a small implementation.');
  const lowSkillInstructions = lowPlan.instructions.find((item) => item.startsWith('[Available signed plugin Skills;'));
  assert.ok(lowSkillInstructions?.includes('scenario.skills.project-planner'));
  assert.ok(lowSkillInstructions?.includes('scenario.skills.operations'));
  assert.ok(!lowSkillInstructions?.includes('STANDARD_BODY_ON_DEMAND_ONLY'));
  assert.ok(!lowSkillInstructions?.includes('OPERATIONS_BODY_ON_DEMAND_ONLY'));
  assert.ok(
    !lowSkillInstructions?.includes('allowed-tools'),
    'Agent Skills allowed-tools metadata must not become Nexus model-facing authority',
  );

  const targetDocument = standardDocument(
    'incident-triage',
    'Investigate orbital telemetry 项目 regression and canary drift with bounded evidence.',
    'HIGH_TARGET_BODY_ON_DEMAND_ONLY',
  );
  const fillerDocuments = Array.from({ length: 47 }, (_, index) =>
    standardDocument(
      `skill-${String(index).padStart(2, '0')}`,
      `Routine maintenance workflow ${String(index).padStart(2, '0')} for ordinary service checks.`,
      `FILLER_BODY_${index}`,
    ),
  );
  const mediumRegistry = new SkillRegistry(
    new StaticSkillSource(bundle([targetDocument, ...fillerDocuments.slice(0, 15)])),
  );
  const highRegistry = new SkillRegistry(new StaticSkillSource(bundle([targetDocument, ...fillerDocuments])));
  const highInput = 'Investigate the orbital telemetry 项目 regression and canary drift.';
  const [mediumPlan, highPlan] = await Promise.all([
    composeWithSkills(mediumRegistry, highInput),
    composeWithSkills(highRegistry, highInput),
  ]);
  const mediumInstructions = mediumPlan.instructions.find((item) =>
    item.startsWith('[Available signed plugin Skills;'),
  );
  const highInstructions = highPlan.instructions.find((item) => item.startsWith('[Available signed plugin Skills;'));
  assert.ok(mediumInstructions?.includes('indexed metadata projection'));
  assert.ok(highInstructions?.includes('indexed metadata projection'));
  assert.ok(
    highInstructions?.includes('scenario.skills.incident-triage'),
    'relevant high-cardinality Skill must be injected',
  );
  assert.ok(
    highInstructions?.includes('skill_search'),
    'indexed projection must teach the model how to discover more Skills',
  );
  assert.ok(!highInstructions?.includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'), 'Skill body must remain out of the prompt');
  const injectedMetadataCount = highInstructions?.match(/\n- id:/g)?.length ?? 0;
  assert.ok(injectedMetadataCount <= 6, 'high-cardinality prompt metadata must remain bounded');
  const mediumSkillTokens = Math.ceil(Buffer.byteLength(mediumInstructions ?? '', 'utf8') / 4);
  const highSkillTokens = Math.ceil(Buffer.byteLength(highInstructions ?? '', 'utf8') / 4);
  assert.equal(
    highSkillTokens,
    mediumSkillTokens,
    'growing the catalog from 16 to 48 Skills with the same relevant match must not linearly grow Skill system tokens',
  );

  const searchMatches = await highRegistry.search(skillScope, 'orbital telemetry 项目 regression', 3);
  assert.equal(
    searchMatches[0]?.id,
    'scenario.skills.incident-triage',
    'bounded indexed discovery must rank the target first',
  );
  assert.ok(searchMatches.length <= 3);

  const cryptoHash = { sha256Utf8: sha256 };
  const toolContext: ToolContext = {
    ...skillScope,
    actor: {
      kind: 'agent',
      userId: skillScope.userId,
      appId: skillScope.appId,
      runId: 'skill-progressive-run',
      agentRuntimeId: 'skill-progressive-runtime',
    },
    runId: 'skill-progressive-run',
    agentRuntimeId: 'skill-progressive-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'skill-progressive-step',
    signal: new AbortController().signal,
    deadlineAt: clock.nowUnixSeconds() + 60,
    maxOutputBytes: 16 * 1024,
    inputRevision: 1,
  };
  const searchTool = createSkillSearchTool(highRegistry, cryptoHash);
  const searchInspection = await searchTool.inspect(
    { query: 'orbital telemetry 项目 regression', limit: 3 },
    toolContext,
    1,
  );
  const searchResult = await searchTool.execute(searchInspection, toolContext);
  assert.ok(JSON.stringify(searchResult.data).includes('scenario.skills.incident-triage'));
  assert.ok(
    !JSON.stringify(searchResult.data).includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'),
    'skill_search must return metadata only',
  );

  const readTool = createSkillReadTool(highRegistry, cryptoHash);
  const readInspection = await readTool.inspect({ id: 'scenario.skills.incident-triage' }, toolContext, 1);
  const readResult = await readTool.execute(readInspection, toolContext);
  assert.ok(
    JSON.stringify(readResult.data).includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'),
    'skill_read must load the signed body only after explicit selection',
  );

  const unauthorizedScope: Scope = { userId: 2, appId: skillScope.appId };
  assert.deepEqual(
    await highRegistry.search(unauthorizedScope, 'orbital telemetry 项目 regression', 3),
    [],
    'a scope that cannot load the installed signed plugin must not discover Skill metadata',
  );
  const unauthorizedPlan = await composeWithSkills(highRegistry, highInput, unauthorizedScope);
  assert.equal(
    unauthorizedPlan.instructions.some((item) => item.startsWith('[Available signed plugin Skills;')),
    false,
    'unauthorized scope must not receive Skill prompt metadata',
  );

  const tamperedTarget = { ...targetDocument, sha256: '0'.repeat(64) };
  const tamperedRegistry = new SkillRegistry(new StaticSkillSource(bundle([tamperedTarget])));
  await assert.rejects(
    tamperedRegistry.list(skillScope),
    /PLUGIN_SKILL_CHANGED/,
    'a Skill whose bytes do not match the signed file hash must fail closed before metadata disclosure',
  );
  const removedFormatContent = [
    '---',
    'id: scenario.removed-format',
    'name: removed-format',
    'version: 1.0.0',
    'description: Removed Nexus-specific Skill metadata must be rejected.',
    'requiredCapabilities: file.read',
    '---',
    '',
    '# Removed format',
    '',
    'REMOVED_FORMAT_BODY',
    '',
  ].join('\n');
  const removedFormatRegistry = new SkillRegistry(
    new StaticSkillSource(
      bundle([
        {
          path: 'skills/removed-format/SKILL.md',
          content: removedFormatContent,
          sha256: sha256(removedFormatContent),
        },
      ]),
    ),
  );
  await assert.rejects(
    removedFormatRegistry.list(skillScope),
    /Invalid Skill metadata/,
    'removed Nexus-specific Skill frontmatter must fail closed instead of entering a compatibility branch',
  );
  assert.throws(
    () =>
      validatePluginSkillDocument(
        removedFormatContent,
        'skills/removed-format/SKILL.md',
        sha256(removedFormatContent),
        { appId: skillScope.appId, version: '1.2.3' },
      ),
    /PLUGIN_SKILL_DOCUMENT_INVALID/,
    'plugin package verification must reject removed Nexus-specific Skill frontmatter before installation',
  );
  const degradedPlan = await composeWithSkills(
    removedFormatRegistry,
    'Continue safely even when the optional signed Skill catalog is invalid.',
  );
  assert.ok(
    degradedPlan.droppedSections.includes('skill-catalog:unavailable'),
    'Context composition must record unavailable Skill metadata without aborting the root model step',
  );
  assert.equal(
    degradedPlan.instructions.some((item) => item.startsWith('[Available signed plugin Skills;')),
    false,
    'an invalid Skill catalog must fail closed instead of entering the model prompt',
  );

  return [
    { name: 'low_cardinality_metadata_exposed', value: lowMetadata.length, unit: 'skills' },
    { name: 'high_cardinality_catalog_size', value: 48, unit: 'skills' },
    { name: 'high_cardinality_prompt_metadata', value: injectedMetadataCount, unit: 'skills' },
    { name: 'high_cardinality_skill_tokens', value: highSkillTokens, unit: 'tokens' },
    { name: 'bounded_search_results', value: searchMatches.length, unit: 'skills' },
    { name: 'skill_bodies_prompt_resident', value: 0, unit: 'bodies' },
    { name: 'trust_scope_leaks', value: 0, unit: 'skills' },
  ];
};
