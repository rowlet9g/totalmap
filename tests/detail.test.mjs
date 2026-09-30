import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNaverDetailSample, inspectNaverDetailUrl } from '../extension/core/detail.js';

const folder = '7ebdcbab96084e56b8d4a01b9ab34af3';
const suppliedUrl = `https://map.naver.com/p/favorite/myPlace/folder/${folder}/place/1463187795?c=5.00,0,0,0,dh&placePath=%2Fhome%3Ftimestamp%3D202609301612`;

test('user-observed folder detail URL records ID and context without promoting it to a complete snapshot', () => {
  const sample = buildNaverDetailSample({ pageUrl: suppliedUrl, placeName: '스팀하우스 인덕원점', category: 'cuisine' });
  assert.equal(sample.placeId, '1463187795');
  assert.equal(sample.folderContext.listId, folder);
  assert.equal(sample.placeName, '스팀하우스 인덕원점');
  assert.equal(sample.nameEvidence, 'user-entered');
  assert.equal(sample.complete, false);
  assert.equal(sample.membershipVerified, false);
  assert.equal(sample.country, 'UNKNOWN');
  assert(!JSON.stringify(sample).includes('timestamp'));
  assert(!sample.folderContext.sourceUrl.includes('?'));
});

test('duplicate top/frame URLs identify one place; different places fail visibly', () => {
  const frame = 'https://pcmap.place.naver.com/restaurant/1463187795/home';
  assert.equal(buildNaverDetailSample({ pageUrl: suppliedUrl, frameUrls: [frame] }).placeId, '1463187795');
  assert.throws(() => buildNaverDetailSample({ pageUrl: suppliedUrl,
    frameUrls: ['https://pcmap.place.naver.com/restaurant/123/home'] }), /서로 다른 장소/);
});

test('list-only URL and lookalike domains cannot become a place sample', () => {
  for (const pageUrl of [`https://map.naver.com/p/favorite/myPlace/folder/${folder}`,
    'https://map.naver.com.attacker.example/place/123', 'javascript:alert(1)'])
    assert.throws(() => buildNaverDetailSample({ pageUrl }), /찾지 못/);
});

test('a detail frame can provide ID but cannot manufacture top-page folder membership', () => {
  const sample = buildNaverDetailSample({ pageUrl: `https://map.naver.com/p/favorite/myPlace/folder/${folder}`,
    frameUrls: ['https://pcmap.place.naver.com/restaurant/1463187795/home'] });
  assert.equal(sample.placeId, '1463187795');
  assert.equal(sample.folderContext, null);
  assert.equal(sample.placeName, '');
});

test('serialized frame probe reads only allowed origin/path, not queries or page internals', () => {
  const location = new URL(suppliedUrl);
  const result = vm.runInNewContext(`(${inspectNaverDetailUrl.toString()})()`, { location });
  assert.equal(result, location.origin + location.pathname);
  assert.equal(vm.runInNewContext(`(${inspectNaverDetailUrl.toString()})()`, {
    location: new URL('https://unrelated.example/place/123') }), null);
});
