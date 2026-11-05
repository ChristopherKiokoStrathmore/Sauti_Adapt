import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { capReadPort, visibleExcerpt } from '../../../packages/shared/src/page-text.ts';

test('excerpt trims visible text and caps the length', () => {
  assert.equal(visibleExcerpt('  Hello   page  '), 'Hello page');
  const long = 'word '.repeat(400);
  const excerpt = visibleExcerpt(long, 40);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(excerpt.length <= 41);
  assert.equal(excerpt.startsWith('word'), true);
});

test('read wrapper ignores hidden text even when innerText returns textContent', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <h2 style="display:none">SECRET-DISPLAY</h2>
    <h2 style="visibility:hidden">SECRET-VISIBILITY</h2>
    <h2 hidden>SECRET-HIDDEN-ATTR</h2>
    <h2 aria-hidden="true">SECRET-ARIA</h2>
    <h1>Visible title<span style="display:none">SECRET-NESTED</span></h1>
    <p>Visible sentence</p>
  </body>`);
  // HTML spec: innerText of an element that is not rendered returns textContent.
  // A wrapper that trusts per-element innerText would speak these secrets.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent; },
  });
  const { document } = dom.window;
  const displayHeading = document.querySelector('h2');
  assert.ok(displayHeading);
  assert.match(displayHeading.textContent || '', /SECRET-DISPLAY/);
  assert.match(String(displayHeading.innerText), /SECRET-DISPLAY/);

  let upstreamCalls = 0;
  const port = {
    async getContent() {
      upstreamCalls += 1;
      return { text: 'SECRET-DISPLAY', outline: ['SECRET-ARIA'], title: 'SECRET-VISIBILITY' };
    },
  };
  const wrapped = capReadPort(port, document.body);
  const text = await wrapped.getContent('text') as { text: string; title: string; outline?: unknown };
  assert.equal(text.title, 'Visible title');
  assert.match(text.text, /Visible title/);
  assert.match(text.text, /Visible sentence/);
  assert.equal(text.outline, undefined);
  for (const secret of ['SECRET-DISPLAY', 'SECRET-VISIBILITY', 'SECRET-HIDDEN-ATTR', 'SECRET-ARIA', 'SECRET-NESTED']) {
    assert.equal(text.text.includes(secret), false, secret);
    assert.equal(text.title.includes(secret), false, secret);
  }

  const outline = await wrapped.getContent('outline') as { title: string; outline: string[] };
  assert.equal(outline.title, 'Visible title');
  assert.deepEqual(outline.outline, ['Visible title']);
  assert.equal(JSON.stringify(outline).includes('SECRET'), false);
  assert.equal(upstreamCalls, 0);
});
