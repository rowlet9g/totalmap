import test from 'node:test';
import assert from 'node:assert/strict';

test('automatic place read saves scoped fields; navigation, stale identity, missing address and storage failure cannot report success', async () => {
  const previousDocument = globalThis.document, previousChrome = globalThis.chrome;
  const controls = new Map();
  for (const selector of ['#status', '#read-detail', '#read-place', '#detail-name', '#category', '#connect-naver', '#dashboard', '#capture'])
    controls.set(selector, { value: '', textContent: '', addEventListener(type, callback) { this[type] = callback; } });
  const url = 'https://map.naver.com/p/entry/place/1463187795?view=not-retained';
  const title = '스팀하우스 인덕원점 - 네이버지도';
  let mode = 'success', queries = 0, saves = 0;
  let stored = { version: 1, captures: [{ kind: 'prior-diagnostic' }], detailReads: [], input: null };
  globalThis.document = { querySelector: selector => controls.get(selector) };
  globalThis.chrome = {
    runtime: { id: 'test-extension', openOptionsPage() {} },
    tabs: { async query() {
      queries++;
      return [{ id: 1, url: mode === 'navigation' && queries % 2 === 0 ? 'https://map.naver.com/p/entry/place/999' : url, title }];
    } },
    scripting: { async executeScript({ func }) {
      assert.equal(func.name, 'inspectNaverDetailFields');
      return [{ result: { sourceUrl: `https://pcmap.place.naver.com/place/${mode === 'different-id' ? '999' : '1463187795'}/home`,
        name: mode === 'stale-name' ? '다른 식당' : '스팀하우스 인덕원점',
        address: mode === 'missing-address' ? '' : '경기 안양시 동안구 인덕원로 19-2 1층' } }];
    } },
    storage: { local: {
      async get(key) { return { [key]: structuredClone(stored) }; },
      async set(value) { if (mode === 'storage-failure') throw Error('저장 공간 부족'); stored = structuredClone(value['totalmap-v1']); saves++; },
    } },
  };
  try {
    await import('../extension/popup.js');
    const button = controls.get('#read-place');
    await button.click({ target: button });
    assert.equal(saves, 1);
    assert.equal(stored.detailReads[0].placeName, '스팀하우스 인덕원점');
    assert.equal(stored.detailReads[0].address, '경기 안양시 동안구 인덕원로 19-2 1층');
    assert.equal(stored.detailReads[0].nameEvidence, 'detail-dom');
    assert.equal(stored.detailReads[0].complete, false);
    assert.equal(stored.captures.length, 1);
    assert(!JSON.stringify(stored.detailReads).includes('not-retained'));
    assert.match(controls.get('#status').textContent, /주소를 이 확장에 기록/);
    for (mode of ['navigation', 'different-id', 'stale-name', 'missing-address', 'storage-failure']) {
      queries = 0;
      await button.click({ target: button });
      assert.equal(saves, 1, mode);
      assert.equal(stored.detailReads.length, 1, mode);
      assert.match(controls.get('#status').textContent, /읽기 실패/, mode);
      assert.equal(button.disabled, false, mode);
    }
  } finally {
    globalThis.document = previousDocument; globalThis.chrome = previousChrome;
  }
});
