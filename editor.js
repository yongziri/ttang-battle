/* 문제 편집기 — 순수 함수(EditorLogic, node 테스트 가능) + 편집기 화면
   저장 구조(localStorage 'ttang-battle-sets-v1'): { v: 1, user: [내가 만든 세트], overrides: { 기본세트id: {title, description, questions} } }
   기본 세트 원본(sets/*.js)은 건드리지 않는다. 게임에서 쓰는 세트 = 기본 세트(덮어쓰기 적용) + 내 세트. */
(function (root) {
  'use strict';

  var STORE_KEY = 'ttang-battle-sets-v1';
  var FORMAT = 'ttang-battle-sets';
  var MAX_FILE = 30 * 1024 * 1024;

  // ---------------------------------------------------------------- 순수 함수
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  /** 난이도: 1~3 이 아니면 2 */
  function normLevel(v) {
    var n = Number(str(v).trim());
    return n === 1 || n === 2 || n === 3 ? n : 2;
  }
  // 보기형: game.js Logic.normalizeChoices / choiceIndex 와 같은 규칙(테스트로 둘이 같은지 확인)
  var CIRCLED = ['①', '②', '③', '④', '⑤'];
  function normalizeChoices(arr) {
    if (!Array.isArray(arr)) return null;
    var out = arr.filter(function (c) { return typeof c === 'string' || typeof c === 'number'; })
      .map(function (c) { return String(c).trim(); }).filter(Boolean);
    return out.length >= 2 && out.length <= 5 ? out : null;
  }
  function squash(s) { return String(s).replace(/\s+/g, '').toLowerCase(); }
  function choiceIndex(choices, a) {
    if (!Array.isArray(choices) || !choices.length) return -1;
    var key = squash(a === undefined || a === null ? '' : a);
    if (!key) return -1;
    for (var i = 0; i < choices.length; i++) if (squash(choices[i]) === key) return i;
    var ci = CIRCLED.indexOf(key);
    if (ci !== -1 && ci < choices.length) return ci;
    if (/^[1-5]$/.test(key) && Number(key) <= choices.length) return Number(key) - 1;
    return -1;
  }
  /** 출제 가능: 문제·정답이 있고, 보기가 있으면 정답이 보기 중 하나를 가리켜야 한다 */
  function isValidQuestion(q) {
    if (!q || str(q.q).trim() === '' || str(q.a).trim() === '') return false;
    var ch = normalizeChoices(q.choices);
    return !ch || choiceIndex(ch, q.a) !== -1;
  }
  /** 그림 주소 검증: data:image/… 또는 상대 경로만, 그 외(http:, javascript: 등)는 '' (game.js Logic.sanitizeImg 와 같은 규칙) */
  function sanitizeImg(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim();
    if (!s) return '';
    if (/^data:image\//i.test(s)) return s;
    if (s.indexOf(':') !== -1 || /^[\\/]/.test(s) || /[<>"'\n\r\t]/.test(s)) return '';
    return s;
  }
  /** 문항 복사. raw=true(편집 중 저장본)면 보기 입력칸을 빈 칸까지 그대로(최대 5) 둔다 */
  function cloneQ(q, raw) {
    var o = { q: str(q.q), a: str(q.a), level: normLevel(q.level) };
    if (str(q.note) !== '') o.note = str(q.note);
    var img = sanitizeImg(q.img);
    if (img) o.img = img;
    if (raw && Array.isArray(q.choices)) {
      o.choices = q.choices.slice(0, 5).map(function (c) { return typeof c === 'string' || typeof c === 'number' ? String(c) : ''; });
    } else {
      var ch = normalizeChoices(q.choices);
      if (ch) o.choices = ch;
    }
    return o;
  }
  function cloneSet(s, raw) {
    return { id: str(s.id), title: str(s.title), description: str(s.description),
      questions: (s.questions || []).map(function (q) { return cloneQ(q, raw); }) };
  }

  /** 탭 구분 텍스트(엑셀·한글 표 복사). 큰따옴표로 감싼 칸(줄바꿈 포함)도 처리 */
  function parseTSV(text) {
    var rows = [], row = [], cell = '', i = 0, n = text.length;
    function quotedEnd(start) {
      // start 는 여는 따옴표 다음 위치. 닫는 따옴표 뒤가 탭/줄바꿈/끝이어야 진짜 따옴표 칸
      for (var j = start; j < n; j++) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j++; continue; }
          var nx = text[j + 1];
          return nx === undefined || nx === '\t' || nx === '\n' ? j : -1;
        }
      }
      return -1;
    }
    while (i < n) {
      var ch = text[i];
      if (ch === '"' && cell === '') {
        var end = quotedEnd(i + 1);
        if (end !== -1) { cell = text.slice(i + 1, end).replace(/""/g, '"'); i = end + 1; continue; }
      }
      if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    row.push(cell); rows.push(row);
    return rows;
  }

  /**
   * 붙여넣기 파싱: 줄마다 문제<탭>정답<탭>난이도<탭>메모 (탭이 없으면 | 구분).
   * 반환 { items: [{q,a,level,note?}], skipped: 건너뛴 줄 수(빈 줄 제외) }
   */
  function parsePaste(text) {
    text = str(text).replace(/\r\n?/g, '\n');
    var rows = text.indexOf('\t') !== -1
      ? parseTSV(text)
      : text.split('\n').map(function (l) { return [l]; });
    var items = [], skipped = 0;
    rows.forEach(function (cells) {
      if (cells.length === 1 && cells[0].indexOf('|') !== -1) cells = cells[0].split('|');
      var cs = cells.map(function (c) { return str(c).trim(); });
      if (cs.every(function (c) { return c === ''; })) return; // 빈 줄
      var q = cs[0] || '', a = cs[1] || '';
      if (!q || !a || (q === '문제' && a === '정답')) { skipped++; return; } // 정답 없음, 머리글 줄
      var item = { q: q, a: a, level: normLevel(cs[2]) };
      if (cs[3]) item.note = cs[3];
      // 5번째 칸 이후: 보기1;보기2;… (칸이 여러 개면 이어 붙여 ; 로 나눔)
      var ch = normalizeChoices(cs.slice(4).join(';').split(';'));
      if (ch) item.choices = ch;
      items.push(item);
    });
    return { items: items, skipped: skipped };
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isText(v) { return v === undefined || v === null || typeof v === 'string' || typeof v === 'number'; }

  /**
   * 가져오기 파일(JSON 문자열) 검증·정규화. 단일 세트 / 세트 배열 / { sets: [...] } 모두 허용.
   * 반환 { ok: true, sets } 또는 { ok: false, error: 한 줄 설명 }
   */
  function parseImport(text) {
    if (str(text).length > MAX_FILE) return { ok: false, error: '파일이 너무 큽니다(30MB 이하만 가져올 수 있습니다)' };
    var data;
    try { data = JSON.parse(str(text).replace(/^﻿/, '')); }
    catch (e) { return { ok: false, error: 'JSON 형식이 아닙니다(파일이 깨졌거나 다른 종류의 파일입니다)' }; }
    var list;
    if (Array.isArray(data)) list = data;
    else if (isObj(data) && Array.isArray(data.sets)) list = data.sets;
    else if (isObj(data) && Array.isArray(data.questions)) list = [data];
    else return { ok: false, error: '문제 세트가 들어 있지 않습니다(sets 또는 questions 목록이 없음)' };
    if (!list.length) return { ok: false, error: '파일에 세트가 하나도 없습니다' };
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], where = (i + 1) + '번째 세트';
      if (!isObj(s)) return { ok: false, error: where + '의 형식이 잘못되었습니다' };
      if (!Array.isArray(s.questions)) return { ok: false, error: where + '에 questions(문항 목록)가 없습니다' };
      if (!isText(s.title) || !isText(s.description)) return { ok: false, error: where + '의 title 또는 description 이 글자가 아닙니다' };
      var qs = [];
      for (var j = 0; j < s.questions.length; j++) {
        var q = s.questions[j];
        if (!isObj(q) || !isText(q.q) || !isText(q.a) || !isText(q.note) ||
          (q.choices !== undefined && q.choices !== null && !Array.isArray(q.choices))) {
          return { ok: false, error: where + ' ' + (j + 1) + '번 문항의 형식이 잘못되었습니다' };
        }
        qs.push(cloneQ(q));
      }
      out.push({
        id: typeof s.id === 'string' ? s.id.trim() : '',
        title: str(s.title).trim() || '이름 없는 세트',
        description: str(s.description),
        questions: qs
      });
    }
    return { ok: true, sets: out };
  }

  /** id 로 쓸 수 있게(영문·숫자·-·_) */
  function slug(s) { return str(s).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
  function uniqueId(base, ids) {
    base = slug(base) || 'my-set';
    if (ids.indexOf(base) === -1) return base;
    for (var n = 2; ; n++) if (ids.indexOf(base + '-' + n) === -1) return base + '-' + n;
  }
  /** 같은 제목이 있으면 "제목 (2)", "제목 (3)" … */
  function uniqueTitle(title, titles) {
    title = str(title).trim() || '이름 없는 세트';
    if (titles.indexOf(title) === -1) return title;
    for (var n = 2; ; n++) { var t = title + ' (' + n + ')'; if (titles.indexOf(t) === -1) return t; }
  }
  /** 새 세트들에 기존과 겹치지 않는 id·제목을 붙인다(가져오기, 복제) */
  function placeSets(newSets, existing) {
    var ids = existing.map(function (s) { return s.id; });
    var titles = existing.map(function (s) { return s.title; });
    return newSets.map(function (s) {
      var c = cloneSet(s);
      c.id = uniqueId(s.id, ids); ids.push(c.id);
      c.title = uniqueTitle(s.title, titles); titles.push(c.title);
      return c;
    });
  }

  function emptyStore() { return { v: 1, user: [], overrides: {} }; }
  /** 저장본을 안전한 모양으로(깨진 값은 버림) */
  function normalizeStore(raw) {
    var st = emptyStore();
    if (!isObj(raw)) return st;
    if (Array.isArray(raw.user)) raw.user.forEach(function (s) {
      if (isObj(s) && typeof s.id === 'string' && s.id && Array.isArray(s.questions)) st.user.push(cloneSet(s, true));
    });
    if (isObj(raw.overrides)) Object.keys(raw.overrides).forEach(function (id) {
      var o = raw.overrides[id];
      if (isObj(o) && Array.isArray(o.questions)) st.overrides[id] = cloneSet({ id: id, title: o.title, description: o.description, questions: o.questions }, true);
    });
    return st;
  }

  /** 기본 세트(덮어쓰기 적용) + 내 세트. 각 세트에 builtin / modified 표시 */
  function mergeSets(builtins, store) {
    store = normalizeStore(store);
    var out = [];
    (builtins || []).forEach(function (b) {
      if (!b || !b.id) return;
      var o = store.overrides[b.id];
      var s = cloneSet(o || b);
      s.id = b.id;
      if (!s.title) s.title = str(b.title) || b.id;
      s.builtin = true; s.modified = !!o;
      out.push(s);
    });
    store.user.forEach(function (u) {
      var s = cloneSet(u);
      if (out.some(function (x) { return x.id === s.id; })) s.id = uniqueId(s.id, out.map(function (x) { return x.id; }));
      s.builtin = false; s.modified = false;
      out.push(s);
    });
    return out;
  }

  /** 게임 출제용: 문제·정답이 빈 문항 제외 */
  function playableSets(sets) {
    return sets.map(function (s) {
      var c = cloneSet(s);
      c.builtin = s.builtin; c.modified = s.modified;
      c.questions = c.questions.filter(isValidQuestion);
      return c;
    });
  }
  function countValid(set) { return (set.questions || []).filter(isValidQuestion).length; }

  /** 내보내기 파일 내용 */
  function buildExport(sets) {
    return { format: FORMAT, version: 1, sets: sets.map(cloneSet) };
  }
  function exportFileName(title) {
    var t = str(title).trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || '세트';
    return '땅따먹기-' + t + '.json';
  }

  var EditorLogic = {
    STORE_KEY: STORE_KEY, FORMAT: FORMAT,
    normLevel: normLevel, isValidQuestion: isValidQuestion, sanitizeImg: sanitizeImg, parsePaste: parsePaste, parseImport: parseImport,
    normalizeChoices: normalizeChoices, choiceIndex: choiceIndex,
    uniqueId: uniqueId, uniqueTitle: uniqueTitle, placeSets: placeSets, normalizeStore: normalizeStore,
    mergeSets: mergeSets, playableSets: playableSets, countValid: countValid, buildExport: buildExport, exportFileName: exportFileName
  };
  root.TTEditorLogic = EditorLogic;
  if (typeof module === 'object' && module && module.exports) module.exports = EditorLogic;
  if (typeof document === 'undefined') return;

  // =====================================================================
  // 편집기 화면 (브라우저 전용). 사용자 문자열은 전부 value / textContent 로만 넣는다.
  // =====================================================================
  var $ = function (id) { return document.getElementById(id); };
  var store = emptyStore();
  var canSave = true;
  var selId = null;
  var saveTimer = null;

  function builtins() { return Array.isArray(root.QUIZ_SETS) ? root.QUIZ_SETS : []; }
  function builtinById(id) { return builtins().filter(function (b) { return b.id === id; })[0] || null; }
  function getAllSets() { return mergeSets(builtins(), store); }
  function getPlayableSets() { return playableSets(getAllSets()); }

  function loadStore() {
    // 읽기와 쓰기 가능 여부를 따로 본다(쓰기만 막힌 브라우저에서도 이미 저장된 세트는 보이게)
    try {
      var raw = root.localStorage.getItem(STORE_KEY);
      store = normalizeStore(raw ? JSON.parse(raw) : null);
    } catch (e) {
      store = emptyStore();
    }
    try {
      var k = '__tt_probe__';
      root.localStorage.setItem(k, '1'); root.localStorage.removeItem(k);
      canSave = true;
    } catch (e2) {
      canSave = false;
    }
  }
  var WARN_BLOCKED = '이 브라우저에서는 저장되지 않습니다. 파일로 내보내 보관하세요';
  var WARN_FULL = '저장 공간이 가득 차 저장하지 못했습니다. 그림이 많으면 [세트 내보내기]/[전체 내보내기] 파일로 보관하고 그림 일부를 지우세요';
  var quotaHit = false;
  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    var text = JSON.stringify(store);
    try {
      root.localStorage.setItem(STORE_KEY, text);
      canSave = true; quotaHit = false;
      setStatus('저장됨', 'ok');
    } catch (e) {
      canSave = false; quotaHit = isQuotaError(e);
      setStatus('저장 안 됨', 'bad');
    }
    renderWarn();
    renderUsage(text);
  }
  function renderWarn() {
    $('ed-warn').textContent = quotaHit ? WARN_FULL : WARN_BLOCKED;
    show($('ed-warn'), !canSave);
  }
  /** 저장 데이터 대략 크기(브라우저는 글자당 2바이트로 셈, 보통 한도 약 5MB) */
  function renderUsage(text) {
    if (text === undefined) text = JSON.stringify(store);
    var mb = text.length * 2 / (1024 * 1024);
    var el = $('ed-usage');
    el.textContent = '저장 공간 약 ' + (mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1)) + 'MB / 약 5MB';
    el.classList.toggle('bad', mb > 4);
  }
  function scheduleSave() {
    setStatus('저장 중…', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function setStatus(text, cls) {
    var el = $('ed-status');
    el.textContent = text;
    el.className = 'ed-status' + (cls ? ' ' + cls : '');
  }
  var msgTimer = null;
  function message(text, bad) {
    var el = $('ed-msg');
    el.textContent = text;
    el.className = 'ed-msg' + (bad ? ' bad' : '');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.textContent = ''; }, bad ? 9000 : 4000);
  }
  function show(el, on) { el.classList.toggle('hidden', !on); }

  /** 화면에 보일 세트(읽기 전용 view) */
  function view(id) {
    var u = store.user.filter(function (s) { return s.id === id; })[0];
    if (u) return u;
    if (store.overrides[id]) return store.overrides[id];
    var b = builtinById(id);
    return b ? cloneSet(b) : null;
  }
  /** 고칠 수 있는 세트 객체. 기본 세트는 처음 고칠 때 덮어쓰기본을 만든다 */
  function editable() {
    var u = store.user.filter(function (s) { return s.id === selId; })[0];
    if (u) return u;
    if (!store.overrides[selId]) {
      var b = builtinById(selId);
      if (!b) return null;
      store.overrides[selId] = cloneSet(b);
      renderSets();
      renderSideButtons();
    }
    return store.overrides[selId];
  }
  function isUser(id) { return store.user.some(function (s) { return s.id === id; }); }

  // ---------- 세트 목록 ----------
  function renderSets() {
    var host = $('ed-sets');
    host.textContent = '';
    getAllSets().forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-set' + (s.id === selId ? ' on' : '');
      b.dataset.id = s.id;
      var t = document.createElement('span'); t.className = 'ed-set-title'; t.textContent = s.title;
      var info = document.createElement('span'); info.className = 'ed-set-info';
      var valid = countValid(s), total = s.questions.length;
      info.textContent = (s.builtin ? (s.modified ? '기본 · 수정됨' : '기본') : '내 세트') + ' · ' + valid + '문항' + (valid !== total ? ' (빈 문항 ' + (total - valid) + ')' : '');
      b.appendChild(t); b.appendChild(info);
      host.appendChild(b);
    });
  }
  function renderSideButtons() {
    var user = isUser(selId);
    $('ed-del').disabled = !user;
    show($('ed-revert'), !user && !!store.overrides[selId]);
  }

  // ---------- 오른쪽: 세트 정보 + 문항 표 ----------
  function renderPanel() {
    var s = view(selId);
    if (!s) return;
    $('ed-set-title').value = s.title;
    $('ed-set-desc').value = s.description || '';
    renderRows();
    renderSideButtons();
  }
  function updateCount() {
    var s = view(selId);
    var valid = countValid(s), total = s.questions.length;
    $('ed-count').textContent = '문항 ' + total + '개' + (valid !== total ? ' · 출제 가능 ' + valid + '개 (빨간 줄은 문제나 정답이 비어 출제되지 않습니다)' : '');
  }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function renderRows(focusIdx) {
    var host = $('ed-rows');
    var keep = host.parentNode.scrollTop;
    host.textContent = '';
    var s = view(selId);
    if (!s.questions.length) {
      var empty = el('div', 'ed-empty');
      empty.textContent = '문항이 없습니다. [문항 추가] 또는 [여러 문항 붙여넣기]로 넣으세요.';
      host.appendChild(empty);
    }
    s.questions.forEach(function (q, i) {
      var row = el('div', 'ed-row' + (isValidQuestion(q) ? '' : ' bad'));
      row.dataset.i = i;
      var no = el('div', 'ed-no'); no.textContent = i + 1;
      var qcell = el('div', 'ed-qcell');
      var qa = el('textarea', 'ed-in ed-q', { rows: '2', 'data-f': 'q', 'aria-label': (i + 1) + '번 문제', placeholder: '문제 (그림은 여기서 Ctrl+V 로 붙여넣기 가능)' });
      qa.value = q.q;
      qcell.appendChild(qa);
      if (q.img) {
        var line = el('div', 'ed-img-line');
        var th = el('img', 'ed-thumb', { alt: (i + 1) + '번 그림' });
        th.src = q.img; // 검증된 data:image/ 또는 상대 경로만 들어 있음
        th.addEventListener('error', function () { th.classList.add('broken'); th.alt = '그림을 불러올 수 없습니다'; });
        var del = el('button', 'ed-act ed-act-wide', { type: 'button', 'data-act': 'imgdel', title: '그림 삭제' });
        del.textContent = '그림 삭제';
        line.appendChild(th); line.appendChild(del);
        qcell.appendChild(line);
      }
      if (Array.isArray(q.choices)) qcell.appendChild(choicesBlock(q, i));
      var an = el('input', 'ed-in ed-a', { type: 'text', 'data-f': 'a', 'aria-label': (i + 1) + '번 정답', placeholder: '정답' });
      an.value = q.a;
      var lv = el('div', 'ed-lv');
      [1, 2, 3].forEach(function (n) {
        var b = el('button', 'ed-lv-btn' + (n <= q.level ? ' on' : '') + (n === q.level ? ' cur' : ''), { type: 'button', 'data-act': 'level', 'data-level': String(n), title: '난이도 ' + n });
        b.textContent = '★';
        lv.appendChild(b);
      });
      var note = el('input', 'ed-in ed-note', { type: 'text', 'data-f': 'note', 'aria-label': (i + 1) + '번 풀이 메모', placeholder: '(선택)' });
      note.value = q.note || '';
      var acts = el('div', 'ed-acts');
      var ib = el('button', 'ed-act ed-act-wide', { type: 'button', 'data-act': 'img', title: '그림 파일 넣기' });
      ib.textContent = '그림';
      acts.appendChild(ib);
      var cb = el('button', 'ed-act ed-act-wide' + (Array.isArray(q.choices) ? ' on' : ''), { type: 'button', 'data-act': 'choices', title: '보기형 문제로 바꾸기/되돌리기' });
      cb.textContent = '보기';
      acts.appendChild(cb);
      [['up', '▲', '위로'], ['down', '▼', '아래로'], ['del', '✕', '문항 삭제']].forEach(function (a) {
        var b = el('button', 'ed-act ed-act-' + a[0], { type: 'button', 'data-act': a[0], title: a[2] });
        b.textContent = a[1];
        if ((a[0] === 'up' && i === 0) || (a[0] === 'down' && i === s.questions.length - 1)) b.disabled = true;
        acts.appendChild(b);
      });
      row.appendChild(no); row.appendChild(qcell); row.appendChild(an); row.appendChild(lv); row.appendChild(note); row.appendChild(acts);
      host.appendChild(row);
    });
    host.parentNode.scrollTop = keep;
    if (focusIdx !== undefined && host.children[focusIdx]) {
      var f = host.children[focusIdx].querySelector('.ed-q');
      if (f) { f.focus(); f.scrollIntoView({ block: 'nearest' }); }
    }
    updateCount();
  }

  /** 보기 입력칸: ① 라디오(정답) + 보기 글자 + ✕, 아래 [+ 보기] */
  function choicesBlock(q, i) {
    var box = el('div', 'ed-choices');
    var key = squash(q.a);
    q.choices.forEach(function (c, ci) {
      var line = el('label', 'ed-choice');
      var r = el('input', '', { type: 'radio', name: 'ed-ch-' + i, 'data-ci': String(ci), title: '이 보기를 정답으로' });
      r.checked = key !== '' && squash(c) === key;
      var mark = el('span', 'ed-ch-no'); mark.textContent = CIRCLED[ci];
      var inp = el('input', 'ed-in ed-ch-in', { type: 'text', 'data-f': 'choice', 'data-ci': String(ci), 'aria-label': (i + 1) + '번 보기 ' + (ci + 1), placeholder: '보기 ' + (ci + 1) });
      inp.value = c;
      var x = el('button', 'ed-act', { type: 'button', 'data-act': 'chdel', 'data-ci': String(ci), title: '보기 삭제' });
      x.textContent = '✕';
      x.disabled = q.choices.length <= 2;
      line.appendChild(r); line.appendChild(mark); line.appendChild(inp); line.appendChild(x);
      box.appendChild(line);
    });
    var add = el('button', 'ed-act ed-act-wide', { type: 'button', 'data-act': 'chadd' });
    add.textContent = '+ 보기';
    add.disabled = q.choices.length >= 5;
    var help = el('span', 'ed-ch-help');
    help.textContent = '정답 보기 왼쪽 동그라미를 누르면 정답 칸이 채워집니다';
    var foot = el('div', 'ed-ch-foot'); foot.appendChild(add); foot.appendChild(help);
    box.appendChild(foot);
    return box;
  }

  function changed(structural, focusIdx) {
    if (structural) { renderRows(focusIdx); }
    else updateCount();
    renderSets();
    renderSideButtons();
    scheduleSave();
  }

  function onRowsInput(e) {
    var f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    var row = e.target.closest('.ed-row');
    var i = Number(row.dataset.i);
    var s = editable();
    if (!s || !s.questions[i]) return;
    var qq = s.questions[i];
    if (f === 'note') { if (e.target.value === '') delete qq.note; else qq.note = e.target.value; }
    else if (f === 'choice') {
      var ci = Number(e.target.dataset.ci);
      var wasAnswer = squash(qq.a) !== '' && squash(qq.choices[ci]) === squash(qq.a);
      qq.choices[ci] = e.target.value;
      if (wasAnswer) { qq.a = e.target.value; row.querySelector('[data-f="a"]').value = qq.a; }
    }
    else qq[f] = e.target.value;
    row.classList.toggle('bad', !isValidQuestion(s.questions[i]));
    changed(false);
  }
  function onRowsClick(e) {
    var radio = e.target.closest('input[type="radio"][data-ci]');
    if (radio) {
      var ri = Number(radio.closest('.ed-row').dataset.i), rs = editable();
      if (!rs || !rs.questions[ri]) return;
      var rq = rs.questions[ri];
      rq.a = String(rq.choices[Number(radio.dataset.ci)] || '');
      var rowEl = radio.closest('.ed-row');
      rowEl.querySelector('[data-f="a"]').value = rq.a;
      rowEl.classList.toggle('bad', !isValidQuestion(rq));
      changed(false);
      return;
    }
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var i = Number(b.closest('.ed-row').dataset.i);
    var s = editable();
    if (!s) return;
    var qs = s.questions, act = b.dataset.act;
    if (act === 'img') { imgTarget = i; $('ed-img-file').value = ''; $('ed-img-file').click(); return; }
    if (act === 'imgdel') { delete qs[i].img; changed(true); return; }
    if (act === 'choices') {
      if (Array.isArray(qs[i].choices)) delete qs[i].choices;
      else qs[i].choices = [str(qs[i].a), '', '', ''];
      changed(true); return;
    }
    if (act === 'chadd') { if (qs[i].choices.length < 5) qs[i].choices.push(''); changed(true); return; }
    if (act === 'chdel') {
      var ci = Number(b.dataset.ci);
      if (qs[i].choices.length > 2) {
        if (squash(qs[i].choices[ci]) === squash(qs[i].a)) qs[i].a = '';
        qs[i].choices.splice(ci, 1);
      }
      changed(true); return;
    }
    if (act === 'level') qs[i].level = Number(b.dataset.level);
    else if (act === 'up' && i > 0) { var t = qs[i - 1]; qs[i - 1] = qs[i]; qs[i] = t; }
    else if (act === 'down' && i < qs.length - 1) { var t2 = qs[i + 1]; qs[i + 1] = qs[i]; qs[i] = t2; }
    else if (act === 'del') qs.splice(i, 1);
    changed(true);
  }

  // ---------- 그림 넣기(파일 선택 / Ctrl+V) ----------
  var imgTarget = -1;
  var IMG_MAX = 1280;
  /** 그림 파일을 긴 변 1280px 이하 JPEG(품질 0.8, 투명 부분은 흰 바탕) data URL 로 */
  function shrinkImage(file, cb) {
    if (!file || !/^image\//.test(file.type || '')) { message('그림 파일이 아닙니다', true); return; }
    var url;
    try { url = URL.createObjectURL(file); } catch (e) { message('그림을 읽지 못했습니다', true); return; }
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth || 1, h = im.naturalHeight || 1;
      var k = Math.min(1, IMG_MAX / Math.max(w, h));
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      var data;
      try { data = cv.toDataURL('image/jpeg', 0.8); } catch (e) { message('그림을 변환하지 못했습니다', true); return; }
      cb(data, cv.width, cv.height);
    };
    im.onerror = function () { URL.revokeObjectURL(url); message('그림을 읽지 못했습니다(지원하지 않는 형식)', true); };
    im.src = url;
  }
  function putImage(i, file) {
    shrinkImage(file, function (data, w, h) {
      var s = editable();
      if (!s || !s.questions[i]) return;
      s.questions[i].img = data;
      changed(true);
      message((i + 1) + '번 문항에 그림을 넣었습니다(' + w + '×' + h + ', 약 ' + Math.round(data.length * 0.75 / 1024) + 'KB)');
    });
  }
  function onRowsPaste(e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('ed-q')) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var k = 0; k < items.length; k++) {
      if (items[k].kind === 'file' && /^image\//.test(items[k].type)) {
        var f = items[k].getAsFile();
        if (!f) continue;
        e.preventDefault();
        putImage(Number(t.closest('.ed-row').dataset.i), f);
        return;
      }
    }
  }

  // ---------- 세트 단위 동작 ----------
  function selectSet(id) {
    selId = id;
    renderSets();
    renderPanel();
  }
  function newSet() {
    var placed = placeSets([{ id: 'my-set', title: '새 세트', description: '', questions: [] }], getAllSets())[0];
    store.user.push(placed);
    selectSet(placed.id);
    scheduleSave();
    var t = $('ed-set-title'); t.focus(); t.select();
  }
  function duplicateSet() {
    var src = view(selId);
    if (!src) return;
    var placed = placeSets([cloneSet(src)], getAllSets())[0];
    store.user.push(placed);
    selectSet(placed.id);
    scheduleSave();
    message('"' + src.title + '" 세트를 복제했습니다');
  }
  function deleteSet() {
    if (!isUser(selId)) return;
    var s = view(selId);
    if (!root.confirm('"' + s.title + '" 세트를 지울까요? 지운 세트는 되살릴 수 없습니다(내보낸 파일이 있으면 가져오기로 복원).')) return;
    store.user = store.user.filter(function (x) { return x.id !== selId; });
    var all = getAllSets();
    selectSet(all.length ? all[0].id : null);
    saveNow();
  }
  function revertSet() {
    if (!store.overrides[selId]) return;
    if (!root.confirm('기본 세트를 처음 상태로 되돌릴까요? 이 세트에서 고친 내용이 모두 사라집니다.')) return;
    delete store.overrides[selId];
    selectSet(selId);
    saveNow();
    message('기본 세트를 원래대로 되돌렸습니다');
  }
  function addQuestion() {
    var s = editable();
    if (!s) return;
    s.questions.push({ q: '', a: '', level: 2 });
    changed(true, s.questions.length - 1);
  }

  // ---------- 붙여넣기 ----------
  function openPaste() {
    $('ed-paste-text').value = '';
    updatePastePreview();
    show($('ed-paste'), true);
    $('ed-paste-text').focus();
  }
  function closePaste() { show($('ed-paste'), false); }
  function updatePastePreview() {
    var r = parsePaste($('ed-paste-text').value);
    $('ed-paste-preview').textContent = r.items.length + '문항 인식' + (r.skipped ? ' · 건너뛴 줄 ' + r.skipped + '개(문제나 정답이 없거나 머리글 줄)' : '');
    $('ed-paste-ok').disabled = r.items.length === 0;
  }
  function applyPaste() {
    var r = parsePaste($('ed-paste-text').value);
    if (!r.items.length) return;
    var s = editable();
    if (!s) return;
    r.items.forEach(function (q) { s.questions.push(q); });
    closePaste();
    changed(true);
    var wrap = $('ed-rows').parentNode; wrap.scrollTop = wrap.scrollHeight;
    message(r.items.length + '문항을 추가했습니다' + (r.skipped ? ' (건너뛴 줄 ' + r.skipped + '개)' : ''));
  }

  // ---------- 파일 주고받기 ----------
  function download(name, obj) {
    var text = JSON.stringify(obj, null, 2);
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      message(name + ' 파일로 내보냈습니다');
    } catch (e) {
      message('내보내기에 실패했습니다', true);
    }
  }
  function exportSet() {
    var s = view(selId);
    if (!s) return;
    download(exportFileName(s.title), buildExport([s]));
  }
  function exportAll() {
    var mine = getAllSets().filter(function (s) { return !s.builtin || s.modified; });
    if (!mine.length) { message('내보낼 세트가 없습니다(내가 만든 세트나 고친 기본 세트가 없음)', true); return; }
    download(exportFileName('전체세트'), buildExport(mine));
  }
  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) { message('가져오기 실패: 파일이 너무 큽니다(30MB 이하만 가져올 수 있습니다)', true); return; }
    var fr = new FileReader();
    fr.onload = function () { importText(String(fr.result || ''), file.name); };
    fr.onerror = function () { message('가져오기 실패: 파일을 읽지 못했습니다', true); };
    fr.readAsText(file, 'utf-8');
  }
  function importText(text, name) {
    var r = parseImport(text);
    if (!r.ok) { message('가져오기 실패(' + name + '): ' + r.error, true); return; }
    var placed = placeSets(r.sets, getAllSets());
    placed.forEach(function (s) { store.user.push(s); });
    selectSet(placed[0].id);
    saveNow();
    message(placed.length + '개 세트를 가져왔습니다: ' + placed.map(function (s) { return s.title; }).join(', '));
  }

  // ---------- 열기/닫기 ----------
  function open() {
    // 메모리의 store 가 기준(저장이 막힌 브라우저에서도 이번 창을 닫기 전까지는 편집 내용이 유지됨)
    var all = getAllSets();
    if (!selId || !all.some(function (s) { return s.id === selId; })) selId = all.length ? all[0].id : null;
    renderWarn();
    renderUsage();
    setStatus(canSave ? '저장됨' : '저장 안 됨', canSave ? 'ok' : 'bad');
    $('ed-msg').textContent = '';
    closePaste();
    renderSets();
    renderPanel();
    show($('editor'), true);
  }
  function close() {
    if (saveTimer) saveNow();
    closePaste();
    show($('editor'), false);
    try { document.dispatchEvent(new CustomEvent('ttsets-changed')); } catch (e) { /* 무시 */ }
  }
  function isOpen() { var e = $('editor'); return !!e && !e.classList.contains('hidden'); }

  function init() {
    if (!$('editor')) return;
    loadStore();
    $('btn-editor').addEventListener('click', open);
    $('ed-close').addEventListener('click', close);
    $('ed-sets').addEventListener('click', function (e) {
      var b = e.target.closest('.ed-set'); if (b) selectSet(b.dataset.id);
    });
    $('ed-new').addEventListener('click', newSet);
    $('ed-dup').addEventListener('click', duplicateSet);
    $('ed-del').addEventListener('click', deleteSet);
    $('ed-revert').addEventListener('click', revertSet);
    $('ed-set-title').addEventListener('input', function (e) {
      var s = editable(); if (!s) return;
      s.title = e.target.value; changed(false);
    });
    $('ed-set-title').addEventListener('blur', function (e) {
      var s = editable(); if (!s) return;
      if (!s.title.trim()) { s.title = '이름 없는 세트'; e.target.value = s.title; changed(false); }
    });
    $('ed-set-desc').addEventListener('input', function (e) {
      var s = editable(); if (!s) return;
      s.description = e.target.value; changed(false);
    });
    $('ed-rows').addEventListener('input', onRowsInput);
    $('ed-rows').addEventListener('click', onRowsClick);
    $('ed-rows').addEventListener('paste', onRowsPaste);
    $('ed-img-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f && imgTarget >= 0) putImage(imgTarget, f);
    });
    $('ed-add').addEventListener('click', addQuestion);
    $('ed-paste-open').addEventListener('click', openPaste);
    $('ed-paste-text').addEventListener('input', updatePastePreview);
    $('ed-paste-ok').addEventListener('click', applyPaste);
    $('ed-paste-cancel').addEventListener('click', closePaste);
    $('ed-export').addEventListener('click', exportSet);
    $('ed-export-all').addEventListener('click', exportAll);
    $('ed-import').addEventListener('click', function () { $('ed-file').value = ''; $('ed-file').click(); });
    $('ed-file').addEventListener('change', function (e) { importFile(e.target.files && e.target.files[0]); });
    // 편집기 안의 키 입력이 게임 단축키로 새지 않게 막는다(Esc 는 붙여넣기 창 닫기)
    $('editor').addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('ed-paste').classList.contains('hidden')) { e.preventDefault(); closePaste(); }
      e.stopPropagation();
    });
  }

  root.TTEditor = { getAllSets: getAllSets, getPlayableSets: getPlayableSets, open: open, close: close, isOpen: isOpen, importText: importText };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
