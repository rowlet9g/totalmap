import { PROVIDERS, LABELS, CATEGORIES, LIST_NAMES, REFERENCE_COUNTS } from './core/config.js';
import { planSync } from './core/engine.js';
import { load, save, download, isExtension } from './storage.js';
const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const report = message => { $('#status').textContent = message; };
const formatDate = value => new Date(value).toLocaleString('ko-KR');
$('#mode').textContent = isExtension ? 'Whale 연결 검증' : '화면 미리보기 · 브라우저 연결 없음';
for (const p of PROVIDERS) {
  const card = el('article', undefined, `card ${p}`);
  card.append(el('h3', LABELS[p]), el('div', Object.values(REFERENCE_COUNTS[p]).reduce((a,b)=>a+b,0).toLocaleString(), 'number'),
    el('p', '개 목록 소속 항목 · 참고 수치'), el('span', '실제 목록 미조회', 'pill'));
  $('#providers').append(card);
}
for (const category of CATEGORIES) {
  const tr = el('tr'); tr.append(el('th', category === 'landmark' ? '명소·기타' : category));
  for (const p of PROVIDERS) tr.append(el('td', `${LIST_NAMES[p][category]} · ${REFERENCE_COUNTS[p][category]}`));
  $('#mapping').append(tr);
}
async function render() {
  const state = await load(); $('#captures').replaceChildren();
  $('#capture-count').textContent = `${state.captures.length}회`;
  if (!state.captures.length) $('#captures').append(el('div', '아직 읽기 기록이 없습니다. Whale의 지도 목록에서 Totalmap 확장을 실행해 주세요.', 'empty'));
  for (const capture of [...state.captures].reverse()) {
    const row = el('details', undefined, 'capture');
    row.append(el('summary', `${LABELS[capture.provider]} · ${capture.category ?? '분류 미지정'} · 링크 후보 ${capture.candidates.length}개 · ${formatDate(capture.capturedAt)}`));
    row.append(el('p', capture.warning));
    const list = el('ul');
    for (const candidate of capture.candidates) list.append(el('li', `${candidate.label || '(이름 없음)'} — ${candidate.id || 'ID 미확인'}`));
    row.append(list); $('#captures').append(row);
  }
  $('#import-status').textContent = state.input ? '검증 입력이 저장되어 있습니다. 최신 전체 조회인지 확인 후 계획을 계산하세요.' : '가져온 검증 입력 없음';
}
$('#refresh').addEventListener('click', () => render().catch(e => report(e.message)));
$('#export').addEventListener('click', async () => {
  try { const state = await load(); download({ version: 1, kind: 'totalmap-diagnostics', captures: state.captures }, `totalmap-diagnostics-${Date.now()}.json`); }
  catch (e) { report(e.message); }
});
$('#import').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5_000_000) throw Error('5MB 이하의 JSON만 가져올 수 있습니다.');
    const input = JSON.parse(await file.text());
    if (!Array.isArray(input.snapshots) || !Array.isArray(input.places)) throw Error('snapshots와 places 배열이 필요합니다.');
    // Validate structure through the planner before persisting; external data is never HTML/code.
    planSync(input);
    const state = await load(); state.input = input; await save(state); await render();
    $('#plan-result').replaceChildren(); report('검증 입력을 가져왔습니다. 지도 저장은 변경되지 않았습니다.');
  } catch (e) { report(`가져오기 실패: ${e.message}`); }
});
$('#plan').addEventListener('click', async () => {
  try {
    const state = await load(); if (!state.input) throw Error('전체 스냅샷 JSON을 먼저 가져오세요.');
    const plan = planSync(state.input), root = $('#plan-result'); root.replaceChildren();
    root.append(el('h3', `${plan.phase === 'bootstrap' ? '최초 통합' : '변경 동기화'} · 예정 작업 ${plan.operations.length}개 · 확인 사항 ${plan.issues.length}개`));
    root.append(el('p', '미리보기입니다. 실제 지도에 실행되지 않습니다.'));
    const list = el('ul'); for (const issue of plan.issues) list.append(el('li', issue.detail)); root.append(list);
    const table = el('table');
    for (const op of plan.operations) {
      const tr = el('tr'); for (const value of [op.kind === 'add' ? '추가' : '목록에서 제거', LABELS[op.provider], op.placeId, op.category]) tr.append(el('td', value)); table.append(tr);
    }
    root.append(table, el('p', `해외 또는 국가 미확인 제외: ${plan.excluded.length}개`));
  } catch (e) { report(e.message); }
});
if (isExtension) chrome.storage.onChanged.addListener(() => render().catch(e => report(e.message)));
await render();
