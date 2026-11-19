/** Interact.js 显式命中区域；不按距离猜测边缘，避免抢占滚动条或正文。 */
export const uiResizeEdges = {
	top: '[data-ui-resize-edges~="top"]',
	right: '[data-ui-resize-edges~="right"]',
	bottom: '[data-ui-resize-edges~="bottom"]',
	left: '[data-ui-resize-edges~="left"]',
} as const;
