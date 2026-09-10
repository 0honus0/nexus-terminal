<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.guardrails.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.guardrails.description') }}</p>
    <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-md bg-background p-3">
        <dt class="text-xs text-text-secondary">{{ $t('agent.settings.guardrails.eventBatch') }}</dt>
        <dd class="mt-1 font-mono text-sm">{{ $t('agent.settings.guardrails.eventBatchValue') }}</dd>
      </div>
      <div class="rounded-md bg-background p-3">
        <dt class="text-xs text-text-secondary">{{ $t('agent.settings.guardrails.commitQueue') }}</dt>
        <dd class="mt-1 font-mono text-sm">{{ $t('agent.settings.guardrails.commitQueueValue') }}</dd>
      </div>
      <div class="rounded-md bg-background p-3">
        <dt class="text-xs text-text-secondary">{{ $t('agent.settings.guardrails.sseHeartbeat') }}</dt>
        <dd class="mt-1 font-mono text-sm">{{ $t('agent.settings.guardrails.sseHeartbeatValue') }}</dd>
      </div>
      <div class="rounded-md bg-background p-3">
        <dt class="text-xs text-text-secondary">{{ $t('agent.settings.guardrails.transient') }}</dt>
        <dd class="mt-1 font-mono text-sm">{{ $t('agent.settings.guardrails.transientValue') }}</dd>
      </div>
    </dl>
  </section>
</template>
