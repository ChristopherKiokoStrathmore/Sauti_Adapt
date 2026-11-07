import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMAND_DEFS, normalize, phrasesFor, wordMatch, markWords, matchCommand, learnAlias, type ChosenCommand,
} from '../src/voice/commands.ts';

const chosen = (): ChosenCommand[] => [
  { id: 'scroll-down', phrases: ['Scroll down', 'Shuka chini'], aliases: [] },
  { id: 'go-back', phrases: ['Go back'], aliases: [] },
];

test('normalize ignores case, punctuation and accents', () => {
  assert.equal(normalize('  Scroll, DOWN!  '), 'scroll down');
  assert.equal(normalize('Café'), 'cafe');
});

test('both languages offer the English and Kiswahili phrase', () => {
  const def = COMMAND_DEFS.find((d) => d.id === 'scroll-down')!;
  assert.deepEqual(phrasesFor(def, 'both'), ['Scroll down', 'Shuka chini']);
  assert.deepEqual(phrasesFor(def, 'sw'), ['Shuka chini']);
});

test('only an exact phrase or a learned alias counts: anything else is not sure', () => {
  const c = chosen();
  assert.equal(matchCommand('scroll down.', c), 'scroll-down');
  assert.equal(matchCommand('shuka chini', c), 'scroll-down');
  assert.equal(matchCommand('school town', c), null);
  assert.equal(matchCommand('scroll down please', c), null);
  assert.equal(matchCommand('', c), null);
});

test('a mis-heard take becomes an alias for the command she was reading', () => {
  const c = chosen();
  assert.equal(learnAlias(c, 'scroll-down', 'School town'), 'school town');
  assert.equal(matchCommand('school town', c), 'scroll-down');
});

test('an alias is never learned when the text already means another command', () => {
  const c = chosen();
  assert.equal(learnAlias(c, 'scroll-down', 'go back'), null);
  assert.equal(matchCommand('go back', c), 'go-back');
  assert.equal(learnAlias(c, 'scroll-down', 'scroll down'), null, 'already understood: nothing to learn');
});

test('word match and word marking', () => {
  assert.equal(wordMatch('scroll down', 'scroll down'), 1);
  assert.equal(wordMatch('scroll down', 'scroll town'), 0.5);
  assert.deepEqual(markWords('scroll down', 'scroll town'), [{ word: 'scroll', right: true }, { word: 'town', right: false }]);
});
