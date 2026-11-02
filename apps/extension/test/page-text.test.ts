import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capReadPort, visibleExcerpt } from '../src/page-text.ts';

test('excerpt keeps visible innerText and drops nothing the caller did not pass', () => {
  assert.equal(visibleExcerpt('  Hello   page  '), 'Hello page');
  const long = 'word '.repeat(400);
  const excerpt = visibleExcerpt(long, 40);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(excerpt.length <= 41);
  assert.equal(excerpt.includes('SECRET-TOKEN'), false);
});

test('read wrapper speaks only the visible excerpt, not textContent', async () => {
  const port = {
    async getContent() {
      return { text: 'SECRET-TOKEN from textContent <script>' };
    },
  };
  const wrapped = capReadPort(port, () => 'Visible sentence SECRET-NOT-INCLUDED'.replace('SECRET-NOT-INCLUDED', 'only'));
  const text = await wrapped.getContent('text') as { text: string; source: string };
  assert.equal(text.source, 'untrusted-content');
  assert.equal(text.text, 'Visible sentence only');
  assert.equal(text.text.includes('SECRET-TOKEN'), false);
  const outline = await wrapped.getContent('outline');
  assert.deepEqual(outline, { text: 'SECRET-TOKEN from textContent <script>' });
});
