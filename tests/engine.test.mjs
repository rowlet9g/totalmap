import test from 'node:test';
import assert from 'node:assert/strict';
import { planSync, checkpoint } from '../extension/core/engine.js';
import { PROVIDERS, CATEGORIES, LIST_NAMES } from '../extension/core/config.js';
const NOW = Date.parse('2026-09-22T04:00:00Z');
const clone = structuredClone;
function fixture(cats = { naver: ['cuisine'], kakao: [], google: [] }) {
  return { places: [{ id: 'a', country: 'KR', refs: Object.fromEntries(PROVIDERS.map(p => [p, { id: `${p}-a` }])) }],
    snapshots: PROVIDERS.map(provider => ({ provider, accountId: `${provider}-account`, authenticated: true,
      complete: true, capturedAt: new Date(NOW).toISOString(), lists: CATEGORIES.map(category => ({
        category, id: `${provider}-${category}`, name: LIST_NAMES[provider][category], complete: true,
        expectedCount: cats[provider].includes(category) ? 1 : 0,
        items: cats[provider].includes(category) ? [{ placeId: `${provider}-a` }] : [] })) })) };
}
function synced() { const input = fixture(Object.fromEntries(PROVIDERS.map(p => [p, ['cuisine']]))); input.baseline = checkpoint(input, NOW); return input; }
function change(input, provider, categories) {
  const s = input.snapshots.find(s => s.provider === provider);
  for (const l of s.lists) { l.items = categories.includes(l.category) ? [{ placeId: `${provider}-a` }] : []; l.expectedCount = l.items.length; }
}
test('bootstrap unions memberships without removing existing saves', () => {
  const p = planSync(fixture(), NOW);
  assert.equal(p.issues.length, 0); assert.equal(p.operations.length, 2);
  assert(p.operations.every(op => op.kind === 'add' && op.category === 'cuisine'));
  assert.deepEqual(p.desired.a, ['cuisine']);
});
test('bootstrap preserves membership in multiple categories', () => {
  const p = planSync(fixture({ naver: ['cuisine', 'bar'], kakao: ['bar'], google: [] }), NOW);
  assert.deepEqual(p.desired.a, ['bar', 'cuisine']); assert.equal(p.operations.length, 3);
});
test('verified deletion propagates only after a baseline exists', () => {
  const input = synced(); change(input, 'naver', []);
  const p = planSync(input, NOW); assert.equal(p.operations.length, 2);
  assert(p.operations.every(op => op.kind === 'remove')); assert.deepEqual(p.desired.a, []);
});
test('move adds destination before removing source, with dependencies', () => {
  const input = synced(); change(input, 'naver', ['bar']);
  const p = planSync(input, NOW); assert.deepEqual(p.operations.map(o => o.kind), ['add', 'add', 'remove', 'remove']);
  for (const op of p.operations.slice(2)) assert.deepEqual(op.dependsOn, p.operations.slice(0, 2).map(o => o.id));
});
test('removing one category does not delete another membership', () => {
  const input = fixture(Object.fromEntries(PROVIDERS.map(p => [p, ['cuisine', 'bar']])));
  input.baseline = checkpoint(input, NOW); change(input, 'naver', ['bar']);
  const p = planSync(input, NOW); assert(p.operations.every(o => o.kind === 'remove' && o.category === 'cuisine'));
  assert.deepEqual(p.desired.a, ['bar']);
});
test('concurrent conflicting edits are not guessed', () => {
  const input = synced(); change(input, 'naver', ['bar']); change(input, 'google', ['cafeteria']);
  const p = planSync(input, NOW); assert(p.issues.some(i => i.code === 'CONFLICT')); assert.equal(p.operations.length, 0);
});
test('identical concurrent edits can propagate', () => {
  const input = synced(); change(input, 'naver', ['bar']); change(input, 'google', ['bar']);
  const p = planSync(input, NOW); assert.equal(p.issues.length, 0); assert.equal(p.operations.length, 2);
  assert(p.operations.every(o => o.provider === 'kakao'));
});
test('partial application can be replanned with stable IDs without duplicate additions', () => {
  const input = synced(); change(input, 'naver', ['bar']);
  const p = planSync(input, NOW); const original = p.operations.find(o => o.provider === 'google' && o.kind === 'add').id;
  // One full provider applied the change; another has not yet changed.
  change(input, 'kakao', ['bar']); const next = planSync(input, NOW);
  assert.equal(next.operations.length, 2); assert.equal(next.operations.find(o => o.kind === 'add').id, original);
});
test('partially applied move is conservatively a conflict without transaction journal', () => {
  const input = synced(); change(input, 'naver', ['bar']); change(input, 'kakao', ['cuisine', 'bar']);
  assert(planSync(input, NOW).issues.some(i => i.code === 'CONFLICT'));
});
test('checkpoint requires convergence; planning alone cannot advance baseline', () => {
  assert.throws(() => checkpoint(fixture(), NOW)); const input = synced();
  assert.equal(planSync(input, NOW).operations.length, 0); assert.doesNotThrow(() => checkpoint(input, NOW));
});
test('deleted membership remains as tombstone and does not resurrect', () => {
  const input = synced(); for (const p of PROVIDERS) change(input, p, []);
  input.baseline = checkpoint(input, NOW); assert.deepEqual(input.baseline.memberships.a, []);
  assert.equal(planSync(input, NOW).operations.length, 0);
});
for (const [name, mutate, code] of [
  ['incomplete provider', i => { i.snapshots[0].complete = false; }, 'INCOMPLETE_SNAPSHOT'],
  ['logged out', i => { i.snapshots[0].authenticated = false; }, 'INCOMPLETE_SNAPSHOT'],
  ['partial list', i => { i.snapshots[0].lists[0].complete = false; }, 'INCOMPLETE_LIST'],
  ['count mismatch', i => { i.snapshots[0].lists[0].expectedCount = 4; }, 'INCOMPLETE_LIST'],
  ['missing service', i => { i.snapshots.pop(); }, 'MISSING_PROVIDER'],
  ['missing category', i => { i.snapshots[0].lists.pop(); }, 'MISSING_LIST'],
  ['stale read', i => { i.snapshots[0].capturedAt = new Date(NOW - 31*60_000).toISOString(); }, 'STALE_SNAPSHOT'],
  ['future read', i => { i.snapshots[0].capturedAt = new Date(NOW + 120_000).toISOString(); }, 'STALE_SNAPSHOT'],
  ['account switch', i => { i.snapshots[0].accountId = 'another-person'; }, 'ACCOUNT_CHANGED'],
  ['list replacement', i => { i.snapshots[0].lists[0].id = 'another-list'; }, 'LIST_CHANGED'],
  ['identity lost', i => { i.places = []; }, 'LOST_IDENTITY'],
  ['identity relinked', i => { i.places[0].refs.naver.id = 'wrong-shop'; }, 'IDENTITY_CHANGED'],
  ['older than baseline', i => { i.snapshots[0].capturedAt = new Date(NOW - 1000).toISOString(); }, 'OLD_READ'],
]) test(`${name} prevents operations`, () => {
  const input = synced(); change(input, 'naver', []); mutate(input);
  const p = planSync(input, NOW); assert(p.issues.some(i => i.code === code)); assert.equal(p.operations.length, 0);
});
test('list rename keeps ID binding', () => {
  const input = synced(); input.snapshots[0].lists[0].name = '명소'; assert.equal(planSync(input, NOW).issues.length, 0);
});
test('overseas and unknown country are never propagated', () => {
  for (const country of ['JP', 'UNKNOWN', null]) {
    const input = fixture(); input.places[0].country = country;
    const p = planSync(input, NOW); assert.equal(p.operations.length, 0); assert.equal(p.excluded.length, 1);
  }
});
test('Google ignored lists cannot generate changes', () => {
  const input = synced(); input.snapshots[2].lists.push({ name: 'Saved places', category: 'ignored', items: [{ placeId: 'anything' }] });
  assert.equal(planSync(input, NOW).operations.length, 0); assert.equal(planSync(input, NOW).issues.length, 0);
});
test('duplicate rows invalidate count evidence', () => {
  const input = fixture(); const list = input.snapshots[0].lists.find(l => l.category === 'cuisine');
  list.items.push(clone(list.items[0])); list.expectedCount = 2;
  assert(planSync(input, NOW).issues.some(i => i.code === 'INCOMPLETE_LIST'));
});
test('same provider place cannot identify two canonical places', () => {
  const input = fixture(); input.places.push({ ...clone(input.places[0]), id: 'b' });
  assert(planSync(input, NOW).issues.some(i => i.code === 'AMBIGUOUS_LINK'));
});
test('unmatched IDs must be resolved before checkpoint', () => {
  const input = fixture(); input.snapshots[0].lists[1].items[0].placeId = 'new-shop';
  assert(planSync(input, NOW).issues.some(i => i.code === 'UNMATCHED_PLACE'));
  assert.throws(() => checkpoint(input, NOW));
});
test('unknown destination is not represented as successful matching', () => {
  const input = fixture(); delete input.places[0].refs.google;
  assert(planSync(input, NOW).issues.some(i => i.code === 'MISSING_TARGET'));
});
test('notes never become operations', () => {
  const input = synced(); input.snapshots[0].lists[1].items[0].note = 'private note';
  const p = planSync(input, NOW); assert.equal(p.operations.length, 0); assert(!JSON.stringify(p).includes('private note'));
});
