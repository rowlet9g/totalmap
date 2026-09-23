import { planSync } from './engine.js';
import { CATEGORIES, PROVIDERS } from './config.js';

const equal = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const contextKey = op => JSON.stringify([op.provider, op.placeId]);
const after = (categories, op) => op.kind === 'add'
  ? [...new Set([...categories, op.category])].sort()
  : categories.filter(c => c !== op.category).sort();

/** Generic durable job protocol. No live service adapters are shipped in this version. */
export function createJob(input, now = Date.now()) {
  const plan = planSync(input, now);
  if (plan.issues.length) throw Error('미해결 사항이 있는 계획은 실행 작업으로 만들 수 없습니다.');
  const contexts = {}, expected = {};
  for (const placeId of new Set(plan.operations.map(op => op.placeId))) for (const provider of PROVIDERS) {
    const place = input.places.find(place => place.id === placeId);
    const providerPlaceId = place.refs[provider]?.id;
    if (!providerPlaceId) continue;
    const k = contextKey({ provider, placeId }), s = input.snapshots.find(s => s.provider === provider);
    contexts[k] = { provider, placeId, providerPlaceId, accountId: s.accountId,
      listIds: Object.fromEntries(s.lists.filter(l => CATEGORIES.includes(l.category)).map(l => [l.category, l.id])) };
    expected[k] = s.lists.filter(l => CATEGORIES.includes(l.category) && l.items.some(i => i.placeId === providerPlaceId)).map(l => l.category).sort();
  }
  return { version: 1, id: crypto.randomUUID(), status: 'pending', createdAt: new Date(now).toISOString(),
    contexts, expected, desired: plan.desired,
    operations: plan.operations.map(op => ({ ...op, status: 'pending' })), events: [] };
}

/** save must persist atomically and reject on failure; callers must serialize per account.
 * adapters[p].read(context) -> {accountId, providerPlaceId, listIds, categories, complete, capturedAt}
 * adapters[p].setMembership(context, {listId, category, present}) must SET, never blindly toggle.
 */
export async function resumeJob(job, adapters, save, now = () => Date.now()) {
  if (job.version !== 1) throw Error('지원하지 않는 작업 기록입니다.');
  const persist = async () => save(structuredClone(job));
  const event = (kind, op, message) => job.events.push({ at: new Date(now()).toISOString(), kind, operationId: op.id, message });
  const read = async op => {
    const context = job.contexts[contextKey(op)], adapter = adapters[op.provider];
    if (!adapter?.read || !adapter?.setMembership) throw Error(`${op.provider}: 검증된 서비스 어댑터가 연결되지 않았습니다.`);
    const result = await adapter.read(context);
    const timestamp = Date.parse(result?.capturedAt);
    if (result?.complete !== true || !Number.isFinite(timestamp) || now() - timestamp > 120_000 || timestamp > now() + 60_000 ||
        result.accountId !== context.accountId || result.providerPlaceId !== context.providerPlaceId ||
        CATEGORIES.some(c => result.listIds?.[c] !== context.listIds[c]) ||
        !Array.isArray(result.categories) || result.categories.some(c => !CATEGORIES.includes(c)) ||
        new Set(result.categories).size !== result.categories.length)
      throw Error('현재 계정·장소·목록·전체 소속을 검증하지 못했습니다.');
    return result.categories;
  };
  job.status = 'running'; await persist();
  for (const op of job.operations) {
    if (op.status === 'verified') continue;
    try {
      // Include the source provider: the user may undo their edit while propagation runs.
      for (const [otherKey, context] of Object.entries(job.contexts)) {
        if (context.placeId === op.placeId && otherKey !== contextKey(op) &&
            !equal(await read(context), job.expected[otherKey]))
          throw Error('다른 지도에서 작업 중 새 변경이 감지되었습니다.');
      }
      // Dependencies are re-read, not merely trusted from a prior success response.
      for (const id of op.dependsOn) {
        const dependency = job.operations.find(other => other.id === id);
        if (!dependency || dependency.status !== 'verified' || !(await read(dependency)).includes(dependency.category))
          throw Error('이동 대상 분류의 저장을 다시 확인하지 못했습니다.');
      }
      const k = contextKey(op), before = job.expected[k], expectedAfter = after(before, op);
      const current = await read(op);
      if (['executing', 'unknown'].includes(op.status) && equal(current, expectedAfter)) {
        job.expected[k] = expectedAfter; op.status = 'verified'; event('recovered', op, '응답 유실 후 실제 반영 상태를 확인했습니다.'); await persist(); continue;
      }
      if (!equal(current, before)) throw Error('작업 시작 후 사용자의 추가 변경이 감지되었습니다.');
      op.status = 'executing'; event('started', op, '변경 전 상태 확인'); await persist();
      await adapters[op.provider].setMembership(job.contexts[k], { listId: op.listId, category: op.category, present: op.desiredPresent });
      if (!equal(await read(op), expectedAfter)) throw Error('변경 후 실제 소속 검증에 실패했습니다.');
      job.expected[k] = expectedAfter; op.status = 'verified'; event('verified', op, '변경 후 상태 확인'); await persist();
    } catch (error) {
      if (op.status === 'executing') op.status = 'unknown';
      job.status = 'blocked'; event('blocked', op, error.message); await persist(); return job;
    }
  }
  // Final recheck also catches edits to an earlier place while later places were being processed.
  for (const [k, expected] of Object.entries(job.expected)) {
    const op = job.operations.find(op => contextKey(op) === k) ?? { ...job.contexts[k], id: `verify:${k}` };
    try { if (!equal(await read(op), expected)) throw Error('작업 중 다른 변경이 발생했습니다.'); }
    catch (error) { job.status = 'blocked'; event('blocked', op, error.message); await persist(); return job; }
  }
  job.status = 'verified'; await persist(); return job;
}
