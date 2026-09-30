import { parsePlaceLink } from './links.js';

// URL evidence only. A detail URL does not prove membership in a saved list.
export function buildNaverDetailSample({ pageUrl, pageTitle = '', placeName = '', frameUrls = [], category = null }) {
  const sources = [pageUrl, ...frameUrls];
  const matches = new Map();
  for (const url of sources) {
    const place = parsePlaceLink(url);
    if (place?.provider === 'naver' && place.id) matches.set(place.id, place);
  }
  if (!matches.size) throw Error('장소 상세 URL을 찾지 못했습니다. 네이버 장소 카드 한 개를 열고 다시 실행하세요.');
  if (matches.size !== 1) throw Error('서로 다른 장소 ID가 보여 한 장소로 확정할 수 없습니다. 상세 화면 한 개만 열고 다시 실행하세요.');
  const place = [...matches.values()][0];
  const enteredName = String(placeName).trim().slice(0, 180);
  const title = String(pageTitle).trim();
  // Observed in the user's live detail tab; keep the title as a distinct evidence source.
  const titleName = title.endsWith(' - 네이버지도') ? title.slice(0, -' - 네이버지도'.length).trim().slice(0, 180) : '';
  const listNames = new Set(['cuisine', 'cafeteria', 'bar', 'landmark', '내 장소', '저장', '네이버지도']);
  const fallbackName = listNames.has(titleName) ? '' : titleName;
  let folderContext = null;
  try {
    const source = new URL(pageUrl);
    const match = source.hostname === 'map.naver.com' && source.pathname.match(
      /^\/p\/favorite\/myPlace\/folder\/([a-f0-9]{32})\/place\/(\d+)\/?$/);
    if (match && match[2] === place.id) folderContext = {
      listId: match[1], sourceUrl: source.origin + source.pathname, evidence: 'selected-detail-url-in-folder' };
  } catch { /* No folder context from invalid or other detail URLs. */ }
  return { version: 1, kind: 'detail-url-sample', provider: 'naver',
    placeId: place.id, url: place.url, pageTitle: String(pageTitle).slice(0, 180),
    placeName: enteredName || fallbackName, nameEvidence: enteredName ? 'user-entered' : fallbackName ? 'tab-title' : null,
    folderContext,
    requestedCategory: category, country: 'UNKNOWN', membershipVerified: false,
    complete: false, evidence: 'detail-url',
    warning: '상세 URL에서 읽은 ID입니다. 장소 이름·주소·저장 목록 소속·국가·재조회 안정성은 미검증입니다.' };
}

// Serialized by executeScript; never inspect React, image URLs, or page storage.
export function inspectNaverDetailUrl() {
  if (!['map.naver.com', 'pcmap.place.naver.com', 'm.place.naver.com'].includes(location.hostname)) return null;
  return location.origin + location.pathname;
}
