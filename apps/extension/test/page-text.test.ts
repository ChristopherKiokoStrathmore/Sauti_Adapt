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

/**
 * jsdom does not implement innerText. Install the browser behavior the wrapper
 * calls: rendered text only, so a switch back to textContent fails this test.
 */
function installInnerText(window: JSDOM['window']) {
  const hidden = (el: Element) => {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return true;
    if ((el as HTMLElement).hidden) return true;
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  };
  const rendered = (node: Node): string => {
    if (node.nodeType === window.Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== window.Node.ELEMENT_NODE) return '';
    if (hidden(node as Element)) return '';
    let text = '';
    for (const child of node.childNodes) text += rendered(child);
    return text;
  };
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return rendered(this); },
  });
}

test('read wrapper uses a real DOM where hidden text differs from textContent', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <h2 style="display:none">SECRET-HEADING</h2>
    <h1>Visible title<span style="display:none">SECRET-TOKEN</span></h1>
    <p>Visible sentence</p>
    <div style="display:none">SECRET-TOKEN hidden block</div>
  </body>`);
  installInnerText(dom.window);
  const { document } = dom.window;
  const secretInDom = document.documentElement.textContent || '';
  assert.match(secretInDom, /SECRET-TOKEN/);
  assert.match(secretInDom, /SECRET-HEADING/);
  assert.equal(document.body.innerText.includes('SECRET-TOKEN'), false);
  assert.equal(document.body.innerText.includes('SECRET-HEADING'), false);

  let upstreamCalls = 0;
  const port = {
    async getContent() {
      upstreamCalls += 1;
      return {
        source: 'untrusted-content',
        title: 'SECRET-TOKEN',
        text: secretInDom,
        outline: ['SECRET-HEADING', 'Visible titleSECRET-TOKEN'],
      };
    },
  };
  const wrapped = capReadPort(port, document.body);
  const text = await wrapped.getContent('text') as { text: string; title: string; source: string; outline?: unknown };
  assert.equal(text.source, 'untrusted-content');
  assert.equal(text.title, 'Visible title');
  assert.equal(text.text, visibleExcerpt(document.body.innerText));
  assert.match(text.text, /Visible title/);
  assert.match(text.text, /Visible sentence/);
  assert.equal(text.text.includes('SECRET-TOKEN'), false);
  assert.equal(text.text.includes('SECRET-HEADING'), false);
  assert.equal(text.outline, undefined);

  const outline = await wrapped.getContent('outline') as { title: string; outline: string[] };
  assert.equal(outline.title, 'Visible title');
  assert.deepEqual(outline.outline, ['Visible title']);
  assert.equal(JSON.stringify(outline).includes('SECRET'), false);
  assert.equal(upstreamCalls, 0);

  const h1 = document.querySelector('h1');
  assert.ok(h1);
  assert.match(h1.textContent || '', /SECRET-TOKEN/);
  assert.equal(h1.innerText.includes('SECRET-TOKEN'), false);
});
