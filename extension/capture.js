// Serialized by chrome.scripting.executeScript: keep this function self-contained.
export function inspectPage() {
  const allowed = new Set(['map.naver.com', 'pages.map.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com',
    'map.kakao.com', 'place.map.kakao.com', 'www.google.com', 'www.google.co.kr', 'maps.google.com']);
  if (!allowed.has(location.hostname)) return { skipped: true };
  const listNames = new Set(['내 장소', '기본 그룹', 'landmark', 'cuisine', 'cafeteria', 'bar']);
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  // Do not read body text, cookies, localStorage, input fields, notes or network responses.
  const links = anchors.slice(0, 5000).filter(el => el.getClientRects().length)
    .map(el => ({ href: el.href, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 180) }));
  const listSignals = Array.from(document.querySelectorAll('h1,h2,h3,h4,[role=heading],button,[role=tab],a'))
    .filter(el => el.getClientRects().length)
    .map(el => (el.textContent || '').trim())
    .filter(text => listNames.has(text));
  // Structural evidence for button/div based lists. This is diagnostic data, NOT place rows.
  // Never serialize scripts, inputs, cookies, storage or arbitrary data attributes.
  const omitted = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'CANVAS', 'IFRAME', 'INPUT', 'TEXTAREA']);
  const tree = [];
  // No data-* place-ID attribute has been verified in a real capture yet.
  // Populate only after confirming the exact attribute and its ID semantics.
  const verifiedNaverPlaceIdAttributes = new Set([]);
  const hasClass = (node, pattern) => String(node?.getAttribute('class') || '').split(/\s+/).some(token => pattern.test(token));
  function isNaverSavedCard(node) {
    // Observed in the 2026-09-22 saved-panel diagnostic. A CSS change fails closed.
    return location.hostname === 'pages.map.naver.com' && node.tagName.toLowerCase() === 'li' &&
      node.getAttribute('role') === 'button' && hasClass(node, /^_place_info_card_[a-z0-9]+_\d+$/) &&
      node.parentElement?.tagName.toLowerCase() === 'ul' &&
      hasClass(node.parentElement, /^_place_card_list_[a-z0-9]+_\d+$/);
  }
  let budget = 180000;
  function visit(node, depth, parent) {
    if (budget <= 0 || tree.length >= 6000 || depth > 80 || omitted.has(node.tagName.toUpperCase())) return;
    if (node.nodeType !== 1 || getComputedStyle(node).display === 'none') return;
    const text = Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const row = { tag: node.tagName.toLowerCase(), parent, cls: String(node.getAttribute('class') || '').slice(0, 200) };
    if (text) row.text = text;
    for (const attr of ['role', 'aria-label', 'aria-selected', 'aria-expanded', 'tabindex']) {
      const value = node.getAttribute(attr); if (value !== null) row[attr] = value.slice(0, 200);
    }
    if (isNaverSavedCard(node)) {
      // Discover names only on confirmed card-shaped elements; never enumerate dataset values.
      const names = node.getAttributeNames().filter(name => /^data-[a-z][a-z0-9-]{0,79}$/.test(name)).sort();
      row.dataAttributeNames = names.slice(0, 20);
      row.dataAttributeNamesTruncated = names.length > 20;
      const data = {};
      for (const name of row.dataAttributeNames) {
        if (!verifiedNaverPlaceIdAttributes.has(name)) continue;
        const value = node.getAttribute(name);
        if (typeof value === 'string' && /^[1-9]\d{0,31}$/.test(value)) data[name] = value;
      }
      if (Object.keys(data).length) row.data = data;
    }
    const index = tree.length; budget -= JSON.stringify(row).length; tree.push(row);
    for (const child of node.children) visit(child, depth + 1, index);
  }
  if (document.body) visit(document.body, 0, null);
  const frameSources = Array.from(document.querySelectorAll('iframe')).map(frame => {
    try { const url = new URL(frame.src, location.href); return allowed.has(url.hostname) ? url.origin + url.pathname : url.origin; }
    catch { return '(unknown)'; }
  });
  return { host: location.hostname, links, listSignals: [...new Set(listSignals)], structure: tree,
    structureTruncated: budget <= 0 || tree.length >= 6000,
    frameCount: frameSources.length, frameSources, anchorCount: anchors.length,
    truncated: anchors.length > 5000, complete: false };
}
