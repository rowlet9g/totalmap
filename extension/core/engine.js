import { PROVIDERS, CATEGORIES } from './config.js';

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const key = (provider, id) => JSON.stringify([provider, id]);
const nonempty = value => typeof value === 'string' && value.length > 0;
const memberships = (index, id, provider) => index.get(key(provider, id)) ?? [];

/** Pure planning: never performs network requests or changes a map account. */
export function planSync(input, now = Date.now()) {
  const { snapshots = [], places = [], baseline = null } = input;
  const issues = [], operations = [], excluded = [], desired = {};
  const result = () => ({ version: 1, phase: baseline ? 'incremental' : 'bootstrap',
    generatedAt: new Date(now).toISOString(), issues, operations, excluded, desired,
    canCheckpoint: issues.length === 0 && operations.length === 0 });
  const block = (code, detail) => issues.push({ code, detail });
  const byProvider = new Map();
  for (const s of snapshots) {
    if (!PROVIDERS.includes(s?.provider) || byProvider.has(s.provider)) {
      block('SNAPSHOT_PROVIDER', '서비스별 스냅샷은 정확히 하나여야 합니다.'); continue;
    }
    byProvider.set(s.provider, s);
    const time = Date.parse(s.capturedAt);
    if (!Number.isFinite(time) || time > now + 60_000 || now - time > 30 * 60_000)
      block('STALE_SNAPSHOT', `${s.provider}: 30분 이내의 최신 조회가 필요합니다.`);
    if (!nonempty(s.accountId) || s.authenticated !== true || s.complete !== true)
      block('INCOMPLETE_SNAPSHOT', `${s.provider}: 로그인 계정과 전체 조회를 확인해야 합니다.`);
    const cats = new Set(), listIds = new Set();
    for (const list of s.lists ?? []) {
      // Ignore out-of-scope lists entirely, including Google Saved places / travel.
      if (!CATEGORIES.includes(list.category)) continue;
      if (cats.has(list.category) || !nonempty(list.id) || listIds.has(list.id))
        block('LIST_BINDING', `${s.provider}: 목록 ID 또는 분류 연결이 중복/누락되었습니다.`);
      cats.add(list.category); listIds.add(list.id);
      const items = list.items ?? [];
      const ids = items.map(i => i.placeId);
      if (list.complete !== true || !Number.isInteger(list.expectedCount) ||
          list.expectedCount !== items.length || ids.some(id => !nonempty(id)) || new Set(ids).size !== ids.length)
        block('INCOMPLETE_LIST', `${s.provider}/${list.category}: 표시 개수와 고유 항목 수가 일치해야 합니다.`);
    }
    if (cats.size !== CATEGORIES.length) block('MISSING_LIST', `${s.provider}: 네 분류의 목록 연결이 필요합니다.`);
  }
  if (byProvider.size !== PROVIDERS.length) block('MISSING_PROVIDER', '세 서비스의 전체 조회가 필요합니다.');
  if (baseline) {
    if (baseline.version !== 1 || !baseline.memberships || !baseline.accounts || !baseline.listIds || !baseline.refs ||
        !Number.isFinite(Date.parse(baseline.createdAt)) ||
        Object.values(baseline.memberships).some(cats => !Array.isArray(cats) || cats.some(c => !CATEGORIES.includes(c))))
      block('INVALID_BASELINE', '유효한 기준 상태가 아닙니다.');
    else for (const provider of PROVIDERS) {
      const s = byProvider.get(provider);
      if (s?.accountId !== baseline.accounts[provider]) block('ACCOUNT_CHANGED', `${provider}: 연결된 계정이 달라졌습니다.`);
      if (Date.parse(s?.capturedAt) < Date.parse(baseline.createdAt)) block('OLD_READ', `${provider}: 기준 상태보다 오래된 조회입니다.`);
      for (const list of s?.lists ?? []) if (CATEGORIES.includes(list.category) &&
          list.id !== baseline.listIds[provider]?.[list.category])
        block('LIST_CHANGED', `${provider}/${list.category}: 목록 연결이 달라졌습니다.`);
    }
  }
  const refs = new Map(), placeIds = new Set();
  for (const place of places) {
    if (!nonempty(place.id) || placeIds.has(place.id)) block('PLACE_ID', '통합 장소 ID가 중복/누락되었습니다.');
    placeIds.add(place.id);
    for (const provider of PROVIDERS) {
      const ref = place.refs?.[provider];
      if (ref === undefined) continue;
      if (!nonempty(ref.id) || refs.has(key(provider, ref.id))) block('AMBIGUOUS_LINK', `${provider}: 장소 연결이 중복/누락되었습니다.`);
      else refs.set(key(provider, ref.id), place.id);
    }
  }
  if (baseline) for (const id of Object.keys(baseline.memberships ?? {}))
    if (!placeIds.has(id)) block('LOST_IDENTITY', '기준 상태의 장소 연결이 사라졌습니다.');
  if (baseline?.refs) for (const place of places) for (const provider of PROVIDERS) {
    const before = baseline.refs[place.id]?.[provider];
    if (before !== undefined && before !== place.refs?.[provider]?.id)
      block('IDENTITY_CHANGED', `${place.id}/${provider}: 확정된 장소 연결이 달라졌습니다.`);
  }
  if (issues.length) return result(); // No destructive inference from a partial or wrong-account read.

  const index = new Map();
  for (const [provider, s] of byProvider) for (const list of s.lists) {
    if (!CATEGORIES.includes(list.category)) continue;
    for (const item of list.items) {
      const id = refs.get(key(provider, item.placeId));
      if (!id) { block('UNMATCHED_PLACE', `${provider}/${item.placeId}: 동일 장소 연결이 필요합니다.`); continue; }
      const k = key(provider, id), cats = index.get(k) ?? [];
      cats.push(list.category); index.set(k, cats);
    }
  }
  for (const place of places) {
    if (place.country !== 'KR') {
      excluded.push({ placeId: place.id, reason: place.country && place.country !== 'UNKNOWN' ? 'OVERSEAS' : 'COUNTRY_UNKNOWN' });
      // Never advance an existing domestic baseline while country resolution is uncertain.
      if (baseline?.memberships[place.id]) block('COUNTRY_CHANGED', `${place.id}: 기존 국내 장소의 국가 정보가 달라졌습니다.`);
      continue;
    }
    const current = Object.fromEntries(PROVIDERS.map(p => [p, memberships(index, place.id, p)]));
    let target;
    if (!baseline) target = [...new Set(Object.values(current).flat())].sort();
    else {
      const before = baseline.memberships[place.id] ?? [];
      const changed = PROVIDERS.filter(p => !same(current[p], before));
      if (changed.length > 1 && changed.some(p => !same(current[p], current[changed[0]]))) {
        block('CONFLICT', `${place.id}: 서비스별 분류 변경이 충돌합니다.`); continue;
      }
      target = [...(changed.length ? current[changed[0]] : before)].sort();
    }
    desired[place.id] = target;
    const additions = [], removals = [];
    for (const provider of PROVIDERS) {
      if (!place.refs?.[provider] && target.length) {
        block('MISSING_TARGET', `${place.id}/${provider}: 대상 지도 장소 연결이 필요합니다.`); continue;
      }
      for (const category of CATEGORIES) {
        const had = current[provider].includes(category), want = target.includes(category);
        if (had === want) continue;
        const kind = want ? 'add' : 'remove';
        const listId = byProvider.get(provider).lists.find(l => l.category === category).id;
        const operation = { id: JSON.stringify([place.id, provider, listId, kind]), kind, provider,
          placeId: place.id, providerPlaceId: place.refs[provider].id, category, listId,
          expectedPresent: had, desiredPresent: want, dependsOn: [] };
        (want ? additions : removals).push(operation);
      }
    }
    // A move must not lose the old membership before all destination additions are verified.
    for (const operation of removals) operation.dependsOn = additions.map(a => a.id);
    operations.push(...additions, ...removals);
  }
  return result();
}

/** Create/advance a baseline only after all providers have converged on a fresh read.
 * Empty memberships remain as tombstones, preventing resurrection after deletion.
 */
export function checkpoint(input, now = Date.now()) {
  const plan = planSync(input, now);
  if (!plan.canCheckpoint) throw new Error('전체 조회·장소 연결·반영 검증이 끝나지 않아 기준 상태를 저장할 수 없습니다.');
  return { version: 1, createdAt: new Date(now).toISOString(),
    accounts: Object.fromEntries(input.snapshots.map(s => [s.provider, s.accountId])),
    listIds: Object.fromEntries(input.snapshots.map(s => [s.provider,
      Object.fromEntries(s.lists.filter(l => CATEGORIES.includes(l.category)).map(l => [l.category, l.id]))])),
    refs: Object.fromEntries(input.places.filter(p => p.country === 'KR').map(p => [p.id,
      Object.fromEntries(PROVIDERS.filter(provider => p.refs?.[provider]).map(provider => [provider, p.refs[provider].id]))])),
    memberships: { ...(input.baseline?.memberships ?? {}), ...plan.desired } };
}
