/** Visible text for read-aloud. Reads `innerText`, which is empty for unrendered nodes, and never `textContent`. */
export const READ_EXCERPT_CHARS = 1500;

export function visibleExcerpt(innerText: string, maxChars = READ_EXCERPT_CHARS): string {
  const text = innerText.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

type ContentPort = {
  getContent: (mode?: string, chunk?: number) => Promise<unknown>;
};

function readInnerText(node: Element): string {
  const value = (node as { innerText?: unknown }).innerText;
  return typeof value === 'string' ? value : '';
}

/** Headings the user can see, in document order. A hidden heading has empty `innerText`. */
export function visibleHeadings(root: ParentNode): string[] {
  if (typeof root.querySelectorAll !== 'function') return [];
  const headings: string[] = [];
  root.querySelectorAll('h1, h2, h3').forEach(node => {
    const text = readInnerText(node).replace(/\s+/g, ' ').trim();
    if (text) headings.push(text);
  });
  return headings;
}

/** Wraps an upstream ControlPort. Does not change the toolkit source. */
export function capReadPort<T extends ContentPort>(port: T, root: HTMLElement, maxChars = READ_EXCERPT_CHARS): T {
  return {
    ...port,
    async getContent(mode = 'outline', chunk?: number) {
      const headings = visibleHeadings(root);
      const title = headings[0] ?? '';
      if (mode === 'text') {
        return {
          source: 'untrusted-content',
          title,
          text: visibleExcerpt(readInnerText(root), maxChars),
          chunk: 0,
          totalChunks: 1,
        };
      }
      if (mode === 'outline') {
        return { source: 'untrusted-content', title, outline: headings };
      }
      return port.getContent(mode, chunk);
    },
  };
}
