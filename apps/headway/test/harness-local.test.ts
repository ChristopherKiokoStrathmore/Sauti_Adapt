import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocal, spokenDigits, matchAffordances, riskOf, needsConfirmation, maskedReadBack, type Affordance,
} from '../src/harness/local.ts';

const TILES: Affordance[] = [
  { id: 'h1', kind: 'link', name: 'Apply for a Passport', submit: false },
  { id: 'h2', kind: 'link', name: 'Apply for a Birth Certificate', submit: false },
  { id: 'h3', kind: 'link', name: 'Apply for Certificate of Good Conduct', submit: false },
  { id: 'h4', kind: 'link', name: 'Apply for a Marriage Certificate', submit: false },
  { id: 'h5', kind: 'button', name: 'Sign in', submit: false },
  { id: 'h6', kind: 'button', name: 'Sign up', submit: false },
  { id: 'h7', kind: 'button', name: 'Pay KSh 1,050', submit: true },
];

test('everyday commands in English and Kiswahili', () => {
  assert.deepEqual(parseLocal('Scroll down.'), { kind: 'scroll', direction: 'down' });
  assert.deepEqual(parseLocal('shuka chini'), { kind: 'scroll', direction: 'down' });
  assert.deepEqual(parseLocal('Panda juu'), { kind: 'scroll', direction: 'up' });
  assert.deepEqual(parseLocal('rudi nyuma'), { kind: 'back' });
  assert.deepEqual(parseLocal('Read this to me'), { kind: 'read' });
  assert.deepEqual(parseLocal('nisomee'), { kind: 'read' });
  assert.deepEqual(parseLocal('Ndiyo'), { kind: 'yes' });
  assert.deepEqual(parseLocal('hapana'), { kind: 'no' });
  assert.deepEqual(parseLocal('mbili'), { kind: 'choice', index: 1 });
  assert.deepEqual(parseLocal('number three'), { kind: 'choice', index: 2 });
  assert.deepEqual(parseLocal('enable this website'), { kind: 'enable-site' });
});

test('spoken numbers become digits, never words', () => {
  assert.equal(spokenDigits('one two three four five six seven eight'), '12345678');
  assert.equal(spokenDigits('moja mbili tatu nne'), '1234');
  assert.equal(spokenDigits('zero seven double two'), '0722');
  assert.equal(spokenDigits('0 7 2 2 5'), '07225');
  assert.equal(spokenDigits('one two banana'), null);
});

test('typing an ID number by voice', () => {
  assert.deepEqual(parseLocal('type one two three four five six seven eight'), { kind: 'type', text: '12345678', numeric: true });
  assert.deepEqual(parseLocal('my ID number is 3 4 5 6 7 8 9 0'), { kind: 'type', text: '34567890', numeric: true });
  assert.deepEqual(parseLocal('namba yangu ni moja mbili tatu nne'), { kind: 'type', text: '1234', numeric: true });
  assert.deepEqual(parseLocal('andika Nairobi'), { kind: 'type', text: 'Nairobi', numeric: false });
});

test('passwords are never dictated: the request is recognised so Headway can guide her', () => {
  assert.deepEqual(parseLocal('enter my password'), { kind: 'password' });
  assert.deepEqual(parseLocal('weka nenosiri'), { kind: 'password' });
});

test('click by name: one clear match, several, or none', () => {
  assert.deepEqual(parseLocal('click good conduct'), { kind: 'click', label: 'good conduct' });
  assert.deepEqual(parseLocal('bonyeza sign in'), { kind: 'click', label: 'sign in' });
  assert.deepEqual(matchAffordances('good conduct', TILES).map((a) => a.id), ['h3']);
  assert.deepEqual(matchAffordances('sign in', TILES).map((a) => a.id), ['h5'], 'whole words: "in" is not "up"');
  assert.equal(matchAffordances('certificate', TILES).length, 3, 'several: she is asked, nothing is clicked');
  assert.deepEqual(matchAffordances('police clearance', TILES), [], 'no match: goes to Gemini');
  assert.deepEqual(matchAffordances('sign', TILES).map((a) => a.id).sort(), ['h5', 'h6'], 'never substring-first');
});

