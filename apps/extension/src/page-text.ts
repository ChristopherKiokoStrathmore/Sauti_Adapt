/** Visible text for "read this". Uses the string from element.innerText, never textContent. */
export const READ_EXCERPT_CHARS = 1500;

export function visibleExcerpt(innerText: string, maxChars = READ_EXCERPT_CHARS): string {
  const text = innerText.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

type ContentPort = {
  getContent: (mode?: string, chunk?: number) => Promise<unknown>;
};

/** Wraps an upstream ControlPort. Does not change the toolkit source. */
export function capReadPort<T extends ContentPort>(port: T, readInnerText: () => string, maxChars = READ_EXCERPT_CHARS): T {
  return {
    ...port,
    async getContent(mode = 'outline', chunk?: number) {
      if (mode === 'text') {
        return {
          source: 'untrusted-content',
          title: '',
          text: visibleExcerpt(readInnerText(), maxChars),
          chunk: 0,
          totalChunks: 1,
        };
      }
      return port.getContent(mode, chunk);
    },
  };
}
