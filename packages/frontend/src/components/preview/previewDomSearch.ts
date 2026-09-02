export const PREVIEW_SEARCH_MATCH_SELECTOR = 'mark[data-preview-search-match]';

export const clearPreviewSearchMatches = (root: HTMLElement | null): void => {
  if (!root) return;
  const marks = Array.from(root.querySelectorAll<HTMLElement>(PREVIEW_SEARCH_MATCH_SELECTOR));
  const parents = new Set<Node>();
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parents.add(parent);
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
  }
  for (const parent of parents) parent.normalize();
};

export const highlightPreviewSearchMatches = (
  root: HTMLElement | null,
  query: string,
): HTMLElement[] => {
  if (!root) return [];
  clearPreviewSearchMatches(root);

  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? '';
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      return text.toLocaleLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  const matches: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const original = textNode.textContent ?? '';
    const lower = original.toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    let offset = 0;
    let matchIndex = lower.indexOf(needle, offset);

    while (matchIndex >= 0) {
      if (matchIndex > offset) fragment.append(document.createTextNode(original.slice(offset, matchIndex)));
      const mark = document.createElement('mark');
      mark.dataset.previewSearchMatch = '';
      mark.textContent = original.slice(matchIndex, matchIndex + needle.length);
      fragment.append(mark);
      matches.push(mark);
      offset = matchIndex + needle.length;
      matchIndex = lower.indexOf(needle, offset);
    }

    if (offset < original.length) fragment.append(document.createTextNode(original.slice(offset)));
    textNode.replaceWith(fragment);
  }

  return matches;
};

export const activatePreviewSearchMatch = (
  matches: HTMLElement[],
  activeIndex: number,
): HTMLElement | null => {
  matches.forEach((match, index) => {
    if (index === activeIndex) match.dataset.previewSearchActive = '';
    else delete match.dataset.previewSearchActive;
  });
  return matches[activeIndex] ?? null;
};
