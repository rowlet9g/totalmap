import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaverDetailSample, attachNaverDetailFields } from '../extension/core/detail.js';

const sample = () => buildNaverDetailSample({ pageUrl: 'https://map.naver.com/p/entry/place/1463187795',
  pageTitle: '스팀하우스 인덕원점 - 네이버지도' });
const frame = (overrides = {}) => ({ sourceUrl: 'https://pcmap.place.naver.com/restaurant/1463187795/home?do-not-store=yes',
  name: '스팀하우스 인덕원점', address: '경기도 안양시 동안구 관양동 1485-13 1층', ...overrides });

test('name and address attach to matching detail ID while preserving incomplete sync state', () => {
  const value = attachNaverDetailFields(sample(), [frame()]);
  assert.equal(value.placeName, '스팀하우스 인덕원점');
  assert.equal(value.address, '경기도 안양시 동안구 관양동 1485-13 1층');
  assert.equal(value.nameEvidence, 'detail-dom');
  assert.equal(value.addressEvidence, 'detail-dom');
  assert.equal(value.complete, false);
  assert.equal(value.membershipVerified, false);
  assert.equal(value.country, 'UNKNOWN');
  assert(!JSON.stringify(value).includes('do-not-store'));
});

test('different ID, lookalike hosts, stale title and conflicting frames cannot attach fields', () => {
  for (const bad of [frame({ sourceUrl: 'https://pcmap.place.naver.com/restaurant/123/home' }),
    frame({ sourceUrl: 'https://pcmap.place.naver.com.attacker.example/restaurant/1463187795/home' }),
    frame({ name: '다른 식당' })]) assert.throws(() => attachNaverDetailFields(sample(), [bad]));
  assert.throws(() => attachNaverDetailFields(sample(), [frame(), frame({ address: '다른 주소' })]), /서로 달라/);
});

test('missing or partial fields fail visibly instead of reusing old address', () => {
  assert.throws(() => attachNaverDetailFields(sample(), []), /찾지 못/);
  assert.throws(() => attachNaverDetailFields(sample(), [frame({ address: '' })]), /모두 읽지 못/);
  assert.throws(() => attachNaverDetailFields(sample(), [frame({ name: '' })]), /모두 읽지 못/);
});
