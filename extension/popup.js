import { inspectPage } from './capture.js';
import { parsePlaceLink, providerForPage } from './core/links.js';
import { load, save, download } from './storage.js';
import { LABELS } from './core/config.js';
const status = document.querySelector('#status');
document.querySelector('#connect-naver').addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request({ origins: ['https://pages.map.naver.com/*', 'https://pcmap.place.naver.com/*'] });
    status.textContent = granted ? '네이버 저장 패널 연결 완료. 이제 현재 지도 읽기를 눌러 주세요.'
      : '저장 패널 접근이 허용되지 않았습니다. 바깥 지도 화면만 읽을 수 있습니다.';
  } catch (error) { status.textContent = `연결 실패: ${error.message}`; }
});
document.querySelector('#dashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#capture').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const provider = providerForPage(tab?.url);
    if (!provider) throw new Error('네이버지도·카카오맵·Google 지도의 목록 탭에서 실행해 주세요.');
    status.textContent = '현재 페이지에 로딩된 링크를 읽고 있습니다…';
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: inspectPage });
    const frames = results.filter(r => r.result && !r.result.skipped).map(r => ({ ...r.result, frameId: r.frameId }));
    const candidates = new Map();
    for (const frame of frames) for (const link of frame.links) {
      const parsed = parsePlaceLink(link.href);
      if (parsed?.provider === provider) candidates.set(parsed.id || parsed.url, { ...parsed, label: link.label });
    }
    const state = await load();
    const capture = { version: 1, kind: 'page-probe', id: crypto.randomUUID(), provider,
      category: document.querySelector('#category').value || null,
      capturedAt: new Date().toISOString(), complete: false,
      source: 'visible-dom-links', candidates: [...candidates.values()],
      frames: frames.map(({ links, ...metadata }) => metadata),
      warning: '검색 결과나 추천 링크가 섞일 수 있습니다. 저장 목록 소속·국가·전체 조회는 미검증입니다.' };
    state.captures.push(capture);
    // Keep all captures; fail visibly on quota rather than silently discarding evidence.
    await save(state);
    const outcome = candidates.size ? `${LABELS[provider]}: 링크 후보 ${candidates.size}개. 전체 저장 개수는 아닙니다.`
      : `${LABELS[provider]}: 장소 읽기 미지원 — 현재 수집기가 이 화면의 장소를 식별하지 못했습니다. 실제 저장 장소가 0개라는 뜻이 아닙니다.`;
    status.textContent = outcome + ' 화면 구조 진단을 로컬에 기록했습니다.';
    try {
      const response = await fetch('http://127.0.0.1:47832/diagnostics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capture),
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) throw Error('진단 수신 실패');
      status.textContent += ' 개발 폴더로 진단 전달 완료.';
    } catch {
      download({ version: 1, kind: 'totalmap-diagnostics', captures: [capture] }, `totalmap-diagnostics-${Date.now()}.json`);
      status.textContent += ' 자동 전달은 연결되지 않아 진단 JSON 다운로드를 시작했습니다. 다운로드가 차단되면 관리 화면의 내보내기를 사용할 수 있습니다.';
    }
  } catch (error) { status.textContent = `읽기 실패: ${error.message}`; }
  finally { event.target.disabled = false; }
});