test('risk and confirmation: submit always asks, other clicks follow her choice', () => {
  assert.equal(riskOf(TILES[6]), 'submit');
  assert.equal(riskOf({ kind: 'button', name: 'Tuma', submit: false }), 'submit');
  assert.equal(riskOf({ kind: 'password', name: 'Password', submit: false }), 'secret');
  assert.equal(riskOf(TILES[2]), 'change');
  assert.equal(needsConfirmation('submit', 'never'), true);
  assert.equal(needsConfirmation('change', 'forms'), false);
  assert.equal(needsConfirmation('change', 'always'), true);
  assert.equal(needsConfirmation('navigate', 'always'), false);
});

test('read-back never repeats a number or a password', () => {
  assert.equal(maskedReadBack('12345678', 'number'), 'number ending in 7 8 entered');
  assert.equal(maskedReadBack('12345678', 'textbox'), 'number ending in 7 8 entered');
  assert.equal(maskedReadBack('hunter22', 'password'), '8 characters entered');
  assert.equal(maskedReadBack('Nairobi', 'textbox'), '"Nairobi" entered');
});

// ---- review fixes
import { looksSecret, choiceIndex, knownSite } from '../src/harness/local.ts';

test('secrets stay local however she phrases them', () => {
  for (const s of ['ID number one two three four five six seven eight', 'namba ya simu ni sifuri saba moja mbili',
    'my password is hunter2', 'the code is 4 4 5 6', 'nenosiri langu', 'my pin']) assert.equal(looksSecret(s), true, s);
  for (const s of ['scroll down', 'I need a police clearance', 'click good conduct', 'open the first one']) assert.equal(looksSecret(s), false, s);
});

test('typing extraction is exact', () => {
  assert.deepEqual(parseLocal('enter my ID number'), { kind: 'none' });
  assert.deepEqual(parseLocal('Write it is ok'), { kind: 'type', text: 'it is ok', numeric: false });
  assert.deepEqual(parseLocal('type my ID number one two three four'), { kind: 'type', text: '1234', numeric: true });
});

test('ambiguity: several elements that fit are always offered', () => {
  const login = [
    { id: 'h1', kind: 'link' as const, name: 'LOGIN', submit: false },
    { id: 'h2', kind: 'button' as const, name: 'Login with eCitizen', submit: false },
    { id: 'h3', kind: 'button' as const, name: 'Login with OTP', submit: false },
  ];
  assert.equal(matchAffordances('login', login).length, 1, 'her exact words name one element: that one');
  assert.equal(matchAffordances('log in with', login).length, 0);
  const passports = [
    { id: 'p1', kind: 'link' as const, name: 'Apply for a Passport', submit: false },
    { id: 'p2', kind: 'link' as const, name: 'Apply for a Passport Renewal', submit: false },
  ];
  assert.deepEqual(matchAffordances('apply for a passport', passports).map((a) => a.id), ['p1']);
  assert.equal(matchAffordances('passport', passports).length, 2);
});

test('submit-level words include continue, save, reset and Kiswahili', () => {
  for (const name of ['Continue', 'Proceed', 'Save', 'Wasilisha', 'Endelea', 'PayBill', 'Reset', 'Next']) {
    assert.equal(riskOf({ kind: 'button', name, submit: false }), 'submit', name);
  }
});

test('choices, tick/untick, known sites and search', () => {
  assert.equal(choiceIndex('two'), 1);
  assert.equal(choiceIndex('namba mbili'), 1);
  assert.deepEqual(parseLocal('untick I agree'), { kind: 'click', label: 'i agree', check: false });
  assert.deepEqual(parseLocal('tick I agree'), { kind: 'click', label: 'i agree', check: true });
  assert.deepEqual(parseLocal('Open eCitizen'), { kind: 'open', url: 'https://accounts.ecitizen.go.ke/en', site: 'ecitizen' });
  assert.deepEqual(parseLocal('fungua KRA'), { kind: 'open', url: 'https://itax.kra.go.ke/', site: 'kra' });
  assert.equal(knownSite('the ecitizen website')?.site, 'ecitizen');
  assert.deepEqual(parseLocal('search for KRA PIN checker'), { kind: 'search', query: 'kra pin checker' });
  assert.notEqual(parseLocal('search for 1 2 3 4 5 6').kind, 'search', 'a number is never searched on the web');
});
