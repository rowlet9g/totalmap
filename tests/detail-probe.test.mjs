import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectNaverDetailFields } from '../extension/core/detail.js';
import { dom } from './helpers/dom.mjs';

// Minimal field hierarchy copied from the user's 2026-10-06 diagnostic.
// No cookies, reviews, notes, images or unrelated screen data are retained.
const name = '스팀하우스 인덕원점';
const address = '경기 안양시 동안구 인덕원로 19-2 1층';
const span = (cls, text) => dom({ tag: 'span', cls, text });
function fixture({ heading = name, addressLabel = '주소', missingAddress = false, hiddenAddress = false,
  doubleAddress = false, renamedTitle = false } = {}) {
  const label = text => dom({ tag: 'strong', cls: 'X2oNY', children: [span('place_blind', text)] });
  const row = () => dom({ cls: 'O8qbU tQY7D', hidden: hiddenAddress, children: [label(addressLabel),
    dom({ cls: 'vV_z_', children: [dom({ tag: 'a', cls: 'PkgBl', children: missingAddress ? [] : [span('pz7wy', address)] }),
      dom({ cls: 'nZapA', text: '인덕원역 7번 출구에서 301m' })] })] });
  const root = dom({ cls: 'BXtr_ place_pcmap_detail', children: [
    dom({ tag: 'header', attrs: { role: 'banner' }, children: [dom({ tag: 'h1', cls: 'bh9OH', text: heading })] }),
    dom({ attrs: { role: 'main' }, children: [
      dom({ cls: 'place_section no_margin', children: [dom({ cls: 'V4UO6', children: [span(renamedTitle ? 'changed' : 'IY7ZX', name)] })] }),
      dom({ cls: 'place_section no_margin', children: [dom({ cls: 'place_section_content', children: [
        dom({ cls: 'O8qbU CFk3g', children: [label('저장 폴더'), dom({ tag: 'a', cls: 'PkgBl', children: [span('pz7wy', '과천 외 1곳')] })] }),
        row(), ...(doubleAddress ? [row()] : []),
        dom({ cls: 'O8qbU AZ9_F', children: [label('찾아가는길'), span('pz7wy', '길 안내를 주소로 오인하면 안 됨')] }),
      ] })] }),
    ] }),
  ] });
  const body = dom({ tag: 'body', children: [span('IY7ZX', '외부 추천 장소'), span('pz7wy', '외부 주소'), root] });
  return { body, root };
}
function execute(body, url = 'https://pcmap.place.naver.com/place/1463187795/home?private=excluded') {
  return vm.runInNewContext(`(${inspectNaverDetailFields.toString()})()`, { document: body, location: new URL(url) });
}

test('observed detail fields are extracted without folder names, route guidance or outside recommendations', () => {
  const result = execute(fixture().body);
  assert.equal(result.name, name); assert.equal(result.address, address);
  assert.equal(result.sourceUrl, 'https://pcmap.place.naver.com/place/1463187795/home');
  assert(!JSON.stringify(result).includes('private'));
});

test('changed selectors, wrong address labels, hidden/missing/duplicate fields fail closed', () => {
  for (const options of [{ renamedTitle: true }, { addressLabel: '찾아가는길' }, { hiddenAddress: true },
    { missingAddress: true }, { doubleAddress: true }, { heading: '이전 장소' }]) {
    const result = execute(fixture(options).body);
    assert(result.issue, JSON.stringify(options));
    assert.equal(result.address, undefined);
  }
});

test('other hosts, non-home views and duplicated detail roots never produce name/address', () => {
  const { body, root } = fixture();
  assert.equal(execute(body, 'https://unrelated.example/place/1463187795/home'), null);
  assert.equal(execute(body, 'https://pcmap.place.naver.com/place/1463187795/review'), null);
  const two = dom({ tag: 'body', children: [root, fixture().root] });
  assert(execute(two).issue);
});
