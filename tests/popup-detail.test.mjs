import test from 'node:test';
import assert from 'node:assert/strict';

test('detail popup persists user-observed URL evidence; ambiguous frames fail without saving', async () => {
  const previousDocument = globalThis.document, previousChrome = globalThis.chrome;
  const controls = new Map();
  for (const selector of ['#status', '#read-detail', '#read-place', '#detail-name', '#category', '#connect-naver', '#dashboard', '#capture'])
    controls.set(selector, { value: '', textContent: '', addEventListener(type, callback) { this[type] = callback; } });
  controls.get('#detail-name').value = '스팀하우스 인덕원점';
  controls.get('#category').value = 'cuisine';
  const folder = '7ebdcbab96084e56b8d4a01b9ab34af3';
  let tabUrl = `https://map.naver.com/p/favorite/myPlace/folder/${folder}/place/1463187795?private=not-retained`;
  let stored = { version: 1, captures: [{ kind: 'existing-diagnostic' }], input: null };
  let injections = 0, saves = 0;
  globalThis.document = { querySelector: selector => controls.get(selector) };
  globalThis.chrome = {
    runtime: { id: 'test-extension', openOptionsPage() {} },
    tabs: { async query() { return [{ id: 1, url: tabUrl, title: 'cuisine - 네이버지도' }]; } },
    storage: { local: {
      async get(key) { return { [key]: structuredClone(stored) }; },
      async set(value) { stored = structuredClone(value['totalmap-v1']); saves++; },
    } },
    scripting: { async executeScript() {
      injections++;
      return [123, 456].map(id => ({ result: `https://pcmap.place.naver.com/restaurant/${id}/home` }));
    } },
  };
  try {
    await import('../extension/popup.js');
    const button = controls.get('#read-detail');
    await button.click({ target: button });
    assert.equal(injections, 0);
    assert.equal(saves, 1);
    assert.equal(stored.captures.length, 1);
    assert.equal(stored.detailReads[0].placeId, '1463187795');
    assert.equal(stored.detailReads[0].placeName, '스팀하우스 인덕원점');
    assert.equal(stored.detailReads[0].folderContext.listId, folder);
    assert.equal(stored.detailReads[0].complete, false);
    assert(!JSON.stringify(stored.detailReads).includes('not-retained'));
    assert.match(controls.get('#status').textContent, /1463187795/);
    assert.equal(button.disabled, false);
    tabUrl = `https://map.naver.com/p/favorite/myPlace/folder/${folder}`;
    await button.click({ target: button });
    assert.equal(injections, 1);
    assert.equal(saves, 1);
    assert.equal(stored.detailReads.length, 1);
    assert.match(controls.get('#status').textContent, /서로 다른 장소/);
    assert.equal(button.disabled, false);
  } finally {
    globalThis.document = previousDocument; globalThis.chrome = previousChrome;
  }
});
