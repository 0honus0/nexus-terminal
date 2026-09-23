<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4"
    >
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
          <i class="fa-solid fa-gauge-high text-sm" aria-hidden="true"></i>
        </div>
        <div>
          <h3 class="text-sm font-bold text-foreground">{{ $t('agent.settings.guardrails.title') }}</h3>
          <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.guardrails.description') }}</p>
        </div>
      </div>
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-text-secondary shadow-2xs"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
        <span>系统硬边界</span>
      </span>
    </div>
    <div class="p-4 sm:p-5">
      <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          class="rounded-xl border border-border bg-background/80 p-3.5 shadow-2xs transition-all hover:border-border-hover"
        >
          <dt class="flex items-center gap-1.5 text-xs text-text-secondary">
            <i class="fa-solid fa-layer-group text-[10px] text-primary" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.guardrails.eventBatch') }}</span>
          </dt>
          <dd class="mt-1.5 font-mono text-sm font-semibold text-foreground">
            {{ $t('agent.settings.guardrails.eventBatchValue') }}
          </dd>
        </div>
        <div
          class="rounded-xl border border-border bg-background/80 p-3.5 shadow-2xs transition-all hover:border-border-hover"
        >
          <dt class="flex items-center gap-1.5 text-xs text-text-secondary">
            <i class="fa-solid fa-clock-rotate-left text-[10px] text-primary" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.guardrails.commitQueue') }}</span>
          </dt>
          <dd class="mt-1.5 font-mono text-sm font-semibold text-foreground">
            {{ $t('agent.settings.guardrails.commitQueueValue') }}
          </dd>
        </div>
        <div
          class="rounded-xl border border-border bg-background/80 p-3.5 shadow-2xs transition-all hover:border-border-hover"
        >
          <dt class="flex items-center gap-1.5 text-xs text-text-secondary">
            <i class="fa-solid fa-heart-pulse text-[10px] text-primary" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.guardrails.sseHeartbeat') }}</span>
          </dt>
          <dd class="mt-1.5 font-mono text-sm font-semibold text-foreground">
            {{ $t('agent.settings.guardrails.sseHeartbeatValue') }}
          </dd>
        </div>
        <div
          class="rounded-xl border border-border bg-background/80 p-3.5 shadow-2xs transition-all hover:border-border-hover"
        >
          <dt class="flex items-center gap-1.5 text-xs text-text-secondary">
            <i class="fa-solid fa-bolt text-[10px] text-primary" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.guardrails.transient') }}</span>
          </dt>
          <dd class="mt-1.5 font-mono text-sm font-semibold text-foreground">
            {{ $t('agent.settings.guardrails.transientValue') }}
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>
