<script setup lang="ts">
  import { ref } from 'vue';
  import {
    UiBadge,
    UiButton,
    UiCheckbox,
    UiDialog,
    UiFormField,
    UiInput,
    UiPopover,
    UiSelect,
    UiSlider,
    UiSpinner,
    UiSurface,
    UiSwitch,
    UiTextarea,
    type UiAppearance,
    type UiDensity,
    type UiSelectOption,
    type UiTone,
  } from '@/foundation/ui';

  const densities: UiDensity[] = ['compact', 'default', 'comfortable'];
  const tones: UiTone[] = ['neutral', 'primary', 'success', 'warning', 'danger'];
  const appearances: UiAppearance[] = ['solid', 'soft', 'ghost', 'glass'];
  const inputValue = ref('Nexus Terminal');
  const bioValue = ref('');
  const switchValue = ref(true);
  const sliderValue = ref(68);
  const popoverOpen = ref(false);
  const checkboxValue = ref(true);
  const checkboxOff = ref(false);
  const selectValue = ref<string | number | null>('balanced');
  const dialogOpen = ref(false);

  const selectOptions: UiSelectOption[] = [
    { value: 'balanced', label: 'Balanced', description: 'Even split between speed and depth.' },
    { value: 'precise', label: 'Precise', description: 'Slower, more deliberate responses.' },
    { value: 'fast', label: 'Fast', description: 'Lowest latency, lighter reasoning.' },
    { value: 'legacy', label: 'Legacy engine', description: 'Retired in this build.', disabled: true },
  ];
</script>

