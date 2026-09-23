import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaceLink, providerForPage } from '../extension/core/links.js';
test('Naver canonicalization removes queries and fragments', () => {
  assert.deepEqual(parsePlaceLink('https://map.naver.com/p/entry/place/123?secret=abc#private'),
    { provider: 'naver', id: '123', url: 'https://map.naver.com/p/entry/place/123' });
});
test('Naver place frame links are recognized', () => assert.equal(parsePlaceLink('https://pcmap.place.naver.com/restaurant/123/home').id, '123'));
test('Kakao itemId becomes stable place link', () => assert.equal(parsePlaceLink('https://map.kakao.com/?itemId=456&x=1').url, 'https://place.map.kakao.com/456'));
test('Google places without stable IDs remain unresolved', () => {
  const p = parsePlaceLink('https://www.google.com/maps/place/Test?authuser=1'); assert.equal(p.id, null); assert(p.unresolved); assert(!p.url.includes('authuser'));
});
test('Google supported query place ID is retained without other parameters', () => {
  const p = parsePlaceLink('https://www.google.com/maps/search/?query_place_id=ChIJ123&authuser=1');
  assert.equal(p.id, 'pid:ChIJ123'); assert(!p.url.includes('authuser'));
});
test('malicious schemes and lookalike domains are rejected', () => {
  for (const url of ['javascript:alert(1)', 'https://map.naver.com.evil.test/place/123', 'file:///maps/place/123', 'https://evil.test/123'])
    assert.equal(parsePlaceLink(url), null);
});
test('only map pages are eligible for capture', () => {
  assert.equal(providerForPage('https://www.google.com/search?q=hello'), null);
  assert.equal(providerForPage('https://www.google.com/maps/'), 'google');
  assert.equal(providerForPage('https://map.naver.com/p/'), 'naver');
  assert.equal(providerForPage('https://map.kakao.com/'), 'kakao');
});
