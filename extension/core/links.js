/** Only canonical place URLs. Queries, fragments, user identifiers and tokens are not retained. */
export function parsePlaceLink(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  let match;
  if ((host === 'map.naver.com' || host === 'pcmap.place.naver.com' || host === 'm.place.naver.com') &&
      (match = url.pathname.match(/\/(?:place|restaurant|cafe|pub|attraction)\/(\d+)(?:\/|$)/)))
    return { provider: 'naver', id: match[1], url: `https://map.naver.com/p/entry/place/${match[1]}` };
  if (host === 'place.map.kakao.com' && (match = url.pathname.match(/^\/(\d+)\/?$/)))
    return { provider: 'kakao', id: match[1], url: `https://place.map.kakao.com/${match[1]}` };
  if (host === 'map.kakao.com' && /^\d+$/.test(url.searchParams.get('itemId') ?? '')) {
    const id = url.searchParams.get('itemId');
    return { provider: 'kakao', id, url: `https://place.map.kakao.com/${id}` };
  }
  if ((host === 'www.google.com' || host === 'maps.google.com' || host === 'www.google.co.kr') &&
      url.pathname.startsWith('/maps')) {
    const placeId = url.searchParams.get('query_place_id');
    if (placeId && /^[A-Za-z0-9_-]+$/.test(placeId)) return { provider: 'google', id: `pid:${placeId}`,
      url: `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${placeId}` };
    const cid = url.searchParams.get('cid');
    if (cid && /^\d+$/.test(cid)) return { provider: 'google', id: `cid:${cid}`, url: `https://www.google.com/maps?cid=${cid}` };
    // A visible /maps/place path without a stable ID remains diagnostic evidence only.
    if (url.pathname.startsWith('/maps/place/')) return { provider: 'google', id: null,
      url: url.origin + url.pathname, unresolved: true };
  }
  return null;
}

export function providerForPage(href) {
  let url; try { url = new URL(href); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (url.hostname === 'map.naver.com') return 'naver';
  if (url.hostname === 'map.kakao.com') return 'kakao';
  if (['www.google.com', 'www.google.co.kr', 'maps.google.com'].includes(url.hostname) &&
      url.pathname.startsWith('/maps')) return 'google';
  return null;
}
