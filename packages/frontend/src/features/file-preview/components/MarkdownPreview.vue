<script setup lang="ts">
  import { computed } from 'vue';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  const props = defineProps<{ bytes: ArrayBuffer }>();
  const html = computed(() => {
    const rendered = marked.parse(new TextDecoder().decode(props.bytes), {
      async: false,
      gfm: true,
      breaks: false,
    }) as string;
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'audio',
        'button',
        'embed',
        'form',
        'iframe',
        'img',
        'input',
        'object',
        'option',
        'select',
        'source',
        'style',
        'textarea',
        'video',
      ],
      FORBID_ATTR: ['srcset', 'style'],
    });
  });
</script>
<template>
  <article
    class="markdown-preview mx-auto max-w-5xl overflow-auto px-5 py-6 text-foreground md:px-10 md:py-8"
    v-html="html"
  ></article>
</template>

<style scoped>
  .markdown-preview {
    line-height: 1.72;
    overflow-wrap: anywhere;
  }
  .markdown-preview :deep(h1),
  .markdown-preview :deep(h2),
  .markdown-preview :deep(h3),
  .markdown-preview :deep(h4),
  .markdown-preview :deep(h5),
  .markdown-preview :deep(h6) {
    margin-top: 1.4em;
    margin-bottom: 0.65em;
    font-weight: 650;
    line-height: 1.25;
  }
  .markdown-preview :deep(h1) {
    font-size: 2rem;
  }
  .markdown-preview :deep(h2) {
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0.35rem;
    font-size: 1.55rem;
  }
  .markdown-preview :deep(h3) {
    font-size: 1.25rem;
  }
  .markdown-preview :deep(p),
  .markdown-preview :deep(ul),
  .markdown-preview :deep(ol),
  .markdown-preview :deep(blockquote),
  .markdown-preview :deep(pre),
  .markdown-preview :deep(table) {
    margin: 0.85rem 0;
  }
  .markdown-preview :deep(ul),
  .markdown-preview :deep(ol) {
    padding-left: 1.65rem;
  }
  .markdown-preview :deep(a) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .markdown-preview :deep(code) {
    border-radius: 0.3rem;
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
    padding: 0.12rem 0.3rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
  }
  .markdown-preview :deep(pre) {
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    padding: 1rem;
  }
  .markdown-preview :deep(pre code) {
    background: transparent;
    padding: 0;
  }
  .markdown-preview :deep(blockquote) {
    border-left: 3px solid var(--color-border);
    padding-left: 1rem;
    color: var(--color-text-secondary);
  }
  .markdown-preview :deep(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }
  .markdown-preview :deep(th),
  .markdown-preview :deep(td) {
    border: 1px solid var(--color-border);
    padding: 0.45rem 0.7rem;
    text-align: left;
  }
  .markdown-preview :deep(th) {
    background: var(--color-header);
  }
</style>
