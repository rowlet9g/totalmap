import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPage } from '../extension/capture.js';

function element(tag, text = '', children = [], attrs = {}) {
  const textNode = { nodeType: 3, textContent: text };
  const node = { tagName: tag.toUpperCase(), nodeType: 1, children,
    childNodes: [...(text ? [textNode] : []), ...children], textContent: text,
    dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
    getAttributeNames: () => Object.keys(attrs),
    getAttribute: key => attrs[key] ?? null, getClientRects: () => [], style: { display: 'block' } };
  for (const child of children) child.parentElement = node;
  return node;
}
function execute(body, hostname = 'map.naver.com') {
  return vm.runInNewContext(`(${inspectPage.toString()})()`, {
    location: { hostname, href: `https://${hostname}/` },
    document: { body, querySelectorAll: () => [] },
    getComputedStyle: node => node.style,
    URL,
  });
}
test('zero anchors retains button/div list evidence instead of implying empty saves', () => {
  const body = element('body', '', [element('div', '', [element('button', '테스트 식당')])]);
  const result = execute(body);
  assert.equal(result.links.length, 0); assert.equal(result.complete, false);
  assert(result.structure.some(row => row.text === '테스트 식당'));
});
test('diagnostics does not serialize scripts, text inputs or arbitrary data attributes', () => {
  const result = execute(element('body', '', [element('script', 'private-token'),
    element('input', 'password'), element('div', '장소', [], { 'data-session': 'private-token' })]));
  assert(!JSON.stringify(result).includes('private-token'));
  assert(!JSON.stringify(result).includes('password'));
});
test('hidden subtrees are excluded from structural diagnostics', () => {
  const hidden = element('div', 'hidden data'); hidden.style.display = 'none';
  assert(!JSON.stringify(execute(element('body', '', [hidden]))).includes('hidden data'));
});

function savedCard(attrs = {}) {
  const card = element('li', '테스트 장소', [], {
    class: '_place_info_card_mrlmv_1 ', role: 'button',
    'data-session': 'session-value-must-not-leak',
    'data-place-id': 'unverified-place-id-value', ...attrs,
  });
  const list = element('ul', '', [card], { class: '_place_card_list_hrpj3_18' });
  return { body: element('body', '', [list]), card };
}

test('Naver saved frame never exports unverified data values, including plausible IDs', () => {
  const { body } = savedCard();
  const result = execute(body, 'pages.map.naver.com');
  assert(!JSON.stringify(result).includes('session-value-must-not-leak'));
  assert(!JSON.stringify(result).includes('unverified-place-id-value'));
  assert(result.structure.every(row => row.data === undefined));
  assert.equal(result.complete, false);
});

test('only the observed Naver saved-card structure exposes attribute names', () => {
  const { body } = savedCard();
  const result = execute(body, 'pages.map.naver.com');
  const card = result.structure.find(row => row.tag === 'li');
  assert.deepEqual(Array.from(card.dataAttributeNames), ['data-place-id', 'data-session']);
  const otherHost = execute(body, 'map.naver.com');
  assert(otherHost.structure.every(row => row.dataAttributeNames === undefined));
});

test('card-like elements outside saved list and image classes do not qualify', () => {
  const outside = element('li', '', [], { class: '_place_info_card_mrlmv_1', role: 'button', 'data-session': 'secret' });
  const image = element('li', '', [], { class: '_place_info_card_image_mrlmv_154', role: 'button', 'data-session': 'secret' });
  const list = element('ul', '', [image], { class: '_place_card_list_hrpj3_18' });
  const result = execute(element('body', '', [outside, list]), 'pages.map.naver.com');
  assert(result.structure.every(row => row.dataAttributeNames === undefined && row.data === undefined));
});

test('data inspection does not access dataset or read any unverified attribute value', () => {
  const { body, card } = savedCard();
  Object.defineProperty(card, 'dataset', { get() { throw Error('dataset must not be read'); } });
  const getAttribute = card.getAttribute;
  card.getAttribute = key => {
    if (key.startsWith('data-')) throw Error('unverified attribute must not be read');
    return getAttribute(key);
  };
  assert.doesNotThrow(() => execute(body, 'pages.map.naver.com'));
});