<template>
  <main class="min-h-full bg-background px-5 py-8 text-foreground sm:px-8">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header class="flex flex-col gap-2">
        <UiBadge tone="primary" appearance="soft">Foundation UI · Gen 2</UiBadge>
        <h1 class="text-2xl font-semibold tracking-tight">UI system gallery</h1>
        <p class="max-w-3xl text-sm leading-6 text-text-secondary">
          Runtime marker: <code class="font-mono text-[12px]">data-ui-gen="2"</code>. This page intentionally exercises
          every state before Gen 2 replaces legacy <code class="font-mono text-[12px]">Base*</code> components.
        </p>
      </header>

      <UiSurface class="p-5">
        <div class="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">Buttons</h2>
            <p class="mt-1 text-xs text-text-secondary">Appearance × tone, with restrained elevation and motion.</p>
          </div>
          <UiButton appearance="ghost" tone="neutral" density="compact" :loading="true">Loading</UiButton>
        </div>
        <div class="grid gap-4">
          <div v-for="appearance in appearances" :key="appearance" class="flex flex-wrap items-center gap-2.5">
            <span class="w-14 shrink-0 text-[11px] font-medium text-text-secondary">{{ appearance }}</span>
            <UiButton v-for="tone in tones" :key="tone" :appearance="appearance" :tone="tone">
              {{ tone }}
            </UiButton>
          </div>
          <div class="flex flex-wrap items-center gap-2.5 border-t border-border/50 pt-4">
            <span class="w-14 shrink-0 text-[11px] font-medium text-text-secondary">density</span>
            <UiButton v-for="density in densities" :key="density" tone="primary" :density="density">
              {{ density }}
            </UiButton>
            <UiButton tone="primary" disabled>Disabled</UiButton>
            <UiButton tone="primary" icon-only aria-label="Add">+</UiButton>
          </div>
        </div>
      </UiSurface>

      <div class="grid gap-6 lg:grid-cols-2">
        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Textarea</h2>
          <p class="mt-1 text-xs text-text-secondary">Multi-line control sharing the inset input language.</p>
          <div class="mt-4 grid gap-3">
            <UiTextarea v-model="bioValue" placeholder="Default textarea" />
            <UiTextarea v-model="bioValue" density="compact" placeholder="Compact textarea" />
            <UiTextarea model-value="Invalid multi-line value" invalid aria-label="Invalid textarea example" />
            <UiTextarea model-value="Disabled but legible" disabled />
          </div>
        </UiSurface>

        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Form field &amp; spinner</h2>
          <p class="mt-1 text-xs text-text-secondary">Compact labels, helper text, and a calm loading ring.</p>
          <div class="mt-4 grid gap-5">
            <UiFormField
              label="Workspace name"
              description="Shown in the terminal title bar."
              for-id="gallery-workspace"
            >
              <UiInput v-model="inputValue" />
            </UiFormField>
            <UiFormField label="API key" required error="This field is required." for-id="gallery-api-key">
              <UiInput v-model="inputValue" invalid />
            </UiFormField>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-4 border-t border-border/50 pt-4">
            <span v-for="density in densities" :key="density" class="flex items-center gap-2 text-xs">
              <UiSpinner :density="density" :label="`${density} spinner`" />
              <span>{{ density }}</span>
            </span>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-4">
            <span v-for="tone in tones" :key="tone" class="flex items-center gap-2 text-xs">
              <UiSpinner :tone="tone" :label="`${tone} spinner`" />
              <span>{{ tone }}</span>
            </span>
          </div>
        </UiSurface>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Inputs</h2>
          <p class="mt-1 text-xs text-text-secondary">Inset controls with wrapper-owned focus and validation.</p>
          <div class="mt-4 grid gap-3">
            <UiInput v-model="inputValue" placeholder="Default input">
              <template #leading><span class="text-[11px]">⌕</span></template>
            </UiInput>
            <UiInput v-model="inputValue" density="compact" placeholder="Compact input" />
            <UiInput v-model="inputValue" invalid aria-label="Invalid example" />
            <UiInput model-value="Disabled but legible" disabled />
          </div>
        </UiSurface>

        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Badges</h2>
          <p class="mt-1 text-xs text-text-secondary">Small semantic markers that do not overpower nearby content.</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <UiBadge v-for="tone in tones" :key="tone" :tone="tone">{{ tone }}</UiBadge>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <UiBadge v-for="tone in tones" :key="tone" :tone="tone" appearance="ghost" density="compact">
              {{ tone }}
            </UiBadge>
          </div>
        </UiSurface>
      </div>

      <div class="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Switches</h2>
          <p class="mt-1 text-xs text-text-secondary">Native button semantics with a quiet, physical thumb.</p>
          <div class="mt-5 flex flex-wrap items-center gap-5">
            <label v-for="density in densities" :key="density" class="flex items-center gap-2.5 text-xs">
              <UiSwitch v-model="switchValue" :density="density" />
              <span>{{ density }}</span>
            </label>
            <UiSwitch :model-value="false" disabled aria-label="Disabled switch" />
          </div>
        </UiSurface>

        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Slider</h2>
          <p class="mt-1 text-xs text-text-secondary">Token-based fill; no gradient, glow, or drag lag.</p>
          <div class="mt-5 grid gap-5">
            <UiSlider v-model="sliderValue" :min="0" :max="100">
              <template #label>Reasoning budget</template>
              <template #value="{ value }">{{ value }}%</template>
            </UiSlider>
            <UiSlider v-model="sliderValue" density="compact" tone="success" aria-label="Compact success slider" />
            <UiSlider :model-value="35" disabled aria-label="Disabled slider example" />
          </div>
        </UiSurface>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Checkbox</h2>
          <p class="mt-1 text-xs text-text-secondary">Reka-owned keyboard behaviour with a quiet, token-based fill.</p>
          <div class="mt-5 flex flex-wrap items-center gap-5 text-xs">
            <label class="flex items-center gap-2.5">
              <UiCheckbox v-model="checkboxValue" aria-label="Checked checkbox example" />
              <span>Checked</span>
            </label>
            <label class="flex items-center gap-2.5">
              <UiCheckbox v-model="checkboxOff" tone="success" aria-label="Unchecked checkbox example" />
              <span>Unchecked</span>
            </label>
            <label class="flex items-center gap-2.5">
              <UiCheckbox :model-value="true" disabled aria-label="Disabled checked checkbox" />
              <span>Disabled</span>
            </label>
          </div>
        </UiSurface>

        <UiSurface class="p-5">
          <h2 class="text-sm font-semibold">Select</h2>
          <p class="mt-1 text-xs text-text-secondary">Glass panel, typeahead, and disabled options via Reka.</p>
          <div class="mt-4 grid gap-3">
            <UiSelect
              v-model="selectValue"
              :options="selectOptions"
              placeholder="Choose a reasoning profile"
              aria-label="Reasoning profile"
            />
            <UiSelect
              :options="selectOptions"
              :model-value="null"
              density="compact"
              placeholder="Compact select"
              aria-label="Compact select example"
            />
          </div>
        </UiSurface>
      </div>

      <UiSurface class="p-5">
        <h2 class="text-sm font-semibold">Dialog</h2>
        <p class="mt-1 text-xs text-text-secondary">
          Focus-trapped, Escape-aware panel with a header, scrollable body, and footer slot.
        </p>
        <div class="mt-4">
          <UiButton tone="primary" @click="dialogOpen = true">Open dialog</UiButton>
        </div>
        <UiDialog
          v-model:open="dialogOpen"
          title="Confirm workspace action"
          description="Dialogs keep Reka's focus trap and restore while the panel stays on Gen 2 tokens."
        >
          <p class="text-xs leading-6 text-text-secondary">
            The body region scrolls independently, so long content never pushes the header or footer out of view.
          </p>
          <template #footer="{ close }">
            <UiButton appearance="ghost" density="compact" @click="close()">Cancel</UiButton>
            <UiButton tone="primary" density="compact" @click="close()">Confirm</UiButton>
          </template>
        </UiDialog>
      </UiSurface>

      <UiSurface class="p-5">
        <h2 class="text-sm font-semibold">Surfaces & popover</h2>
        <p class="mt-1 text-xs text-text-secondary">
          Glass is reserved for floating content; ordinary surfaces stay solid and calm.
        </p>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <UiSurface surface="plain" class="border border-dashed border-border p-4">
            <div class="text-xs font-medium">Plain</div>
            <div class="mt-1 text-[11px] text-text-secondary">No decorative surface.</div>
          </UiSurface>
          <UiSurface surface="raised" radius="control" class="p-4">
            <div class="text-xs font-medium">Raised</div>
            <div class="mt-1 text-[11px] text-text-secondary">Default card-like elevation.</div>
          </UiSurface>
          <UiSurface surface="inset" radius="control" class="p-4">
            <div class="text-xs font-medium">Inset</div>
            <div class="mt-1 text-[11px] text-text-secondary">Tracks, metadata, compact wells.</div>
          </UiSurface>
        </div>
        <div class="mt-5">
          <UiPopover v-model:open="popoverOpen" :ariaLabel="'Gallery popover'" trigger-tone="primary">
            <template #trigger>Open glass popover</template>
            <template #panel="{ close }">
              <div class="w-[300px] max-w-full">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-xs font-semibold">Floating controls</div>
                    <p class="mt-1 text-[11px] leading-5 text-text-secondary">
                      Boundary-safe, focusable, Escape-aware, and intentionally the only blurred surface here.
                    </p>
                  </div>
                  <UiBadge tone="primary" density="compact">glass</UiBadge>
                </div>
                <div class="mt-4 grid gap-3">
                  <UiSlider v-model="sliderValue" density="compact" />
                  <UiInput v-model="inputValue" density="compact" />
                </div>
                <div class="mt-4 flex justify-end">
                  <UiButton density="compact" appearance="ghost" @click="close()">Close</UiButton>
                </div>
              </div>
            </template>
          </UiPopover>
        </div>
      </UiSurface>
    </div>
  </main>
</template>
