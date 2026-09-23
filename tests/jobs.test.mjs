import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, resumeJob } from '../extension/core/jobs.js';
import { checkpoint } from '../extension/core/engine.js';
import { PROVIDERS, CATEGORIES } from '../extension/core/config.js';
function setup() {
  const input = { places: [{ id: 'a', country: 'KR', refs: Object.fromEntries(PROVIDERS.map(p => [p, { id: p + '-a' }])) }],
    snapshots: PROVIDERS.map(provider => ({ provider, accountId: provider, complete: true, authenticated: true, capturedAt: new Date().toISOString(),
      lists: CATEGORIES.map(category => ({ id: provider + category, category, complete: true, expectedCount: category === 'cuisine' ? 1 : 0,
        items: category === 'cuisine' ? [{ placeId: provider + '-a' }] : [] })) })) };
  input.baseline = checkpoint(input);
  for (const s of input.snapshots) s.capturedAt = new Date(Date.now() + 1).toISOString();
  for (const l of input.snapshots[0].lists) { l.items = l.category === 'bar' ? [{ placeId: 'naver-a' }] : []; l.expectedCount = l.items.length; }
  const job = createJob(input), writes = [], stored = [];
  const data = Object.fromEntries(PROVIDERS.map(p => [p, p === 'naver' ? ['bar'] : ['cuisine']]));
  const adapters = Object.fromEntries(PROVIDERS.map(p => [p, {
    async read(context) { return { ...context, categories: [...data[p]], complete: true, capturedAt: new Date().toISOString() }; },
    async setMembership(context, { category, present }) { writes.push([p, category, present]); data[p] = present ? [...new Set([...data[p], category])] : data[p].filter(c => c !== category); }
  }]));
  const save = async j => stored.push(structuredClone(j));
  return { job, data, adapters, writes, stored, save };
}
test('job verifies move destination before removing source', async () => {
  const s = setup(); await resumeJob(s.job, s.adapters, s.save);
  assert.equal(s.job.status, 'verified'); assert.deepEqual(s.writes.map(w => w[2]), [true, true, false, false]);
  assert(s.stored.some(j => j.operations[0].status === 'executing'));
});
test('response lost after write: fresh read recovers without toggling twice', async () => {
  const s = setup(), original = s.adapters.kakao.setMembership; let first = true;
  s.adapters.kakao.setMembership = async (...args) => { await original(...args); if (first) { first = false; throw Error('Response lost'); } };
  await resumeJob(s.job, s.adapters, s.save); assert.equal(s.job.status, 'blocked'); assert.equal(s.job.operations[0].status, 'unknown');
  const recovered = structuredClone(s.stored.at(-1)); await resumeJob(recovered, s.adapters, s.save);
  assert.equal(recovered.status, 'verified'); assert.equal(s.writes.filter(([p,c,on]) => p === 'kakao' && c === 'bar' && on).length, 1);
});
test('failed destination addition cannot remove old membership', async () => {
  const s = setup(); s.adapters.google.setMembership = async () => { throw Error('offline'); };
  await resumeJob(s.job, s.adapters, s.save); assert.equal(s.job.status, 'blocked');
  assert(s.writes.every(w => w[2])); assert(s.data.kakao.includes('cuisine'));
});
test('external edit after creating job blocks writes', async () => {
  const s = setup(); s.data.kakao.push('cafeteria'); await resumeJob(s.job, s.adapters, s.save);
  assert.equal(s.job.status, 'blocked'); assert.equal(s.writes.length, 0);
});
test('undo at original source blocks stale propagation', async () => {
  const s = setup(); s.data.naver = ['cuisine']; await resumeJob(s.job, s.adapters, s.save);
  assert.equal(s.job.status, 'blocked'); assert.equal(s.writes.length, 0);
});
test('partial or wrong-account fresh read prevents mutation', async () => {
  for (const bad of [{ complete: false }, { accountId: 'other' }, { providerPlaceId: 'other' }]) {
    const s = setup(), read = s.adapters.kakao.read;
    s.adapters.kakao.read = async c => ({ ...await read(c), ...bad });
    await resumeJob(s.job, s.adapters, s.save); assert.equal(s.writes.length, 0);
  }
});
test('persistence failure before write prevents side effects', async () => {
  const s = setup(); await assert.rejects(() => resumeJob(s.job, s.adapters, async () => { throw Error('disk full'); }));
  assert.equal(s.writes.length, 0);
});
test('no live adapters means no execution', async () => {
  const s = setup(); await resumeJob(s.job, {}, s.save); assert.equal(s.job.status, 'blocked'); assert.equal(s.writes.length, 0);
});
