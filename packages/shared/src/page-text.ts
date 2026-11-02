/**
 * Visible text for read-aloud.
 *
 * `innerText` on an element that is not rendered returns `textContent` (HTML spec).
 * A hidden heading therefore still has a non-empty `innerText`. Visibility is decided
 * from the hidden attribute, aria-hidden, computed style, and checkVisibility(),
 * including ancestors. The strings below are collected from text nodes, never from
 * `textContent` or per-element `innerText`.
 */
export const READ_EXCERPT_CHARS = 1500;

export function visibleExcerpt(innerText: string, maxChars = READ_EXCERPT_CHARS): string {
  const text = innerText.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

type ContentPort = {
  getContent: (mode?: string, chunk?: number) => Promise<unknown>;
};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

function elementHidden(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const view = el.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(el);
  if (style) {
    const contentVisibility = (style as CSSStyleDeclaration & { contentVisibility?: string }).contentVisibility;
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || contentVisibility === 'hidden') {
      return true;
    }
  }
  const probe = el as HTMLElement & { checkVisibility?: (options?: { visibilityProperty?: boolean; checkVisibilityCSS?: boolean; contentVisibilityAuto?: boolean }) => boolean };
  if (typeof probe.checkVisibility === 'function') {
    try {
      if (!probe.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return true;
    } catch {
      try {
        if (!probe.checkVisibility()) return true;
      } catch {
        /* Layout probes are optional. Computed style above still applies. */
      }
    }
  }
  return false;
}

function isShown(el: Element): boolean {
  for (let current: Element | null = el; current; current = current.parentElement) {
    if (elementHidden(current)) return false;
  }
  return true;
}

function visibleText(root: Element): string {
  if (!isShown(root)) return '';
  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (!isShown(el)) return;
    for (let i = 0; i < el.childNodes.length; i++) visit(el.childNodes[i]);
  };
  for (let i = 0; i < root.childNodes.length; i++) visit(root.childNodes[i]);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Headings the user can see, in document order. */
export function visibleHeadings(root: ParentNode): string[] {
  if (typeof root.querySelectorAll !== 'function') return [];
  const headings: string[] = [];
  root.querySelectorAll('h1, h2, h3').forEach(node => {
    if (!isShown(node)) return;
    const text = visibleText(node);
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
          text: visibleExcerpt(visibleText(root), maxChars),
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
