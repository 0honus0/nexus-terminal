<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { marked } from 'marked';
	import createDOMPurify from 'dompurify';
	const { t } = useI18n();
	const artifactPreviewUrl = /^\/api\/v1\/agent\/apps\/[a-f0-9-]{36}\/artifacts\/[a-f0-9-]{36}\/preview$/;
	const purifier = createDOMPurify(window);
	purifier.addHook('uponSanitizeAttribute', (node, attribute) => {
		if (node.nodeName === 'IMG' && attribute.attrName === 'src') {
			attribute.keepAttr = artifactPreviewUrl.test(attribute.attrValue);
		}
	});
	const props = defineProps<{ text: string }>();

	// Generated images arrive as `![alt](preview)` plus a plain markdown download link.
	// Fold both into one figure so the download sits on the image instead of trailing it.
	function foldGeneratedImages(html: string): string {
		const template = document.createElement('template');
		template.innerHTML = html;
		for (const image of Array.from(template.content.querySelectorAll('img'))) {
			const source = image.getAttribute('src') ?? '';
			if (!artifactPreviewUrl.test(source)) continue;
			const downloadUrl = source.replace(/\/preview$/, '/content');
			const paragraph = image.parentElement?.tagName === 'P' ? image.parentElement : null;
			const anchor = paragraph ?? image;
			const mount = anchor.parentNode;
			const linkLabel = t('agent.files.download');
			const figure = document.createElement('figure');
			figure.className = 'agent-generated-image';
			figure.appendChild(image);
			const link = document.createElement('a');
			link.className = 'agent-generated-image__download';
			link.setAttribute('href', downloadUrl);
			link.setAttribute('download', '');
			link.setAttribute('rel', 'noopener');
			link.setAttribute('aria-label', linkLabel);
			link.setAttribute('title', linkLabel);
			const icon = document.createElement('i');
			icon.className = 'fa-solid fa-download';
			icon.setAttribute('aria-hidden', 'true');
			const label = document.createElement('span');
			label.textContent = linkLabel;
			link.append(icon, label);
			figure.appendChild(link);
			mount?.insertBefore(figure, anchor);
			if (paragraph && paragraph.childNodes.length === 0) paragraph.remove();
			const next = figure.nextElementSibling;
			if (next?.tagName === 'P') {
				const anchors = Array.from(next.querySelectorAll('a'));
				if (anchors.length === 1 && anchors[0]?.getAttribute('href') === downloadUrl) next.remove();
			}
		}
		return template.innerHTML;
	}

	const html = computed(() =>
		foldGeneratedImages(
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
		),
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
	.agent-message-body :deep(.agent-generated-image) {
		position: relative;
		width: fit-content;
		max-width: 100%;
		margin: 10px 0 4px;
	}
	.agent-message-body :deep(.agent-generated-image img) {
		display: block;
		width: auto;
		max-width: 100%;
		max-height: min(60vh, 520px);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-header);
	}
	.agent-message-body :deep(.agent-generated-image__download) {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 9px;
		border: 1px solid rgb(255 255 255 / 22%);
		border-radius: 8px;
		background: rgb(15 15 20 / 55%);
		box-shadow: 0 2px 10px rgb(0 0 0 / 22%);
		color: #fff;
		font-size: 11px;
		font-weight: 560;
		line-height: 1;
		text-decoration: none;
		-webkit-backdrop-filter: blur(8px) saturate(140%);
		backdrop-filter: blur(8px) saturate(140%);
		transition:
			background-color 140ms ease,
			border-color 140ms ease;
	}
	.agent-message-body :deep(.agent-generated-image__download:hover) {
		border-color: rgb(255 255 255 / 34%);
		background: rgb(15 15 20 / 74%);
		color: #fff;
		text-decoration: none;
	}
	.agent-message-body :deep(.agent-generated-image__download:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	@media (max-width: 420px) {
		.agent-message-body :deep(.agent-generated-image__download span) {
			display: none;
		}
		.agent-message-body :deep(.agent-generated-image__download) {
			padding: 6px;
		}
	}
</style>
