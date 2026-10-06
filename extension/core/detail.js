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

// Attach only fields tied to the same explicit detail ID, never by title matching alone.
export function attachNaverDetailFields(sample, frames) {
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const fields = [];
  for (const frame of frames) {
    if (frame?.issue) throw Error(`상세 필드 읽기 실패: ${frame.issue}`);
    if (!frame?.name && !frame?.address) continue;
    const ref = parsePlaceLink(frame.sourceUrl);
    if (ref?.provider !== 'naver' || ref.id !== sample.placeId)
      throw Error('상세 화면의 장소 ID가 선택한 장소와 달라 기록을 중단했습니다.');
    const name = clean(frame.name), address = clean(frame.address);
    if (!name || name.length > 180 || !address || address.length > 400)
      throw Error('상세 화면의 이름·주소를 모두 읽지 못했습니다. 로딩 완료 후 다시 실행하세요.');
    fields.push({ name, address, url: ref.url });
  }
  if (!fields.length) throw Error('확인된 상세 이름·주소 필드를 찾지 못했습니다. 상세 화면 로딩과 패널 접근 권한을 확인하세요.');
  const value = fields[0];
  if (fields.some(f => f.name !== value.name || f.address !== value.address))
    throw Error('상세 프레임의 이름·주소가 서로 달라 기록을 중단했습니다.');
  if (sample.placeName && clean(sample.placeName) !== value.name)
    throw Error('탭 제목 또는 입력한 이름과 상세 화면의 이름이 다릅니다. 화면 전환 완료 후 다시 실행하세요.');
  return { ...sample, kind: 'detail-fields-sample', placeName: value.name, address: value.address,
    nameEvidence: 'detail-dom', addressEvidence: 'detail-dom', fieldSourceUrl: value.url,
    warning: '상세 URL과 같은 ID의 화면에서 이름·주소를 읽었습니다. 국가·목록 전체 소속·재조회 안정성·전체 수집은 미검증입니다.' };
}

// Self-contained injection. Selectors are from the user's 2026-10-06 detail diagnostic.
// Read only the title field and the explicitly labeled address row; no full-page text.
export function inspectNaverDetailFields() {
  if (location.hostname !== 'pcmap.place.naver.com') return null;
  const sourceUrl = location.origin + location.pathname;
  if (!/^\/(?:place|restaurant|cafe|pub|attraction)\/[1-9]\d*\/home\/?$/.test(location.pathname)) return null;
  const fail = issue => ({ sourceUrl, issue });
  const text = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  const rendered = node => node.getClientRects().length > 0;
  const roots = Array.from(document.querySelectorAll('.place_pcmap_detail')).filter(rendered);
  if (roots.length !== 1) return fail('상세 화면 영역이 없거나 여러 개입니다.');
  const root = roots[0];
  const names = Array.from(root.querySelectorAll('[role="main"] .place_section .V4UO6 > span.IY7ZX')).filter(rendered);
  if (names.length !== 1 || !text(names[0])) return fail('확인된 장소 이름 필드를 읽지 못했습니다.');
  const name = text(names[0]);
  const headings = Array.from(root.querySelectorAll('header[role="banner"] h1.bh9OH')).filter(rendered);
  if (headings.some(node => text(node) && text(node) !== name)) return fail('상단 제목과 장소 이름이 다릅니다.');
  const rows = Array.from(root.querySelectorAll('[role="main"] .place_section_content .O8qbU')).filter(rendered);
  const addressRows = rows.filter(row => {
    const labels = Array.from(row.querySelectorAll('strong.X2oNY > span.place_blind'));
    return labels.length === 1 && text(labels[0]) === '주소';
  });
  if (addressRows.length !== 1) return fail('주소로 표시된 정보 행을 확인하지 못했습니다.');
  const addresses = Array.from(addressRows[0].querySelectorAll('a.PkgBl > span.pz7wy')).filter(rendered);
  if (addresses.length !== 1 || !text(addresses[0])) return fail('확인된 주소 필드를 읽지 못했습니다.');
  const address = text(addresses[0]);
  if (name.length > 180 || address.length > 400) return fail('이름·주소 길이가 예상 범위를 벗어났습니다.');
  if (sourceUrl !== location.origin + location.pathname) return fail('읽는 동안 상세 URL이 바뀌었습니다.');
  return { sourceUrl, name, address };
}
