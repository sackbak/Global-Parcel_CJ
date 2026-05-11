// CJ LMD Report - Editable Cell Manager
//
// 단일 페이지 + 6개 국가 섹션 + 탭 네비.
// 데이터 저장:
//   - Production (Vercel): /api/data (Vercel KV) - 모든 사용자 공유
//   - Local (file://): localStorage 폴백
// CJ대한통운 데이터는 shared 네임스페이스 (모든 섹션 자동 동기화).
// 경쟁사·시장 데이터는 page-specific 네임스페이스.

(function () {
  const sections = Array.from(document.querySelectorAll('[data-page-content]'));
  if (sections.length === 0) return;

  const API_URL = '/api/data';
  const POLL_INTERVAL = 5000;
  const SHARED_KEY = 'cj-lmd-shared';

  let useApi = false; // 초기화 시 API 가용성 감지
  let lastApiData = null;

  const cellMap = new Map();
  const sectionInfos = new Map();

  // 사용자 식별 (첫 방문 시 이름 받기)
  function getUserName() {
    let name = localStorage.getItem('cj-lmd-user');
    if (!name) {
      name = prompt('이름을 입력해주세요 (셀 수정 이력에 표시됩니다):', '');
      if (name && name.trim()) {
        name = name.trim().slice(0, 20);
        localStorage.setItem('cj-lmd-user', name);
      } else {
        name = '익명';
      }
    }
    return name;
  }
  const USER_NAME = getUserName();

  // ---------- utils ----------
  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
  }
  function writeStorage(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }
  function getScoreValue(el) {
    const m = (el.textContent || '').match(/[1-5]/);
    return m ? parseInt(m[0]) : null;
  }
  function validateAndRenderScore(el) {
    const v = getScoreValue(el);
    el.classList.remove('score-1','score-2','score-3','score-4','score-5','score-invalid');
    el.classList.add(v ? `score-${v}` : 'score-invalid');
  }
  function propagate(id, value, exceptEl) {
    const list = cellMap.get(id);
    if (!list) return;
    list.forEach(({el, options}) => {
      if (el !== exceptEl && el.innerHTML !== value) {
        el.innerHTML = value;
        if (options.score) validateAndRenderScore(el);
      }
    });
  }

  // ---------- save (API + localStorage) ----------
  async function saveOne(scope, id, value, sectionId) {
    const key = scope === 'shared' ? SHARED_KEY : `cj-lmd-${sectionId}`;
    const data = readStorage(key);
    data[id] = value;
    // 메타 (수정자·수정시각) - 같은 key 안에 __meta로 박음
    if (!data.__meta) data.__meta = {};
    const meta = { by: USER_NAME, at: Date.now() };
    data.__meta[id] = meta;
    writeStorage(key, data);
    // DOM 메타 갱신
    updateCellAttribution(id, meta);
    showSaveIndicator('저장중');

    if (useApi) {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({scope, sectionId, cellId: id, value, by: USER_NAME, at: meta.at})
        });
        if (res.ok) {
          showSaveIndicator('저장됨');
        } else {
          showSaveIndicator('로컬 저장');
        }
      } catch (e) {
        showSaveIndicator('로컬 저장');
      }
    } else {
      showSaveIndicator('로컬 저장');
    }
  }

  // 셀에 수정자 메타 적용 (title 툴팁 + data 속성)
  function updateCellAttribution(id, meta) {
    if (!meta) return;
    const list = cellMap.get(id);
    if (!list) return;
    const text = `${meta.by} · ${formatRelativeTime(meta.at)}`;
    list.forEach(({el}) => {
      el.setAttribute('data-edited-by', meta.by);
      el.setAttribute('data-edited-at', meta.at);
      el.setAttribute('title', `마지막 수정: ${text}`);
    });
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- register ----------
  function register(el, id, options, sectionId) {
    if (!el) return;
    const scope = options.scope || 'page';
    el.setAttribute('data-cell-id', id);
    el.setAttribute('data-cell-scope', scope);
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.classList.add('editable');

    // 원본 HTML 저장 (롤백용) - 저장된 데이터 적용 전 시점의 baseline
    if (!el.dataset.originalHtml) {
      el.dataset.originalHtml = el.innerHTML;
    }

    if (!cellMap.has(id)) cellMap.set(id, []);
    cellMap.get(id).push({el, options, sectionId, scope});

    el.addEventListener('blur', () => {
      const v = el.innerHTML;
      saveOne(scope, id, v, sectionId);
      propagate(id, v, el);
    });

    if (options.score) {
      el.addEventListener('input', () => {
        const v = el.innerHTML;
        propagate(id, v, el);
        validateAndRenderScore(el);
        recalcAllHexagons();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    }
  }

  // ---------- 섹션 처리 ----------
  sections.forEach((section) => {
    const sectionId = section.dataset.pageContent;
    const isComparison = !!section.querySelector('.comp-table');
    const cjScoreCells = [];
    const comp1ScoreCells = [];
    const comp2ScoreCells = [];
    sectionInfos.set(sectionId, {section, isComparison, cjScoreCells, comp1ScoreCells, comp2ScoreCells});

    section.querySelectorAll('.stat-card').forEach((card, i) => {
      const idx = i + 1;
      register(card.querySelector('.label'), `${sectionId}:stat-${idx}-label`, {scope:'page'}, sectionId);
      register(card.querySelector('.value'), `${sectionId}:stat-${idx}-value`, {scope:'page'}, sectionId);
    });

    section.querySelectorAll('.insight-box').forEach((box) => {
      const isSummary = box.classList.contains('summary');
      register(box, `${sectionId}:insight-${isSummary?'summary':'overview'}`, {scope:'page'}, sectionId);
    });

    let axisNum = 0, indNum = 0;
    const sel = isComparison ? '.comp-table tbody tr' : '.self-table tbody tr';
    section.querySelectorAll(sel).forEach((row) => {
      const axisCell = row.querySelector('.axis-cell');
      if (axisCell) {
        axisNum++;
        indNum = 0;
        register(axisCell, `axis-${axisNum}-name`, {scope:'shared'}, sectionId);
      }
      indNum++;
      const base = `ind-${axisNum}-${indNum}`;

      register(row.querySelector('.indicator-name'), `${base}-name`, {scope:'shared'}, sectionId);
      register(row.querySelector('.indicator-sub'), `${base}-sub`, {scope:'shared'}, sectionId);

      if (isComparison) {
        register(row.querySelector('.cj-cell'), `${base}-cj-content`, {scope:'shared'}, sectionId);
        const cjScore = row.querySelector('.score-cell.cj');
        if (cjScore) {
          register(cjScore, `${base}-cj-score`, {scope:'shared', score:true}, sectionId);
          cjScoreCells.push({el:cjScore, axis:axisNum});
        }
        const tds = Array.from(row.children).filter(c => c.tagName === 'TD');
        let idx = 0;
        if (tds[idx] && tds[idx].classList.contains('axis-cell')) idx++;
        idx += 3;
        if (tds[idx]) register(tds[idx], `${sectionId}:${base}-comp1-content`, {scope:'page'}, sectionId);
        idx++;
        if (tds[idx]) {
          register(tds[idx], `${sectionId}:${base}-comp1-score`, {scope:'page', score:true}, sectionId);
          comp1ScoreCells.push({el:tds[idx], axis:axisNum});
        }
        idx++;
        if (tds[idx]) register(tds[idx], `${sectionId}:${base}-comp2-content`, {scope:'page'}, sectionId);
        idx++;
        if (tds[idx]) {
          register(tds[idx], `${sectionId}:${base}-comp2-score`, {scope:'page', score:true}, sectionId);
          comp2ScoreCells.push({el:tds[idx], axis:axisNum});
        }
      } else {
        register(row.querySelector('.content-cell'), `${base}-cj-content`, {scope:'shared'}, sectionId);
        const score = row.querySelector('.score-cell');
        if (score) {
          register(score, `${base}-cj-score`, {scope:'shared', score:true}, sectionId);
          cjScoreCells.push({el:score, axis:axisNum});
        }
      }
    });

    register(section.querySelector('.source-note'), `${sectionId}:source-note`, {scope:'page'}, sectionId);
  });

  // ---------- 데이터 적용 (localStorage → DOM) ----------
  function applyStoredData() {
    cellMap.forEach((list, id) => {
      const {scope, sectionId} = list[0];
      const key = scope === 'shared' ? SHARED_KEY : `cj-lmd-${sectionId}`;
      const data = readStorage(key);
      if (data[id] !== undefined) {
        list.forEach(({el, options}) => {
          if (el.innerHTML !== data[id]) {
            el.innerHTML = data[id];
            if (options.score) validateAndRenderScore(el);
          }
        });
      }
      // 메타 적용
      const meta = data.__meta && data.__meta[id];
      if (meta) updateCellAttribution(id, meta);
    });
  }

  // ---------- API 데이터 → localStorage 캐시 갱신 ----------
  function syncFromApiData(data) {
    if (!data) return false;
    let changed = false;
    const newShared = JSON.stringify(data.shared || {});
    const oldShared = localStorage.getItem(SHARED_KEY) || '{}';
    if (newShared !== oldShared) {
      localStorage.setItem(SHARED_KEY, newShared);
      changed = true;
    }
    Object.entries(data.pages || {}).forEach(([id, d]) => {
      const newPage = JSON.stringify(d);
      const oldPage = localStorage.getItem(`cj-lmd-${id}`) || '{}';
      if (newPage !== oldPage) {
        localStorage.setItem(`cj-lmd-${id}`, newPage);
        changed = true;
      }
    });
    return changed;
  }

  // ---------- API 초기화 + 폴링 ----------
  async function init() {
    // 1차 시도: API 가용성 감지
    try {
      const r = await fetch(API_URL, {cache: 'no-store'});
      if (r.ok) {
        useApi = true;
        const data = await r.json();
        lastApiData = data;
        syncFromApiData(data);
      }
    } catch (e) {
      useApi = false;
    }
    applyStoredData();
    recalcAllHexagons();
    if (useApi) {
      setInterval(pollForUpdates, POLL_INTERVAL);
    }
  }

  async function pollForUpdates() {
    if (document.hidden) return;
    try {
      const r = await fetch(API_URL, {cache: 'no-store'});
      if (!r.ok) return;
      const data = await r.json();
      const changed = syncFromApiData(data);
      if (changed) {
        // 현재 포커스된 셀(편집중)은 덮어쓰지 않음
        const focused = document.activeElement;
        const focusedId = focused?.getAttribute('data-cell-id');
        applyStoredDataExcept(focusedId);
        recalcAllHexagons();
      }
    } catch (e) {}
  }

  function applyStoredDataExcept(excludeId) {
    cellMap.forEach((list, id) => {
      if (id === excludeId) return;
      const {scope, sectionId} = list[0];
      const key = scope === 'shared' ? SHARED_KEY : `cj-lmd-${sectionId}`;
      const data = readStorage(key);
      if (data[id] !== undefined) {
        list.forEach(({el, options}) => {
          if (el.innerHTML !== data[id]) {
            el.innerHTML = data[id];
            if (options.score) validateAndRenderScore(el);
          }
        });
      }
      const meta = data.__meta && data.__meta[id];
      if (meta) updateCellAttribution(id, meta);
    });
  }

  // ---------- 육각형 ----------
  function axisAverages(list) {
    const avgs = {};
    for (let a = 1; a <= 6; a++) {
      const s = list.filter(x => x.axis === a).map(x => getScoreValue(x.el)).filter(v => v !== null);
      avgs[a] = s.length ? s.reduce((x,y) => x+y, 0) / s.length : 0;
    }
    return avgs;
  }
  function coords(avgs) {
    const R = 18;
    const out = [];
    for (let a = 1; a <= 6; a++) {
      const angle = (a-1) * 60 * Math.PI / 180;
      const r = avgs[a] * R;
      out.push([+(Math.sin(angle)*r).toFixed(2), +(-Math.cos(angle)*r).toFixed(2)]);
    }
    return out;
  }
  function pointsStr(c) { return c.map(p => p.join(',')).join(' '); }
  function findPolyByStroke(svg, color) {
    return Array.from(svg.querySelectorAll('polygon')).find(p => p.getAttribute('stroke') === color);
  }
  function findPolyByFillStart(svg, prefix) {
    return Array.from(svg.querySelectorAll('polygon')).find(p => (p.getAttribute('fill')||'').startsWith(prefix));
  }
  function recalcAllHexagons() {
    sectionInfos.forEach((info) => recalcOne(info));
  }
  function recalcOne(info) {
    const svg = info.section.querySelector('.radar-svg');
    if (!svg) return;
    if (info.isComparison) {
      const cjC = coords(axisAverages(info.cjScoreCells));
      const c1C = coords(axisAverages(info.comp1ScoreCells));
      const c2C = coords(axisAverages(info.comp2ScoreCells));
      const cjP = findPolyByStroke(svg, '#c89c4c');
      const c1P = findPolyByStroke(svg, '#1a3a6c');
      const c2P = findPolyByStroke(svg, '#8a2929');
      if (cjP) cjP.setAttribute('points', pointsStr(cjC));
      if (c1P) c1P.setAttribute('points', pointsStr(c1C));
      if (c2P) c2P.setAttribute('points', pointsStr(c2C));

      // Overview 미니차트도 같은 데이터로 갱신
      const sectionId = info.section.dataset.pageContent;
      const ovCard = document.querySelector(`.overview-card[data-overview-for="${sectionId}"]`);
      if (ovCard) {
        const ovCj = ovCard.querySelector('.ov-poly-cj');
        const ovC1 = ovCard.querySelector('.ov-poly-c1');
        const ovC2 = ovCard.querySelector('.ov-poly-c2');
        if (ovCj) ovCj.setAttribute('points', pointsStr(cjC));
        if (ovC1) ovC1.setAttribute('points', pointsStr(c1C));
        if (ovC2) ovC2.setAttribute('points', pointsStr(c2C));
      }
    } else {
      const avgs = axisAverages(info.cjScoreCells);
      const c = coords(avgs);
      const dataPoly = findPolyByFillStart(svg, 'rgba');
      if (dataPoly) dataPoly.setAttribute('points', pointsStr(c));
      const circles = Array.from(svg.querySelectorAll('circle')).filter(x => x.getAttribute('r') === '2.5');
      circles.forEach((cir, i) => {
        if (c[i]) { cir.setAttribute('cx', c[i][0]); cir.setAttribute('cy', c[i][1]); }
      });
      const texts = svg.querySelectorAll('text');
      for (let a = 0; a < 6; a++) {
        const vt = texts[a*2+1];
        if (vt) vt.textContent = avgs[a+1].toFixed(1);
      }
      const all = info.cjScoreCells.map(x => getScoreValue(x.el)).filter(v => v !== null);
      const overall = all.length ? (all.reduce((a,b)=>a+b,0)/all.length).toFixed(2) : '0.00';
      const legend = info.section.querySelector('.radar-legend');
      if (legend) legend.textContent = `전체 평균 ${overall} / 5.0 ・ 점수는 회의 합의 후 조정 가능`;
    }
  }

  // ---------- 저장 표시 ----------
  const indicator = document.createElement('div');
  indicator.id = 'save-indicator';
  document.body.appendChild(indicator);
  let saveTimer;
  function showSaveIndicator(text) {
    indicator.textContent = text || '저장됨';
    indicator.classList.add('visible');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => indicator.classList.remove('visible'), 1200);
  }

  // ---------- localStorage 다른 탭 동기화 ----------
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key === SHARED_KEY || e.key.startsWith('cj-lmd-')) {
      applyStoredData();
      recalcAllHexagons();
    }
  });

  // ---------- 탭 네비 ----------
  const tabs = Array.from(document.querySelectorAll('.tab-nav button[data-tab]'));
  function activateTab(target) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    sections.forEach(s => s.classList.toggle('active', s.dataset.pageContent === target));
    window.scrollTo(0, 0);
  }
  tabs.forEach(t => t.addEventListener('click', () => {
    activateTab(t.dataset.tab);
    history.replaceState(null, '', `#${t.dataset.tab}`);
  }));
  const initial = location.hash.slice(1);
  if (initial && tabs.some(t => t.dataset.tab === initial)) {
    activateTab(initial);
  } else {
    activateTab('korea');
  }

  // ---------- 초기화 단축키 + 서식 단축키 + Tab 네비 ----------
  document.addEventListener('keydown', (e) => {
    // 1) 초기화: Ctrl+Shift+R
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
      const active = tabs.find(t => t.classList.contains('active'))?.dataset.tab;
      if (!active) return;
      if (confirm(`현재 탭(${active})의 로컬 캐시를 초기화합니다. 서버 데이터는 유지. 계속?`)) {
        localStorage.removeItem(`cj-lmd-${active}`);
        location.reload();
      }
      return;
    }

    // 셀 포커스 안 잡혀있으면 종료
    if (!currentEditable) return;

    // 2) Enter / Alt+Enter: 텍스트 셀은 줄바꿈 (점수 셀은 register에서 blur 처리됨)
    if (e.key === 'Enter') {
      if (!currentEditable.classList.contains('score-cell')) {
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
        return;
      }
    }

    // 3) 서식 단축키 - Ctrl 조합
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Shift+> / Ctrl+Shift+. : 크기 ↑ (Word/Docs 스타일)
      if (e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        runFontSizeAdjust(1);
        return;
      }
      // Ctrl+Shift+< / Ctrl+Shift+, : 크기 ↓
      if (e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        runFontSizeAdjust(-1);
        return;
      }
      // 그 외 Ctrl 단축키 (Shift 없음)
      if (!e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'b' || k === 'i' || k === 'u') {
          e.preventDefault();
          const cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline';
          if (!applyCmdToMulti(cmd, null)) {
            document.execCommand('styleWithCSS', false, true);
            document.execCommand(cmd);
            triggerSaveFromToolbar();
          }
          return;
        }
        if (k === 'l') { e.preventDefault(); if (!applyCmdToMulti('justifyLeft', null)) { document.execCommand('justifyLeft'); triggerSaveFromToolbar(); } return; }
        if (k === 'e') { e.preventDefault(); if (!applyCmdToMulti('justifyCenter', null)) { document.execCommand('justifyCenter'); triggerSaveFromToolbar(); } return; }
        // 크기 단축키: Ctrl++ / Ctrl+= / Ctrl+-
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          runFontSizeAdjust(1);
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          runFontSizeAdjust(-1);
          return;
        }
      }
    }

    function runFontSizeAdjust(delta) {
      // 다중 셀 우선
      if (multiSelected.size > 0) {
        multiSelected.forEach(cell => {
          const cur = parseFloat(window.getComputedStyle(cell).fontSize);
          const next = nextSize(cur, delta);
          cell.focus();
          const range = document.createRange();
          range.selectNodeContents(cell);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          const span = document.createElement('span');
          span.style.fontSize = next + 'px';
          try { span.appendChild(range.extractContents()); range.insertNode(span); } catch (e) {}
          const id = cell.getAttribute('data-cell-id');
          const scope = cell.getAttribute('data-cell-scope');
          const list = cellMap.get(id);
          const sectionId = list?.[0]?.sectionId;
          saveOne(scope, id, cell.innerHTML, sectionId);
          propagate(id, cell.innerHTML, cell);
        });
        return;
      }
      adjustFontSize(delta);
      triggerSaveFromToolbar();
      updateSizeLabel();
    }

    // 4) Tab / Shift+Tab — 활성 탭의 다음/이전 셀로 이동 (엑셀스러움)
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const activeTab = document.querySelector('[data-page-content].active');
      if (!activeTab) return;
      const all = Array.from(activeTab.querySelectorAll('.editable'));
      const idx = all.indexOf(currentEditable);
      if (idx === -1) return;
      const next = e.shiftKey ? all[idx - 1] : all[idx + 1];
      if (next) {
        next.focus();
        // 다음 셀 내용 전체 선택 (엑셀 셀 진입 동작)
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(next);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });

  // 모든 .editable 에 tabindex 부여 → Tab 키 네비게이션 가능
  document.querySelectorAll('.editable').forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });

  // ---------- 전체 복사 버튼 (현재 탭 통째로 클립보드로) ----------
  const copyBtn = document.createElement('button');
  copyBtn.id = 'copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '전체 복사';
  copyBtn.title = '현재 탭 전체 내용을 클립보드로 (Excel/Word에 붙이면 표·텍스트 그대로)';
  document.body.appendChild(copyBtn);

  copyBtn.addEventListener('click', async () => {
    const activeSec = document.querySelector('[data-page-content].active');
    if (!activeSec) return;

    // HTML (서식·표 구조 유지). meta charset 박아서 한글 깨짐 방지
    const html = '<meta charset="utf-8">' + activeSec.innerHTML;

    // Plain text 폴백 - 표는 TSV, 나머지는 줄바꿈으로
    const textParts = [];
    activeSec.childNodes.forEach(node => textParts.push(nodeToText(node)));
    const plain = textParts.filter(s => s.trim()).join('\n\n');

    try {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], {type: 'text/plain'}),
            'text/html': new Blob([html], {type: 'text/html'})
          })
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      copyBtn.textContent = '복사됨';
      setTimeout(() => copyBtn.textContent = '전체 복사', 1500);
    } catch (e) {
      console.error('Clipboard failed', e);
      copyBtn.textContent = '실패';
      setTimeout(() => copyBtn.textContent = '전체 복사', 1800);
    }
  });

  // DOM 노드를 텍스트로 (표는 TSV로)
  function nodeToText(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return '';
    if (tag === 'TABLE') {
      const rows = [];
      node.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(td => {
          cells.push(td.textContent.trim().replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' '));
        });
        rows.push(cells.join('\t'));
      });
      return rows.join('\n');
    }
    // 일반 텍스트 컨테이너
    const parts = [];
    node.childNodes.forEach(c => parts.push(nodeToText(c)));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- 엑셀 다운로드 버튼 ----------
  const exportBtn = document.createElement('button');
  exportBtn.id = 'export-btn';
  exportBtn.type = 'button';
  exportBtn.textContent = '엑셀 다운로드';
  exportBtn.title = '현재 모든 탭의 데이터를 .xlsx로 내려받기';
  document.body.appendChild(exportBtn);

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = '준비 중…';
    try {
      // SheetJS를 CDN에서 동적 로드
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const wb = window.XLSX.utils.book_new();

      sections.forEach(section => {
        const sectionId = section.dataset.pageContent;
        const sheetName = sectionId.slice(0, 31);
        const aoa = extractSectionToRows(section);
        const ws = window.XLSX.utils.aoa_to_sheet(aoa);
        // 컬럼 너비 자동
        const colWidths = aoa[0]?.map((_, i) => ({
          wch: Math.min(60, Math.max(8, Math.max(...aoa.map(r => String(r[i] || '').length))))
        })) || [];
        ws['!cols'] = colWidths;
        window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      const today = new Date();
      const fname = `CJ_LMD_Report_${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}.xlsx`;
      window.XLSX.writeFile(wb, fname);
      exportBtn.textContent = '다운로드 완료';
      setTimeout(() => { exportBtn.textContent = '엑셀 다운로드'; exportBtn.disabled = false; }, 1500);
    } catch (e) {
      console.error('Export failed', e);
      exportBtn.textContent = '실패 - 재시도';
      exportBtn.disabled = false;
    }
  });

  // 섹션 → 2차원 배열 (엑셀 시트용)
  function extractSectionToRows(section) {
    const rows = [];
    const title = section.querySelector('.title')?.textContent.trim() || section.dataset.pageContent;
    rows.push([title]);
    rows.push([]);

    // stat cards
    const stats = section.querySelectorAll('.stat-card');
    if (stats.length) {
      const labels = []; const values = [];
      stats.forEach(c => {
        labels.push(c.querySelector('.label')?.textContent.trim() || '');
        values.push(c.querySelector('.value')?.textContent.trim() || '');
      });
      rows.push(labels);
      rows.push(values);
      rows.push([]);
    }

    // 인사이트 개요
    const overview = section.querySelector('.insight-box:not(.summary)');
    if (overview) {
      const label = overview.querySelector('.label')?.textContent.trim() || '개요';
      const text = overview.textContent.replace(overview.querySelector('.label')?.textContent || '', '').trim();
      rows.push([label, text]);
      rows.push([]);
    }

    // 표
    const table = section.querySelector('.self-table, .comp-table');
    if (table) {
      const headerRow = [];
      table.querySelectorAll('thead th').forEach(th => headerRow.push(th.textContent.trim().replace(/\s+/g,' ')));
      rows.push(headerRow);
      table.querySelectorAll('tbody tr').forEach(tr => {
        const r = [];
        tr.querySelectorAll('td').forEach(td => {
          r.push(td.textContent.trim().replace(/\s+/g, ' '));
        });
        rows.push(r);
      });
      rows.push([]);
    }

    // 시사점
    const summary = section.querySelector('.insight-box.summary');
    if (summary) {
      const label = summary.querySelector('.label')?.textContent.trim() || '시사점';
      const text = summary.textContent.replace(summary.querySelector('.label')?.textContent || '', '').trim();
      rows.push([label]);
      rows.push([text]);
      rows.push([]);
    }

    // 출처
    const source = section.querySelector('.source-note');
    if (source) {
      rows.push(['출처']);
      rows.push([source.textContent.trim()]);
    }

    return rows;
  }

  // ---------- 서식 툴바 (Bold / Italic / Underline / 크기 / 색상) ----------
  const SIZE_PRESETS = [9, 10, 11, 12, 14, 16, 18, 22];
  const toolbar = document.createElement('div');
  toolbar.id = 'format-toolbar';
  toolbar.innerHTML =
    // 굵게/기울임/밑줄/취소선
    '<button type="button" data-cmd="bold" title="굵게 (Ctrl+B)"><b>B</b></button>' +
    '<button type="button" data-cmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button>' +
    '<button type="button" data-cmd="underline" title="밑줄 (Ctrl+U)"><u>U</u></button>' +
    '<button type="button" data-cmd="strikeThrough" title="취소선"><s>S</s></button>' +
    '<span class="sep"></span>' +
    // 폰트 크기 드롭다운
    '<select class="size-select" title="글자 크기">' +
      [9,10,11,12,14,16,18,22,28].map(s => `<option value="${s}">${s}</option>`).join('') +
    '</select>' +
    '<span class="sep"></span>' +
    // 글자 색 / 형광펜
    '<div class="color-wrap" data-kind="fore"><button type="button" class="color-btn" title="글자 색"><span class="color-letter">A</span><span class="color-bar" style="background:#1a3a6c"></span></button><button type="button" class="color-arrow" title="색 선택">▾</button></div>' +
    '<div class="color-wrap" data-kind="back"><button type="button" class="color-btn" title="형광펜"><span class="color-letter">▱</span><span class="color-bar" style="background:#fff59d"></span></button><button type="button" class="color-arrow" title="색 선택">▾</button></div>' +
    '<span class="sep"></span>' +
    // 정렬
    '<button type="button" data-cmd="justifyLeft" title="왼쪽 (Ctrl+L)">⫷</button>' +
    '<button type="button" data-cmd="justifyCenter" title="가운데 (Ctrl+E)">≡</button>' +
    '<button type="button" data-cmd="justifyRight" title="오른쪽">⫸</button>' +
    '<span class="sep"></span>' +
    // 목록 / 들여쓰기
    '<button type="button" data-cmd="insertUnorderedList" title="글머리 기호">• ≡</button>' +
    '<button type="button" data-cmd="insertOrderedList" title="번호 목록">1. ≡</button>' +
    '<button type="button" data-cmd="outdent" title="내어쓰기">⇤</button>' +
    '<button type="button" data-cmd="indent" title="들여쓰기">⇥</button>' +
    '<span class="sep"></span>' +
    // 링크
    '<button type="button" data-action="link" title="하이퍼링크">🔗</button>' +
    '<span class="sep"></span>' +
    // 서식 제거 / 원본 복원
    '<button type="button" data-cmd="removeFormat" title="서식 제거">↺</button>' +
    '<button type="button" data-action="reset-cell" title="원본으로">⤺</button>';

  // 컬러 팔레트 - Office 비슷한 구성
  const COLOR_PALETTE = [
    ['#000000','#262626','#595959','#7f7f7f','#a6a6a6','#bfbfbf','#d9d9d9','#ffffff'],
    ['#1a3a6c','#c89c4c','#0070c0','#00b050','#7030a0','#806000','#ff0000','#ffc000'],
    ['#d9e2f3','#fbe5d6','#deebf7','#e2efda','#ead1dc','#fff2cc','#fce4d6','#ddd9c4']
  ];
  const HIGHLIGHT_PALETTE = [
    ['#fff59d','#ffe082','#a5d6a7','#80cbc4','#90caf9','#ce93d8','#f48fb1','#ffab91'],
    ['#ffffff','#f5f5f5','#e0e0e0','#bdbdbd'],
  ];

  // 색 팔레트 popover
  const colorPop = document.createElement('div');
  colorPop.id = 'color-popover';
  colorPop.style.display = 'none';
  document.body.appendChild(colorPop);

  function buildPalette(kind) {
    const palette = kind === 'fore' ? COLOR_PALETTE : HIGHLIGHT_PALETTE;
    let html = `<div class="cp-title">${kind === 'fore' ? '글자 색' : '배경(형광펜) 색'}</div><div class="cp-grid">`;
    palette.forEach(row => {
      row.forEach(c => {
        html += `<button type="button" class="cp-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`;
      });
    });
    html += '</div>';
    // 사용자 정의 색상
    html += '<div class="cp-custom"><input type="color" value="#1a3a6c"><span>사용자 정의</span></div>';
    // 색 없음 (배경만)
    if (kind === 'back') {
      html += '<div class="cp-none-row"><button type="button" class="cp-none" data-color="transparent">색 없음</button></div>';
    } else {
      html += '<div class="cp-none-row"><button type="button" class="cp-none" data-color="#222222">기본 (검정)</button></div>';
    }
    return html;
  }

  let currentColorKind = null;
  function openColorPop(kind, anchorBtn) {
    currentColorKind = kind;
    colorPop.innerHTML = buildPalette(kind);
    colorPop.style.display = 'block';
    const r = anchorBtn.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    // 화면 밖 방지
    if (left + 220 > window.innerWidth - 8) left = window.innerWidth - 228;
    if (top + 200 > window.innerHeight - 8) top = r.top - 200 - 6;
    colorPop.style.top = top + 'px';
    colorPop.style.left = Math.max(8, left) + 'px';
    // 핸들러
    colorPop.querySelectorAll('.cp-swatch, .cp-none').forEach(b => {
      b.addEventListener('click', () => applyColor(kind, b.dataset.color));
    });
    const customInput = colorPop.querySelector('input[type="color"]');
    if (customInput) customInput.addEventListener('input', () => applyColor(kind, customInput.value));
  }
  function closeColorPop() {
    colorPop.style.display = 'none';
    currentColorKind = null;
  }
  function applyColor(kind, color) {
    const cmd = kind === 'fore' ? 'foreColor' : 'hiliteColor';
    const finalColor = (kind === 'back' && color === 'transparent') ? 'transparent' : color;
    // 다중 선택 우선
    if (!applyCmdToMulti(cmd, finalColor)) {
      if (!currentEditable) return;
      currentEditable.focus();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, finalColor);
      triggerSaveFromToolbar();
    }
    // 툴바 색 표시 갱신
    const wrap = toolbar.querySelector(`.color-wrap[data-kind="${kind}"] .color-bar`);
    if (wrap) wrap.style.background = color === 'transparent' ? 'repeating-linear-gradient(45deg,#ccc,#ccc 2px,#fff 2px,#fff 4px)' : color;
    closeColorPop();
  }

  // 컬러 버튼 핸들러
  toolbar.querySelectorAll('.color-wrap').forEach(wrap => {
    const kind = wrap.dataset.kind;
    // 본 버튼 = 현재 색상 즉시 적용
    wrap.querySelector('.color-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const c = wrap.querySelector('.color-bar').style.background;
      applyColor(kind, c || (kind === 'fore' ? '#1a3a6c' : '#fff59d'));
    });
    // ▾ = 팔레트 열기
    wrap.querySelector('.color-arrow').addEventListener('click', (e) => {
      e.stopPropagation();
      openColorPop(kind, wrap);
    });
  });

  // 팔레트 외부 클릭 시 닫기
  document.addEventListener('mousedown', (e) => {
    if (colorPop.style.display !== 'block') return;
    if (colorPop.contains(e.target)) return;
    if (e.target.closest('.color-wrap')) return;
    closeColorPop();
  });

  // 크기 드롭다운
  toolbar.querySelector('.size-select').addEventListener('change', (e) => {
    const sizePx = e.target.value;
    // 다중 선택 우선
    if (applySizeToMulti(sizePx)) return;
    if (!currentEditable) return;
    currentEditable.focus();
    const sel = window.getSelection();
    if (sel.rangeCount === 0 || sel.isCollapsed) {
      const range = document.createRange();
      range.selectNodeContents(currentEditable);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = sizePx + 'px';
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } catch (err) {}
    triggerSaveFromToolbar();
  });
  document.body.appendChild(toolbar);

  let currentEditable = null;

  // 셀에 mousedown/focus 들어오면 currentEditable 갱신
  // - .editable 요소뿐 아니라 그 자식 (insight-box 안의 strong, label 등) 클릭도 인식
  document.addEventListener('focusin', (e) => {
    const editable = e.target.closest && e.target.closest('.editable');
    if (editable) {
      currentEditable = editable;
      positionToolbar();
    }
  });

  // 셀 밖 클릭 시 툴바 숨김 (closest로 자식 클릭도 허용)
  document.addEventListener('mousedown', (e) => {
    if (toolbar.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.editable')) return;
    hideToolbar();
    currentEditable = null;
  });

  // 선택영역 변경 시 위치 갱신
  document.addEventListener('selectionchange', () => {
    if (!currentEditable) return;
    if (document.activeElement !== currentEditable) return;
    positionToolbar();
  });

  function positionToolbar() {
    if (!currentEditable) { hideToolbar(); return; }
    toolbar.classList.add('visible');
    const sel = window.getSelection();
    let rect;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        rect = currentEditable.getBoundingClientRect();
      }
    } else {
      rect = currentEditable.getBoundingClientRect();
    }
    // position: fixed - viewport 기준 좌표 사용
    const tbW = toolbar.offsetWidth;
    const tbH = toolbar.offsetHeight;
    const navHeight = 56;
    const viewportH = window.innerHeight;

    // 기본: 셀 위에 띄우기
    let top = rect.top - tbH - 8;
    // 위쪽 공간 부족하면 셀 아래에
    if (top < navHeight + 4) {
      top = rect.bottom + 8;
    }
    // 아래쪽도 벗어나면 화면 하단 고정
    if (top + tbH > viewportH - 4) {
      top = viewportH - tbH - 8;
    }
    // 최후 클램프
    top = Math.max(navHeight + 4, Math.min(top, viewportH - tbH - 4));

    let left = rect.left + rect.width / 2 - tbW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tbW - 8));

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
    updateSizeLabel();
  }

  function hideToolbar() {
    toolbar.classList.remove('visible');
  }

  function updateSizeLabel() {
    if (!currentEditable) return;
    const sizeSelect = toolbar.querySelector('.size-select');
    if (sizeSelect) {
      const sz = Math.round(parseFloat(window.getComputedStyle(currentEditable).fontSize));
      // 가장 가까운 옵션 선택
      let closest = null, minDiff = Infinity;
      Array.from(sizeSelect.options).forEach(o => {
        const d = Math.abs(parseInt(o.value) - sz);
        if (d < minDiff) { minDiff = d; closest = o.value; }
      });
      if (closest) sizeSelect.value = closest;
    }
  }

  // 툴바 클릭 시 셀 포커스 유지
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    e.preventDefault();
  });

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (!currentEditable) return;

    const cmd = btn.dataset.cmd;
    const action = btn.dataset.action;

    if (cmd) {
      // 다중 선택 우선
      if (!applyCmdToMulti(cmd, null)) {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(cmd, false, null);
      }
    } else if (action === 'link') {
      const url = prompt('링크 URL 입력 (https:// 포함):', 'https://');
      if (url && url.trim() && url.trim() !== 'https://') {
        document.execCommand('createLink', false, url.trim());
      }
    } else if (action === 'reset-cell') {
      const original = currentEditable.dataset.originalHtml;
      if (original !== undefined && confirm('이 셀을 원본으로 되돌리시겠습니까? (저장된 수정 내용 사라집니다)')) {
        currentEditable.innerHTML = original;
        if (currentEditable.classList.contains('score-cell')) {
          validateAndRenderScore(currentEditable);
          recalcAllHexagons();
        }
      }
    }
    triggerSaveFromToolbar();
    updateSizeLabel();
  });

  toolbar.querySelector('input[type="color"]').addEventListener('input', (e) => {
    if (!currentEditable) return;
    currentEditable.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, e.target.value);
    triggerSaveFromToolbar();
  });

  function adjustFontSize(delta) {
    if (!currentEditable) return;
    // 포커스가 이미 셀에 없으면 셀로 옮김
    if (document.activeElement !== currentEditable) currentEditable.focus();
    const sel = window.getSelection();
    if (!sel) return;
    // 셀 안에 selection이 있는지 확인
    let hasSelectionInCell = false;
    if (sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      hasSelectionInCell = currentEditable.contains(r.commonAncestorContainer);
    }
    // 셀 안에 selection이 없거나 collapsed면 셀 전체 선택
    if (!hasSelectionInCell || sel.isCollapsed) {
      const range = document.createRange();
      range.selectNodeContents(currentEditable);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const range = sel.getRangeAt(0);
    const refEl = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement || currentEditable;
    const cur = parseFloat(window.getComputedStyle(refEl).fontSize);
    const next = nextSize(cur, delta);
    const span = document.createElement('span');
    span.style.fontSize = next + 'px';
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } catch (e) { /* nested selection 등 */ }
  }

  function nextSize(current, delta) {
    const rounded = Math.round(current);
    let idx = SIZE_PRESETS.findIndex(s => s >= rounded);
    if (idx === -1) idx = SIZE_PRESETS.length - 1;
    idx = Math.max(0, Math.min(SIZE_PRESETS.length - 1, idx + delta));
    return SIZE_PRESETS[idx];
  }

  function triggerSaveFromToolbar() {
    if (!currentEditable) return;
    const id = currentEditable.getAttribute('data-cell-id');
    const scope = currentEditable.getAttribute('data-cell-scope');
    if (!id) return;
    // sectionId는 cellMap에서 조회
    const list = cellMap.get(id);
    const sectionId = list?.[0]?.sectionId;
    saveOne(scope, id, currentEditable.innerHTML, sectionId);
    propagate(id, currentEditable.innerHTML, currentEditable);
  }

  // 스크롤·리사이즈 시 툴바 재배치
  window.addEventListener('scroll', () => { if (currentEditable) positionToolbar(); }, true);
  window.addEventListener('resize', () => { if (currentEditable) positionToolbar(); });

  // ---------- Excel/Word 붙여넣기: 단일 셀 + Excel 다중 셀 일괄 ----------
  document.addEventListener('paste', (e) => {
    const target = e.target.closest && e.target.closest('.editable');
    if (!target) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    if (target.classList.contains('score-cell')) {
      // 점수 셀은 1~5 숫자만 받음 (픽커 사용 권장)
      const m = text.match(/[1-5]/);
      if (m) {
        target.textContent = m[0];
        validateAndRenderScore(target);
        recalcAllHexagons();
        target.dispatchEvent(new Event('blur'));
      }
      return;
    }

    // Excel 다중 셀 감지: 탭(\t)이 있으면 다중 열, 줄바꿈이 여러 개면 다중 행
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const hasTab = normalized.includes('\t');
    const rows = normalized.split('\n').filter(r => r !== '');
    const isMultiCell = hasTab || rows.length > 1;

    if (isMultiCell) {
      // TSV → 평탄화된 값 배열
      const values = [];
      rows.forEach(row => {
        const cols = hasTab ? row.split('\t') : [row];
        cols.forEach(v => values.push(v));
      });
      // 후행 빈 값 제거
      while (values.length && values[values.length - 1].trim() === '') values.pop();

      if (values.length > 1) {
        const section = target.closest('[data-page-content]');
        const allContent = Array.from(
          section ? section.querySelectorAll('.editable:not(.score-cell)') : []
        );
        const startIdx = allContent.indexOf(target);
        if (startIdx >= 0) {
          let filled = 0;
          for (let i = startIdx; i < allContent.length && filled < values.length; i++) {
            const cell = allContent[i];
            const v = values[filled++];
            cell.innerHTML = v
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\n/g, '<br>');
            const id = cell.getAttribute('data-cell-id');
            const scope = cell.getAttribute('data-cell-scope');
            const list = cellMap.get(id);
            const sectionId = list?.[0]?.sectionId;
            saveOne(scope, id, cell.innerHTML, sectionId);
            propagate(id, cell.innerHTML, cell);
          }
          showSaveIndicator(`${filled}개 셀에 붙여넣기`);
          return;
        }
      }
    }

    // 단일 셀 붙여넣기 (기존 동작)
    let toInsert;
    if (html) {
      toInsert = sanitizePastedHtml(html);
    } else {
      toInsert = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
    document.execCommand('insertHTML', false, toInsert);
    setTimeout(() => target.dispatchEvent(new Event('blur')), 0);
  });

  function sanitizePastedHtml(html) {
    // Office 특화 주석 제거
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Office bloat 제거
    doc.querySelectorAll('style, script, meta, link, title, o\\:p').forEach(el => el.remove());

    const body = doc.body;

    // 표를 텍스트로 변환 (행은 줄바꿈, 셀은 공백 구분)
    const tables = body.querySelectorAll('table');
    tables.forEach(table => {
      const frag = document.createDocumentFragment();
      const rows = Array.from(table.querySelectorAll('tr'));
      rows.forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td, th'));
        cells.forEach((cell, j) => {
          Array.from(cell.childNodes).forEach(c => frag.appendChild(c.cloneNode(true)));
          if (j < cells.length - 1) frag.appendChild(document.createTextNode(' '));
        });
        if (i < rows.length - 1) frag.appendChild(document.createElement('br'));
      });
      table.replaceWith(frag);
    });

    // class/lang 등 메타속성 제거, style은 화이트리스트만 유지
    const ALLOWED_STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'font-size', 'text-decoration'];
    body.querySelectorAll('*').forEach(el => {
      ['class', 'lang', 'id', 'role', 'data-mce-style', 'width', 'height', 'align', 'valign'].forEach(a => el.removeAttribute(a));
      if (el.style && el.style.cssText) {
        const kept = [];
        ALLOWED_STYLES.forEach(prop => {
          const v = el.style.getPropertyValue(prop);
          if (v) kept.push(`${prop}: ${v}`);
        });
        if (kept.length) el.setAttribute('style', kept.join('; '));
        else el.removeAttribute('style');
      }
      // 모르는 태그는 unwrap (자식만 남김)
      const ALLOWED_TAGS = ['B','STRONG','I','EM','U','SPAN','FONT','BR','P','DIV','SUB','SUP','S','STRIKE'];
      if (!ALLOWED_TAGS.includes(el.tagName)) {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
      }
    });

    // 빈 span 제거
    body.querySelectorAll('span').forEach(s => {
      if (!s.hasAttribute('style') && !s.children.length) {
        while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
        s.remove();
      }
    });

    return body.innerHTML;
  }

  // ---------- 다중 셀 선택 (드래그 / Ctrl+클릭 / Shift+클릭) ----------
  const multiSelected = new Set();
  let dragStartCell = null;
  let dragInitialPos = null;
  let dragActive = false;
  let lastClickedCell = null;

  function addToMulti(cell) {
    if (!cell || cell.classList.contains('score-cell')) return; // 점수 셀은 픽커 사용
    multiSelected.add(cell);
    cell.classList.add('multi-selected');
  }
  function clearMulti() {
    multiSelected.forEach(c => c.classList.remove('multi-selected'));
    multiSelected.clear();
  }
  function selectCellRange(from, to) {
    clearMulti();
    const sec = from.closest('[data-page-content]');
    if (!sec) return;
    const all = Array.from(sec.querySelectorAll('.editable'));
    const i1 = all.indexOf(from), i2 = all.indexOf(to);
    if (i1 < 0 || i2 < 0) return;
    const [lo, hi] = [Math.min(i1, i2), Math.max(i1, i2)];
    for (let i = lo; i <= hi; i++) addToMulti(all[i]);
  }

  document.addEventListener('mousedown', (e) => {
    const cell = e.target.closest && e.target.closest('.editable');
    if (!cell) {
      if (!toolbar.contains(e.target)
          && !document.getElementById('color-popover')?.contains(e.target)
          && !document.getElementById('score-picker')?.contains(e.target)) {
        clearMulti();
      }
      return;
    }

    // 점수 셀: 텍스트 포커스 막고 즉시 픽커 (click 이벤트에 의존 X)
    if (cell.classList.contains('score-cell')) {
      e.preventDefault();
      clearMulti();
      showScorePicker(cell);
      return;
    }

    // Shift+click: 범위 선택
    if (e.shiftKey && lastClickedCell) {
      e.preventDefault();
      selectCellRange(lastClickedCell, cell);
      currentEditable = cell;
      positionToolbar();
      return;
    }
    // Ctrl+click: 토글
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (multiSelected.has(cell)) {
        cell.classList.remove('multi-selected');
        multiSelected.delete(cell);
      } else addToMulti(cell);
      currentEditable = cell;
      positionToolbar();
      return;
    }
    // 더블클릭 이상: 브라우저 워드 선택 허용
    if (e.detail >= 2) {
      lastClickedCell = cell;
      return;
    }
    // 단일 클릭: 브라우저 텍스트 선택 차단, mouseup에서 커서 수동 배치
    e.preventDefault();
    lastClickedCell = cell;
    dragStartCell = cell;
    dragInitialPos = { x: e.clientX, y: e.clientY };
    dragActive = false;
    pendingFocusCell = cell;
    pendingFocusPoint = { x: e.clientX, y: e.clientY };
  });

  let pendingFocusCell = null;
  let pendingFocusPoint = null;

  function placeCursorAt(cell, x, y) {
    cell.focus();
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  }

  document.addEventListener('mousemove', (e) => {
    if (!dragStartCell) return;
    const dx = Math.abs(e.clientX - dragInitialPos.x);
    const dy = Math.abs(e.clientY - dragInitialPos.y);
    if (!dragActive && (dx > 5 || dy > 5)) {
      const overCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.editable');
      if (overCell && overCell !== dragStartCell && !overCell.classList.contains('score-cell')) {
        dragActive = true;
        pendingFocusCell = null;
        clearMulti();
        document.body.classList.add('cell-dragging');
        window.getSelection()?.removeAllRanges();
      }
    }
    if (dragActive) {
      e.preventDefault();
      const overCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.editable');
      if (overCell && !overCell.classList.contains('score-cell')) {
        selectCellRange(dragStartCell, overCell);
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (dragActive) {
      document.body.classList.remove('cell-dragging');
      window.getSelection()?.removeAllRanges();
      if (multiSelected.size > 0) { currentEditable = dragStartCell; positionToolbar(); }
    } else if (pendingFocusCell) {
      clearMulti();
      currentEditable = pendingFocusCell;
      placeCursorAt(pendingFocusCell, pendingFocusPoint.x, pendingFocusPoint.y);
      positionToolbar();
    }
    dragStartCell = null; dragInitialPos = null; dragActive = false;
    pendingFocusCell = null; pendingFocusPoint = null;
  });

  document.addEventListener('selectstart', (e) => { if (dragActive) e.preventDefault(); });

  // 다중 셀에 명령 적용 - 셀별 selectAll + execCommand
  function applyCmdToMulti(cmd, value, useCSS = true) {
    if (multiSelected.size === 0) return false;
    multiSelected.forEach(cell => {
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (useCSS) document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, value);
      const id = cell.getAttribute('data-cell-id');
      const scope = cell.getAttribute('data-cell-scope');
      const list = cellMap.get(id);
      const sectionId = list?.[0]?.sectionId;
      saveOne(scope, id, cell.innerHTML, sectionId);
      propagate(id, cell.innerHTML, cell);
    });
    return true;
  }
  // 다중 셀에 폰트 크기 적용
  function applySizeToMulti(sizePx) {
    if (multiSelected.size === 0) return false;
    multiSelected.forEach(cell => {
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const span = document.createElement('span');
      span.style.fontSize = sizePx + 'px';
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch (e) {}
      const id = cell.getAttribute('data-cell-id');
      const scope = cell.getAttribute('data-cell-scope');
      const list = cellMap.get(id);
      const sectionId = list?.[0]?.sectionId;
      saveOne(scope, id, cell.innerHTML, sectionId);
      propagate(id, cell.innerHTML, cell);
    });
    return true;
  }

  // ---------- 점수 픽커 (1~5 큰 버튼 모달) ----------
  const SCORE_LABELS = {
    1: '없음·매우 약함',
    2: '부분·약함',
    3: '보유·평균',
    4: '강점·1위',
    5: '압도적·차별화'
  };
  const scorePicker = document.createElement('div');
  scorePicker.id = 'score-picker';
  scorePicker.innerHTML =
    '<div class="sp-header">' +
      '<div><div class="sp-title"></div><div class="sp-sub"></div></div>' +
      '<button type="button" class="sp-close" title="닫기 (Esc)">×</button>' +
    '</div>' +
    '<div class="sp-body">' +
      '<div class="sp-options-wrap">' +
        '<div class="sp-change-info"><span class="sp-from"></span> <span class="sp-arrow">→</span> <span class="sp-to"></span></div>' +
        '<div class="sp-options">' +
          [1, 2, 3, 4, 5].map(n =>
            `<button type="button" data-val="${n}"><div class="sp-num">${n}</div><div class="sp-label">${SCORE_LABELS[n]}</div></button>`
          ).join('') +
        '</div>' +
      '</div>' +
      '<div class="sp-preview">' +
        '<div class="sp-preview-label">실시간 미리보기</div>' +
        '<div class="sp-preview-svg-wrap"></div>' +
      '</div>' +
    '</div>' +
    '<div class="sp-foot">키보드 1~5 / Esc 닫기 ・ 마우스 올리면 미리보기</div>';
  document.body.appendChild(scorePicker);

  let pickerTarget = null;

  function showScorePicker(cell) {
    pickerTarget = cell;
    const current = getScoreValue(cell);
    // 헤더
    const row = cell.closest('tr');
    const indName = row?.querySelector('.indicator-name')?.textContent?.trim() || '';
    const axisName = row?.querySelector('.axis-cell')?.textContent?.trim()
      || (cell.closest('tbody')?.querySelector('tr .axis-cell')?.textContent?.trim() || '');
    // 어느 컬럼인지 (CJ인지 경쟁사인지)
    let owner = '';
    if (cell.classList.contains('cj')) owner = 'CJ대한통운';
    else {
      const allScores = Array.from(row?.querySelectorAll('.score-cell') || []);
      const idx = allScores.indexOf(cell);
      if (idx > 0) {
        const header = cell.closest('table')?.querySelectorAll('thead th.player')[idx - 1]?.textContent?.trim() || '경쟁사';
        owner = header.replace(/\s+/g, ' ');
      }
    }
    scorePicker.querySelector('.sp-title').textContent = `${indName} ・ ${owner}`;
    scorePicker.querySelector('.sp-sub').textContent = axisName.replace(/\s+/g, ' ');

    // 현재 → 변경값 인디케이터
    scorePicker.querySelector('.sp-from').textContent = current || '?';
    scorePicker.querySelector('.sp-from').className = 'sp-from' + (current ? ` score-${current}` : '');
    scorePicker.querySelector('.sp-to').textContent = '?';
    scorePicker.querySelector('.sp-to').className = 'sp-to';

    // 현재 점수 하이라이트
    scorePicker.querySelectorAll('button[data-val]').forEach(b => {
      b.classList.toggle('current', parseInt(b.dataset.val) === current);
    });

    // 섹션의 radar SVG를 복제해서 미리보기에 박음
    const sectionId = cell.closest('[data-page-content]')?.dataset.pageContent;
    const info = sectionInfos.get(sectionId);
    const sourceSvg = info?.section.querySelector('.radar-svg');
    const previewWrap = scorePicker.querySelector('.sp-preview-svg-wrap');
    if (sourceSvg && previewWrap) {
      previewWrap.innerHTML = '';
      const clone = sourceSvg.cloneNode(true);
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      clone.classList.add('sp-radar');
      previewWrap.appendChild(clone);
    }

    // 위치 결정 (cell 옆 또는 아래)
    scorePicker.style.visibility = 'hidden';
    scorePicker.style.display = 'block';
    const pw = scorePicker.offsetWidth;
    const ph = scorePicker.offsetHeight;
    const rect = cell.getBoundingClientRect();
    let top = rect.top;
    let left = rect.right + 12;
    if (left + pw > window.innerWidth - 16) {
      left = rect.left - pw - 12;
      if (left < 16) {
        left = Math.max(16, rect.left);
        top = rect.bottom + 8;
      }
    }
    if (top + ph > window.innerHeight - 16) {
      top = Math.max(72, window.innerHeight - ph - 16);
    }
    scorePicker.style.top = top + 'px';
    scorePicker.style.left = left + 'px';
    scorePicker.style.visibility = 'visible';

    // 해당 축 하이라이트 (육각형)
    highlightHexagonAxis(cell);
  }

  function hideScorePicker() {
    scorePicker.style.display = 'none';
    pickerTarget = null;
    clearHexagonHighlight();
  }

  function setScoreFromPicker(val) {
    if (!pickerTarget) return;
    pickerTarget.textContent = String(val);
    validateAndRenderScore(pickerTarget);
    recalcAllHexagons();
    const id = pickerTarget.getAttribute('data-cell-id');
    const scope = pickerTarget.getAttribute('data-cell-scope');
    const list = cellMap.get(id);
    const sectionId = list?.[0]?.sectionId;
    propagate(id, String(val), pickerTarget);
    saveOne(scope, id, String(val), sectionId);
    hideScorePicker();
  }

  // 픽커 버튼 핸들러: 클릭 + hover 미리보기
  scorePicker.querySelectorAll('button[data-val]').forEach(btn => {
    btn.addEventListener('click', () => setScoreFromPicker(parseInt(btn.dataset.val)));
    btn.addEventListener('mouseenter', () => previewScore(parseInt(btn.dataset.val)));
    btn.addEventListener('mouseleave', () => previewScore(null));
  });
  scorePicker.querySelector('.sp-close').addEventListener('click', hideScorePicker);

  // 미리보기: 어떤 값으로 바꾸면 어떻게 되는지 — 픽커 안 mini SVG에 그림
  function previewScore(val) {
    if (!pickerTarget) return;
    const previewSvg = scorePicker.querySelector('.sp-radar');
    if (!previewSvg) return;
    const sectionId = pickerTarget.closest('[data-page-content]')?.dataset.pageContent;
    const info = sectionInfos.get(sectionId);
    if (!info) return;

    // pickerTarget이 어느 컬럼인지 판별
    let cells, polyColor;
    if (info.cjScoreCells.some(sc => sc.el === pickerTarget)) {
      cells = info.cjScoreCells; polyColor = '#c89c4c';
    } else if (info.comp1ScoreCells.some(sc => sc.el === pickerTarget)) {
      cells = info.comp1ScoreCells; polyColor = '#1a3a6c';
    } else if (info.comp2ScoreCells.some(sc => sc.el === pickerTarget)) {
      cells = info.comp2ScoreCells; polyColor = '#8a2929';
    } else return;

    // val이 null이면 원래 상태, 숫자면 해당 값으로 시뮬레이션
    const avgs = {};
    for (let a = 1; a <= 6; a++) {
      const scores = cells.filter(sc => sc.axis === a)
        .map(sc => (sc.el === pickerTarget && val !== null) ? val : getScoreValue(sc.el))
        .filter(v => v !== null);
      avgs[a] = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0;
    }
    const newCoords = coords(avgs);
    const pointsString = pointsStr(newCoords);

    // standalone (korea) 페이지: rgba 폴리곤
    // comparison: stroke로 식별
    let targetPoly;
    if (info.isComparison) {
      targetPoly = findPolyByStroke(previewSvg, polyColor);
    } else {
      targetPoly = findPolyByFillStart(previewSvg, 'rgba');
    }
    if (targetPoly) {
      targetPoly.style.transition = 'none';
      targetPoly.setAttribute('points', pointsString);
    }

    // 변경 인디케이터 갱신
    const toEl = scorePicker.querySelector('.sp-to');
    if (val !== null) {
      toEl.textContent = val;
      toEl.className = `sp-to score-${val}`;
    } else {
      toEl.textContent = '?';
      toEl.className = 'sp-to';
    }
  }

  // 점수 셀 → mousedown 핸들러에서 처리됨

  // 외부 클릭 / Esc / 숫자 키
  document.addEventListener('mousedown', (e) => {
    if (scorePicker.style.display !== 'block') return;
    if (scorePicker.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.score-cell')) return;
    hideScorePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (scorePicker.style.display !== 'block') return;
    if (e.key === 'Escape') { e.preventDefault(); hideScorePicker(); return; }
    if (e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      setScoreFromPicker(parseInt(e.key));
    }
  }, true);

  // 육각형 축 하이라이트
  function highlightHexagonAxis(cell) {
    const sectionId = cell.closest('[data-page-content]')?.dataset.pageContent;
    if (!sectionId) return;
    const info = sectionInfos.get(sectionId);
    if (!info) return;
    const row = cell.closest('tr');
    if (!row) return;
    // 어느 축에 속하는지 (axis number)
    const allRows = Array.from(row.parentElement.children);
    let axisNum = 0;
    for (let i = 0; i <= allRows.indexOf(row); i++) {
      if (allRows[i].querySelector('.axis-cell')) axisNum++;
    }
    const svg = info.section.querySelector('.radar-svg');
    if (!svg) return;
    const lines = svg.querySelectorAll('line');
    lines.forEach((line, i) => {
      if (i === axisNum - 1) {
        line.setAttribute('stroke', '#c89c4c');
        line.setAttribute('stroke-width', '2');
      }
    });
  }
  function clearHexagonHighlight() {
    document.querySelectorAll('.radar-svg line').forEach(line => {
      line.setAttribute('stroke', '#bbb');
      line.setAttribute('stroke-width', '0.5');
    });
  }

  // ---------- 육각형 부드러운 모핑 ----------
  const prevPolygonPoints = new WeakMap();

  function animatePolygon(poly, newPointsStr, duration = 400) {
    const oldStr = prevPolygonPoints.get(poly) || poly.getAttribute('points') || '';
    const oldPts = parsePoints(oldStr);
    const newPts = parsePoints(newPointsStr);
    if (oldPts.length !== newPts.length) {
      poly.setAttribute('points', newPointsStr);
      prevPolygonPoints.set(poly, newPointsStr);
      return;
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const interp = oldPts.map((p, i) => [
        p[0] + (newPts[i][0] - p[0]) * eased,
        p[1] + (newPts[i][1] - p[1]) * eased
      ]);
      poly.setAttribute('points', interp.map(p => p.join(',')).join(' '));
      if (t < 1) requestAnimationFrame(frame);
      else prevPolygonPoints.set(poly, newPointsStr);
    }
    requestAnimationFrame(frame);
  }
  function parsePoints(str) {
    return str.trim().split(/\s+/).map(p => p.split(',').map(Number));
  }

  // 기존 setAttribute 호출을 animatePolygon으로 교체 - recalcOne 안에서
  const originalRecalcOne = recalcOne;
  recalcOne = function(info) {
    const svg = info.section.querySelector('.radar-svg');
    if (!svg) { originalRecalcOne(info); return; }
    if (info.isComparison) {
      const cjC = coords(axisAverages(info.cjScoreCells));
      const c1C = coords(axisAverages(info.comp1ScoreCells));
      const c2C = coords(axisAverages(info.comp2ScoreCells));
      const cjP = findPolyByStroke(svg, '#c89c4c');
      const c1P = findPolyByStroke(svg, '#1a3a6c');
      const c2P = findPolyByStroke(svg, '#8a2929');
      if (cjP) animatePolygon(cjP, pointsStr(cjC));
      if (c1P) animatePolygon(c1P, pointsStr(c1C));
      if (c2P) animatePolygon(c2P, pointsStr(c2C));

      const sectionId = info.section.dataset.pageContent;
      const ovCard = document.querySelector(`.overview-card[data-overview-for="${sectionId}"]`);
      if (ovCard) {
        const ovCj = ovCard.querySelector('.ov-poly-cj');
        const ovC1 = ovCard.querySelector('.ov-poly-c1');
        const ovC2 = ovCard.querySelector('.ov-poly-c2');
        if (ovCj) animatePolygon(ovCj, pointsStr(cjC));
        if (ovC1) animatePolygon(ovC1, pointsStr(c1C));
        if (ovC2) animatePolygon(ovC2, pointsStr(c2C));
      }
    } else {
      const avgs = axisAverages(info.cjScoreCells);
      const c = coords(avgs);
      const dataPoly = findPolyByFillStart(svg, 'rgba');
      if (dataPoly) animatePolygon(dataPoly, pointsStr(c));
      const circles = Array.from(svg.querySelectorAll('circle')).filter(x => x.getAttribute('r') === '2.5');
      circles.forEach((cir, i) => {
        if (c[i]) {
          cir.style.transition = 'cx 0.4s ease-out, cy 0.4s ease-out';
          cir.setAttribute('cx', c[i][0]);
          cir.setAttribute('cy', c[i][1]);
        }
      });
      const texts = svg.querySelectorAll('text');
      for (let a = 0; a < 6; a++) {
        const vt = texts[a*2+1];
        if (vt) vt.textContent = avgs[a+1].toFixed(1);
      }
      const all = info.cjScoreCells.map(x => getScoreValue(x.el)).filter(v => v !== null);
      const overall = all.length ? (all.reduce((a,b)=>a+b,0)/all.length).toFixed(2) : '0.00';
      const legend = info.section.querySelector('.radar-legend');
      if (legend) legend.textContent = `전체 평균 ${overall} / 5.0 ・ 점수는 회의 합의 후 조정 가능`;
    }
  };

  // ---------- 시작 ----------
  init();
})();
