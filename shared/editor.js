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

    // 2) 서식 단축키: Ctrl+B / Ctrl+I / Ctrl+U
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
        triggerSaveFromToolbar();
        return;
      }
      // 3) 크기 단축키: Ctrl++ / Ctrl+- (=과 -)
      if (e.key === '+' || e.key === '=' ) {
        e.preventDefault();
        adjustFontSize(1);
        triggerSaveFromToolbar();
        updateSizeLabel();
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        adjustFontSize(-1);
        triggerSaveFromToolbar();
        updateSizeLabel();
        return;
      }
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
    '<button type="button" data-cmd="bold" title="굵게 (Ctrl+B)">B</button>' +
    '<button type="button" data-cmd="italic" title="기울임 (Ctrl+I)">I</button>' +
    '<button type="button" data-cmd="underline" title="밑줄 (Ctrl+U)">U</button>' +
    '<span class="sep"></span>' +
    '<button type="button" data-action="size-down" title="작게">A−</button>' +
    '<span class="size-label" id="size-label">−</span>' +
    '<button type="button" data-action="size-up" title="크게">A+</button>' +
    '<span class="sep"></span>' +
    '<input type="color" data-cmd="foreColor" value="#1a3a6c" title="글자 색">' +
    '<button type="button" data-cmd="removeFormat" title="서식 제거">↺</button>' +
    '<span class="sep"></span>' +
    '<button type="button" data-action="reset-cell" title="이 셀을 원본으로 되돌리기">⤺ 원본</button>';
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
    const top = rect.top + window.scrollY - toolbar.offsetHeight - 8;
    let left = rect.left + window.scrollX + rect.width / 2 - toolbar.offsetWidth / 2;
    // 화면 밖으로 안 나가게
    left = Math.max(8, Math.min(left, window.innerWidth - toolbar.offsetWidth - 8));
    toolbar.style.top = (top < window.scrollY + 64 ? rect.bottom + window.scrollY + 8 : top) + 'px';
    toolbar.style.left = left + 'px';
    updateSizeLabel();
  }

  function hideToolbar() {
    toolbar.classList.remove('visible');
  }

  function updateSizeLabel() {
    const label = toolbar.querySelector('#size-label');
    if (!label || !currentEditable) return;
    const sz = parseFloat(window.getComputedStyle(currentEditable).fontSize);
    label.textContent = isNaN(sz) ? '−' : Math.round(sz) + 'px';
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
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, null);
    } else if (action === 'size-up' || action === 'size-down') {
      adjustFontSize(action === 'size-up' ? 1 : -1);
    } else if (action === 'reset-cell') {
      const original = currentEditable.dataset.originalHtml;
      if (original !== undefined && confirm('이 셀을 원본으로 되돌리시겠습니까? (저장된 수정 내용 사라집니다)')) {
        currentEditable.innerHTML = original;
        // score 셀이면 색깔 재적용
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

  // ---------- Excel/Word 붙여넣기: 표 구조 제거 + 서식만 유지 ----------
  document.addEventListener('paste', (e) => {
    const target = e.target.closest && e.target.closest('.editable');
    if (!target) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    if (target.classList.contains('score-cell')) {
      // 점수 셀은 1~5 숫자만 받음
      const m = text.match(/[1-5]/);
      if (m) {
        target.textContent = m[0];
        validateAndRenderScore(target);
        recalcAllHexagons();
        target.dispatchEvent(new Event('blur'));
      }
      return;
    }

    let toInsert;
    if (html) {
      toInsert = sanitizePastedHtml(html);
    } else {
      // 일반 텍스트: 줄바꿈은 <br>로
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

  // ---------- 시작 ----------
  init();
})();
