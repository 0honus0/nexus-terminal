<script setup lang="ts">
	import { computed } from 'vue';
	import { marked } from 'marked';
	import createDOMPurify from 'dompurify';
	const purifier = createDOMPurify(window);
	purifier.addHook('uponSanitizeAttribute', (node, attribute) => {
		if (node.nodeName === 'IMG' && attribute.attrName === 'src') {
			attribute.keepAttr = /^\/api\/v1\/agent\/apps\/[a-f0-9-]{36}\/artifacts\/[a-f0-9-]{36}\/preview$/.test(
				attribute.attrValue,
			);
		}
	});
	const props = defineProps<{ text: string }>();
	const html = computed(() =>
		purifier.sanitize(marked.parse(props.text, { async: false, breaks: true }), {
			ALLOWED_TAGS: [
				'p',
				'img',
				'br',
				'strong',
				'em',
				'del',
				'code',
				'pre',
				'blockquote',
				'ul',
				'ol',
				'li',
				'h1',
				'h2',
				'h3',
				'h4',
				'hr',
				'a',
				'table',
				'thead',
				'tbody',
				'tr',
				'th',
				'td',
			],
			ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt'],
		}),
	);
</script>
<template><div class="agent-message-body" v-html="html"></div></template>
<style scoped>
	.agent-message-body {
		font-size: 14px;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	.agent-message-body :deep(p) {
		margin: 0 0 0.85em;
	}
	.agent-message-body :deep(p:last-child) {
		margin-bottom: 0;
	}
	.agent-message-body :deep(h1),
	.agent-message-body :deep(h2),
	.agent-message-body :deep(h3),
	.agent-message-body :deep(h4) {
		font-size: 1.1em;
		font-weight: 650;
		margin: 1.1em 0 0.5em;
	}
	.agent-message-body :deep(ul),
	.agent-message-body :deep(ol) {
		padding-left: 1.5em;
		margin: 0.6em 0;
	}
	.agent-message-body :deep(ul) {
		list-style: disc;
	}
	.agent-message-body :deep(ol) {
		list-style: decimal;
	}
	.agent-message-body :deep(pre) {
		max-width: 100%;
		overflow: auto;
		padding: 14px;
		margin: 12px 0;
		border-radius: 10px;
		background: var(--color-header);
		font-size: 12px;
		line-height: 1.65;
	}
	.agent-message-body :deep(code) {
		font-family: var(--font-family-monospace);
		background: var(--color-header);
		border-radius: 4px;
		padding: 1px 4px;
	}
	.agent-message-body :deep(pre code) {
		padding: 0;
	}
	.agent-message-body :deep(a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.agent-message-body :deep(blockquote) {
		border-left: 3px solid var(--color-border);
		padding-left: 12px;
		color: var(--color-text-secondary);
	}
	.agent-message-body :deep(table) {
		display: block;
		max-width: 100%;
		overflow: auto;
		border-collapse: collapse;
		margin: 12px 0;
	}
	.agent-message-body :deep(th),
	.agent-message-body :deep(td) {
		border: 1px solid var(--color-border);
		padding: 6px 10px;
		text-align: left;
	}
</style>
