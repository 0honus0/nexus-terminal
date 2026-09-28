<script setup lang="ts">
  import { computed, onBeforeUnmount, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { readStoredValue, stringStorageCodec, writeStoredValue } from '@/foundation/browser';
  import { UiSurface } from '@/foundation/ui';
  import { encodeTerminalKey, type TerminalKey } from '../model/terminalKeys';
  import type { StickyModifierLevels, TerminalModifier } from '../state/stickyModifiers';

  const props = withDefaults(
    defineProps<{
      modifiers?: StickyModifierLevels;
      /** Reads the live DECCKM state at key time so cursor keys match the remote application. */
      applicationCursorKeys?: () => boolean;
    }>(),
    {
      modifiers: () => ({ ctrl: 'off', alt: 'off', shift: 'off' }),
      applicationCursorKeys: () => false,
    },
  );
  const emit = defineEmits<{ input: [value: string]; toggleModifier: [modifier: TerminalModifier] }>();
  const { t } = useI18n();

  type KeyboardPage = 'main' | 'function';
  type KeyDefinition =
    | { kind: 'key'; id: string; key: TerminalKey; label?: string; icon?: string; repeat?: boolean }
    | { kind: 'modifier'; id: string; modifier: TerminalModifier; label: string }
    | { kind: 'page'; id: string }
    | { kind: 'spacer'; id: string };

  const REPEAT_DELAY_MS = 400;
  const REPEAT_INTERVAL_MS = 60;
  const pageStorage = {
    namespace: 'terminal.virtual-keyboard-page',
    version: 1,
    codec: stringStorageCodec((value) => value === 'main' || value === 'function'),
  };

  const page = ref<KeyboardPage>((readStoredValue(pageStorage) as KeyboardPage | undefined) ?? 'main');
  const togglePage = () => {
    page.value = page.value === 'main' ? 'function' : 'main';
    writeStoredValue(pageStorage, page.value);
  };

  const key = (id: TerminalKey, options: { label?: string; icon?: string; repeat?: boolean } = {}): KeyDefinition => ({
    kind: 'key',
    id,
    key: id,
    ...options,
  });
  const ctrl: KeyDefinition = { kind: 'modifier', id: 'ctrl', modifier: 'ctrl', label: 'Ctrl' };
  const alt: KeyDefinition = { kind: 'modifier', id: 'alt', modifier: 'alt', label: 'Alt' };
  const shift: KeyDefinition = { kind: 'modifier', id: 'shift', modifier: 'shift', label: '⇧' };
  const fn: KeyDefinition = { kind: 'page', id: 'fn' };
  const escape = key('escape', { label: 'Esc' });
  const tab = key('tab', { label: 'Tab' });
  const functionKey = (index: number) => key(`f${index}` as TerminalKey, { label: `F${index}` });

  // Two 9-column rows. The first three columns (modifiers, Fn, Esc/Tab) stay fixed across
  // pages so Ctrl/Alt/Shift+Fx combinations never require a page switch.
  const layouts: Record<KeyboardPage, KeyDefinition[][]> = {
    main: [
      [
        ctrl,
        shift,
        escape,
        key('home', { label: 'Home' }),
        key('pageUp', { label: 'PgUp', repeat: true }),
        key('delete', { label: 'Del', repeat: true }),
        { kind: 'spacer', id: 'arrow-gap' },
        key('arrowUp', { icon: 'fa-arrow-up', repeat: true }),
        key('backspace', { icon: 'fa-delete-left', repeat: true }),
      ],
      [
        alt,
        fn,
        tab,
        key('end', { label: 'End' }),
        key('pageDown', { label: 'PgDn', repeat: true }),
        key('insert', { label: 'Ins' }),
        key('arrowLeft', { icon: 'fa-arrow-left', repeat: true }),
        key('arrowDown', { icon: 'fa-arrow-down', repeat: true }),
        key('arrowRight', { icon: 'fa-arrow-right', repeat: true }),
      ],
    ],
    function: [
      [ctrl, shift, escape, ...[1, 2, 3, 4, 5, 6].map(functionKey)],
      [alt, fn, tab, ...[7, 8, 9, 10, 11, 12].map(functionKey)],
    ],
  };
  const rows = computed(() => layouts[page.value]);

  const ariaLabel = (definition: KeyDefinition): string | undefined => {
    if (definition.kind === 'modifier') {
      const name = t(`terminal.virtualKeyboard.${definition.modifier}`);
      return props.modifiers[definition.modifier] === 'locked'
        ? t('terminal.virtualKeyboard.modifierLocked', { key: name })
        : name;
    }
    if (definition.kind === 'page') return t('terminal.virtualKeyboard.functionKeys');
    if (definition.kind !== 'key') return undefined;
    // Function keys are announced by their F1–F12 label; named keys get a localized name.
    return /^f\d+$/.test(definition.key) ? definition.label : t(`terminal.virtualKeyboard.${definition.key}`);
  };
  const pressedState = (definition: KeyDefinition): boolean | undefined => {
    if (definition.kind === 'modifier') return props.modifiers[definition.modifier] !== 'off';
    if (definition.kind === 'page') return page.value === 'function';
    return undefined;
  };
  const stateClass = (definition: KeyDefinition): Record<string, boolean> => ({
    'is-armed': definition.kind === 'modifier' && props.modifiers[definition.modifier] === 'once',
    'is-locked': definition.kind === 'modifier' && props.modifiers[definition.modifier] === 'locked',
    'is-armed-page': definition.kind === 'page' && page.value === 'function',
    'is-repeating': repeatingId.value === definition.id,
  });

  const sendKey = (terminalKey: TerminalKey) => {
    emit('input', encodeTerminalKey(terminalKey, { applicationCursorKeys: props.applicationCursorKeys() }));
  };
  const activate = (definition: KeyDefinition) => {
    if (definition.kind === 'modifier') emit('toggleModifier', definition.modifier);
    else if (definition.kind === 'page') togglePage();
    else if (definition.kind === 'key') sendKey(definition.key);
  };

  const repeatingId = ref<string | null>(null);
  let repeatDelay: ReturnType<typeof setTimeout> | undefined;
  let repeatInterval: ReturnType<typeof setInterval> | undefined;
  const stopRepeat = () => {
    if (repeatDelay !== undefined) clearTimeout(repeatDelay);
    if (repeatInterval !== undefined) clearInterval(repeatInterval);
    repeatDelay = undefined;
    repeatInterval = undefined;
    repeatingId.value = null;
  };

  const handlePointerDown = (event: PointerEvent, definition: KeyDefinition) => {
    // Keep focus (and the system IME) on the command input while tapping keys.
    event.preventDefault();
    if (event.button !== 0 || definition.kind !== 'key' || !definition.repeat) return;
    stopRepeat();
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers may not be capturable; release events still stop the repeat.
    }
    repeatingId.value = definition.id;
    sendKey(definition.key);
    repeatDelay = setTimeout(() => {
      repeatInterval = setInterval(() => sendKey(definition.key), REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  };
  const handleClick = (event: MouseEvent, definition: KeyDefinition) => {
    // Repeatable keys already fired on pointerdown; only keyboard activation (detail 0) sends here.
    if (definition.kind === 'key' && definition.repeat && event.detail !== 0) return;
    activate(definition);
  };

  onBeforeUnmount(stopRepeat);
</script>

<template>
  <UiSurface
    surface="plain"
    radius="control"
    class="mobile-virtual-keyboard virtual-keyboard-bar"
    role="toolbar"
    :aria-label="t('terminal.virtualKeyboard.label')"
    :data-page="page"
    @contextmenu.prevent
  >
    <div v-for="(row, rowIndex) in rows" :key="`${page}-${rowIndex}`" class="virtual-key-row">
      <template v-for="definition in row" :key="definition.id">
        <span v-if="definition.kind === 'spacer'" class="virtual-key-spacer" aria-hidden="true"></span>
        <button
          v-else
          type="button"
          class="virtual-key"
          :class="[`virtual-key--${definition.kind}`, stateClass(definition)]"
          :data-key="definition.id"
          :aria-label="ariaLabel(definition)"
          :aria-pressed="pressedState(definition)"
          @pointerdown="handlePointerDown($event, definition)"
          @pointerup="stopRepeat"
          @pointercancel="stopRepeat"
          @lostpointercapture="stopRepeat"
          @click="handleClick($event, definition)"
        >
          <i
            v-if="definition.kind === 'key' && definition.icon"
            :class="['fa-solid', definition.icon]"
            aria-hidden="true"
          ></i>
          <template v-else-if="definition.kind === 'page'">Fn</template>
          <template v-else-if="definition.kind !== 'key' || definition.label">{{ definition.label }}</template>
        </button>
      </template>
    </div>
  </UiSurface>
</template>

<style scoped>
  .virtual-keyboard-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    padding-bottom: max(4px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--ui-hairline);
    border-radius: 0;
    background: var(--glass-nav-fill);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .virtual-key-row {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    gap: 4px;
  }

  .virtual-key {
    position: relative;
    display: flex;
    min-width: 0;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--ui-hairline);
    border-radius: var(--ui-control-radius);
    background: var(--ui-fill-inset);
    box-shadow: var(--ui-glass-highlight);
    color: var(--ui-text);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--ui-motion-duration) var(--ui-motion-ease),
      background-color var(--ui-motion-duration) var(--ui-motion-ease),
      border-color var(--ui-motion-duration) var(--ui-motion-ease),
      color var(--ui-motion-duration) var(--ui-motion-ease);
  }

  .virtual-key i {
    font-size: 0.85rem;
    pointer-events: none;
  }

  .virtual-key--modifier,
  .virtual-key--page {
    color: var(--ui-text-muted);
    font-weight: 600;
  }

  .virtual-key--modifier {
    font-size: 0.8rem;
  }

  @media (hover: hover) {
    .virtual-key:hover {
      background: var(--ui-fill-inset-hover);
    }
  }

  .virtual-key:focus-visible {
    outline: none;
    border-color: var(--ui-focus-color);
    box-shadow: var(--ui-focus-ring);
  }

  .virtual-key:active,
  .virtual-key.is-repeating {
    transform: scale(0.94);
    background: var(--ui-fill-inset-hover);
    border-color: var(--ui-hairline-strong);
  }

  .virtual-key.is-armed,
  .virtual-key.is-armed-page {
    border-color: color-mix(in srgb, var(--link-active-color) 55%, var(--border-color));
    background: color-mix(in srgb, var(--link-active-color) 20%, transparent);
    color: var(--link-active-color);
  }

  .virtual-key.is-locked {
    border-color: var(--link-active-color);
    background: var(--link-active-color);
    color: var(--app-bg-color);
  }

  /* A locked modifier carries an underline so it is distinguishable without color alone. */
  .virtual-key.is-locked::after {
    position: absolute;
    bottom: 5px;
    left: 50%;
    width: 1rem;
    height: 2px;
    border-radius: 1px;
    background: currentColor;
    content: '';
    transform: translateX(-50%);
  }

  .virtual-key-spacer {
    min-width: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .virtual-key {
      transition: none;
    }

    .virtual-key:active,
    .virtual-key.is-repeating {
      transform: none;
    }
  }
</style>
