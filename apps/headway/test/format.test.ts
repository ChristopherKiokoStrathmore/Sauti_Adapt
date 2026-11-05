import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAISummary, escapeHtml } from '../src/shared/format.ts';

test('a sentence starting "I think" is a paragraph, not a bullet (Nutshell regex bug)', () => {
  const html = formatAISummary('I think this is fine.');
  assert.equal(html, '<p>I think this is fine.</p>');
  assert.ok(!html.includes('<li>'));
});

test('*, - and • markers become one list', () => {
  const html = formatAISummary('* one\n- two\n• three');
  assert.equal(html, '<ul><li>one</li><li>two</li><li>three</li></ul>');
});

test('numbered lines become list items', () => {
  assert.equal(formatAISummary('1. first\n2. second'), '<ul><li>first</li><li>second</li></ul>');
});

test('model output is escaped before any tag is added', () => {
  const html = formatAISummary('<img src=x onerror=alert(1)> **bold**');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('headings are not wrapped in paragraphs', () => {
  assert.equal(formatAISummary('## Key points\n\nBody'), '<h3>Key points</h3><p>Body</p>');
});

test('empty input gives empty output', () => {
  assert.equal(formatAISummary(''), '');
});

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;');
});
