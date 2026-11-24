/* 땅따먹기 퀴즈 배틀 — 게임 로직(순수 함수) + 화면 제어
   순수 로직은 Logic 객체에 모여 있고 DOM을 쓰지 않는다(node 테스트 가능). */
(function (root) {
  'use strict';

  // ---------- 상수 ----------
  var SIZES = {
    s: { cols: 5, rows: 4, label: '소 (5×4)' },
    m: { cols: 6, rows: 5, label: '중 (6×5)' },
    l: { cols: 8, rows: 5, label: '대 (8×5)' }
  };
  var SPECIAL_TYPES = ['again', 'bonus', 'quake', 'fort'];
  var SPECIAL_RATIO = 0.2;
  var HISTORY_LIMIT = 60;

  // ---------- 순수 로직 ----------

  /** 상하좌우 이웃 칸 번호 */
  function neighbors(idx, cols, rows) {
    var r = Math.floor(idx / cols), c = idx % cols, out = [];
    if (r > 0) out.push(idx - cols);
    if (r < rows - 1) out.push(idx + cols);
    if (c > 0) out.push(idx - 1);
    if (c < cols - 1) out.push(idx + 1);
    return out;
  }

  /** 두 칸이 상하좌우로 맞닿아 있는가 */
  function isAdjacent(a, b, cols) {
    var ra = Math.floor(a / cols), ca = a % cols;
    var rb = Math.floor(b / cols), cb = b % cols;
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
  }

  /** team이 idx 칸을 고를 수 있는가. kind: empty(빈 땅) | attack(공격) */
  function canSelect(cells, cols, rows, idx, team) {
    var cell = cells[idx];
    if (!cell) return { ok: false, kind: null, reason: '없는 칸입니다' };
    if (cell.owner === -1) return { ok: true, kind: 'empty' };
    if (cell.owner === team) return { ok: false, kind: 'own', reason: '이미 우리 조의 땅입니다' };
    if (cell.fort) return { ok: false, kind: 'fort', reason: '요새는 공격할 수 없습니다' };
    var touching = neighbors(idx, cols, rows).some(function (n) { return cells[n].owner === team; });
    if (!touching) return { ok: false, kind: 'far', reason: '우리 땅과 상하좌우로 맞닿은 땅만 공격할 수 있습니다' };
    return { ok: true, kind: 'attack' };
  }

  /** team이 지금 공격할 수 있는 칸 번호 목록 */
  function attackableCells(cells, cols, rows, team) {
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].owner >= 0 && canSelect(cells, cols, rows, i, team).kind === 'attack') out.push(i);
    }
    return out;
  }

  /** team 땅 중 상하좌우로 연결된 가장 큰 덩어리의 칸 수 */
  function largestRegion(cells, cols, rows, team) {
    var seen = new Array(cells.length).fill(false), best = 0;
    for (var i = 0; i < cells.length; i++) {
      if (seen[i] || cells[i].owner !== team) continue;
      var stack = [i], size = 0;
      seen[i] = true;
      while (stack.length) {
        var cur = stack.pop();
        size++;
        neighbors(cur, cols, rows).forEach(function (n) {
          if (!seen[n] && cells[n].owner === team) { seen[n] = true; stack.push(n); }
        });
      }
      if (size > best) best = size;
    }
    return best;
  }

  function emptyCount(cells) {
    return cells.filter(function (c) { return c.owner === -1; }).length;
  }

  /** 점수 = 점령 칸 수 + 최대 연결 영역 칸 수 */
  function computeScores(cells, cols, rows, nTeams) {
    var out = [];
    for (var t = 0; t < nTeams; t++) {
      var n = cells.filter(function (c) { return c.owner === t; }).length;
      var big = largestRegion(cells, cols, rows, t);
      out.push({ team: t, cells: n, largest: big, total: n + big });
    }
    return out;
  }

  /** 합계 내림차순 정렬 + 순위(동점은 같은 순위) */
  function rankScores(scores) {
    var sorted = scores.slice().sort(function (a, b) {
      return b.total - a.total || b.cells - a.cells || a.team - b.team;
    });
    var rank = 0, prev = null;
    sorted.forEach(function (s, i) {
      if (prev === null || s.total !== prev) rank = i + 1;
      prev = s.total;
      s.rank = rank;
    });
    return sorted;
  }

  function normLevel(lv) {
    lv = Math.round(Number(lv));
    if (!(lv >= 1)) return 1;
    return lv > 3 ? 3 : lv;
  }

  /** 선택한 세트의 문제를 하나의 목록으로. key = 세트id#번호 */
  function buildQuestionPool(sets, setIds) {
    var pool = [];
    (sets || []).forEach(function (set) {
      if (!set || setIds.indexOf(set.id) === -1) return;
      (set.questions || []).forEach(function (q, i) {
        if (!q || !q.q || q.a === undefined || q.a === null || q.a === '') return;
        pool.push({
          key: set.id + '#' + i, q: String(q.q), a: String(q.a),
          level: normLevel(q.level), note: q.note ? String(q.note) : '', setTitle: set.title || set.id
        });
      });
    });
    return pool;
  }

  // 후보 중 kind에 맞는 level 묶음에서 하나 고르기
  function pickFrom(cands, kind, rng) {
    if (!cands.length) return null;
    var group;
    if (kind === 'attack') {
      // level 3 우선, 없으면 남은 것 중 가장 높은 level
      var max = Math.max.apply(null, cands.map(function (q) { return q.level; }));
      group = cands.filter(function (q) { return q.level === max; });
    } else {
      group = cands.filter(function (q) { return q.level <= 2; });
      if (!group.length) group = cands;
    }
    return group[Math.floor(rng() * group.length) % group.length];
  }

  /**
   * 문제 뽑기. used: 이미 낸 문제 key 배열. excludeKey: 직전 문제(문제 바꾸기 시).
   * 반환 { question, reset } — reset이 true면 전부 소진되어 used를 비우고 다시 쓴 것.
   */
  function pickQuestion(pool, used, kind, rng, excludeKey) {
    rng = rng || Math.random;
    if (!pool || !pool.length) return null;
    var usedSet = {};
    (used || []).forEach(function (k) { usedSet[k] = true; });
    var fresh = pool.filter(function (q) { return !usedSet[q.key] && q.key !== excludeKey; });
    var q = pickFrom(fresh, kind, rng);
    if (q) return { question: q, reset: false };
    var again = pool.filter(function (q2) { return q2.key !== excludeKey; });
    q = pickFrom(again.length ? again : pool, kind, rng);
    return { question: q, reset: true };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** n칸 중 약 20%에 특수 칸 배치. 길이 n 배열(null 또는 종류) */
  function placeSpecials(n, rng, ratio) {
    rng = rng || Math.random;
    ratio = ratio === undefined ? SPECIAL_RATIO : ratio;
    var count = Math.max(1, Math.round(n * ratio));
    var idxs = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rng).slice(0, count);
    var order = shuffle(SPECIAL_TYPES.slice(), rng);
    var out = new Array(n).fill(null);
    idxs.forEach(function (idx, i) { out[idx] = order[i % order.length]; });
    return out;
  }

  /** 새 게임 상태 */
  function createGame(opts, rng) {
    rng = rng || Math.random;
    var size = SIZES[opts.sizeKey] || SIZES.m;
    var n = size.cols * size.rows;
    var specials = placeSpecials(n, rng);
    var cells = specials.map(function (sp) { return { owner: -1, special: sp, used: false, fort: false }; });
    return {
      v: 1,
      teams: opts.teamNames.map(function (name) { return { name: name }; }),
      setIds: opts.setIds.slice(),
      sizeKey: opts.sizeKey in SIZES ? opts.sizeKey : 'm',
      cols: size.cols, rows: size.rows,
      timeLimit: opts.timeLimit || 0,
      cells: cells, turn: 0, used: [], history: [], ended: false
    };
  }

  function snapshot(g) {
    return JSON.stringify({ cells: g.cells, turn: g.turn, used: g.used, ended: g.ended });
  }

  /** 정답 처리: 칸 점령 + 특수 칸 발동. 발동 내용을 반환 */
  function applyCorrect(g, idx, rng) {
    rng = rng || Math.random;
    var team = g.turn, cell = g.cells[idx];
    var ev = { idx: idx, team: team, correct: true, special: null, effectIdx: -1, extraTurn: false, prevOwner: cell.owner };
    cell.owner = team;
    if (cell.special && !cell.used) {
      cell.used = true;
      ev.special = cell.special;
      var nb = neighbors(idx, g.cols, g.rows), cand;
      if (cell.special === 'again') {
        ev.extraTurn = true;
      } else if (cell.special === 'bonus') {
        cand = nb.filter(function (n) { return g.cells[n].owner === -1; });
        if (cand.length) {
          ev.effectIdx = cand[Math.floor(rng() * cand.length) % cand.length];
          g.cells[ev.effectIdx].owner = team;
        }
      } else if (cell.special === 'quake') {
        cand = nb.filter(function (n) { var c = g.cells[n]; return c.owner >= 0 && c.owner !== team && !c.fort; });
        if (cand.length) {
          ev.effectIdx = cand[Math.floor(rng() * cand.length) % cand.length];
          ev.effectPrevOwner = g.cells[ev.effectIdx].owner;
          g.cells[ev.effectIdx].owner = -1;
        }
      } else if (cell.special === 'fort') {
        cell.fort = true;
      }
    }
    return ev;
  }

  /** 판정 1회: 히스토리 저장 → (정답이면) 점령 → 턴 이동. 반환 ev */
  function judge(g, idx, correct, rng) {
    g.history.push(snapshot(g));
    if (g.history.length > HISTORY_LIMIT) g.history.shift();
    var ev = correct ? applyCorrect(g, idx, rng) : { idx: idx, team: g.turn, correct: false, special: null, effectIdx: -1, extraTurn: false };
    if (!ev.extraTurn) g.turn = (g.turn + 1) % g.teams.length;
    if (emptyCount(g.cells) === 0) g.ended = true;
    return ev;
  }

  /** 직전 판정 취소. 되돌릴 게 없으면 false */
  function undo(g) {
    if (!g.history.length) return false;
    var s = JSON.parse(g.history.pop());
    g.cells = s.cells; g.turn = s.turn; g.used = s.used; g.ended = s.ended;
    return true;
  }

  /** 저장본이 쓸 만한 형태인지 */
  function isValidSave(g) {
    return !!(g && g.v === 1 && Array.isArray(g.teams) && g.teams.length >= 2 && Array.isArray(g.cells) &&
      g.cells.length === g.cols * g.rows && Array.isArray(g.setIds) && Array.isArray(g.history));
  }

  var Logic = {
    SIZES: SIZES, SPECIAL_TYPES: SPECIAL_TYPES,
    neighbors: neighbors, isAdjacent: isAdjacent, canSelect: canSelect, attackableCells: attackableCells,
    largestRegion: largestRegion, emptyCount: emptyCount, computeScores: computeScores, rankScores: rankScores,
    buildQuestionPool: buildQuestionPool, pickQuestion: pickQuestion, placeSpecials: placeSpecials,
    createGame: createGame, applyCorrect: applyCorrect, judge: judge, undo: undo, isValidSave: isValidSave
  };
  root.TTLogic = Logic;
  if (typeof module === 'object' && module && module.exports) module.exports = Logic;
  if (typeof document === 'undefined') return;

  // =====================================================================
  // 화면 제어 (브라우저 전용) — 복셀/픽셀 스타일. 캐릭터·텍스처는 voxel.js(window.Voxel)
  // =====================================================================
  var V = root.Voxel;
  var TEAM_COLORS = [
    { bg: '#0072B2', fg: '#ffffff', name: '파랑' },
    { bg: '#E69F00', fg: '#111111', name: '주황' },
    { bg: '#009E73', fg: '#ffffff', name: '초록' },
    { bg: '#CC79A7', fg: '#111111', name: '분홍' },
    { bg: '#D55E00', fg: '#ffffff', name: '다홍' },
    { bg: '#F0E442', fg: '#111111', name: '노랑' }
  ];
  var SPECIAL_INFO = {
    again: { title: '한 번 더!', desc: '같은 조가 한 턴 더 합니다' },
    bonus: { title: '보너스 땅!', desc: '맞닿은 빈 땅 하나를 덤으로 얻습니다' },
    quake: { title: '지진!', desc: '맞닿은 다른 조의 땅 하나가 빈 땅이 됩니다' },
    fort: { title: '요새!', desc: '이 땅은 앞으로 공격받지 않습니다' }
  };
  var SPECIAL_ICON = { again: 'again', bonus: 'bonus', quake: 'quake', fort: 'castle' };
  var STORAGE_KEY = 'ttang-battle-save-v1';
  var PREF_KEY = 'ttang-battle-prefs-v1';

  var $ = function (id) { return document.getElementById(id); };
  var g = null, pool = [];
  var modal = null;          // { idx, kind, question, revealed, timerId, endAt, expired, lastTick }
  var busy = false;          // 특수 칸 연출 중
  var prefs = { sound: true };
  var setup = { teamCount: 4, names: [], setIds: [], sizeKey: 'm', timeLimit: 0 };
  var setupChars = [];       // 설정 화면 캐릭터(조별 1명, 재사용)
  var heroChars = [];        // 게임 화면 보드 옆 캐릭터(조별 1명, 현재 조만 보임)
  var heroTeam = -1, heroTimer = null;
  var podiumChars = [];
  var scoreRows = [];

  // ---------- 저장 ----------
  function storageGet(key) {
    try { var s = root.localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function storageSet(key, val) {
    try { root.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* file:// 등에서 실패하면 무시 */ }
  }
  function saveGame() { if (g) storageSet(STORAGE_KEY, g); }
  function loadSave() { var s = storageGet(STORAGE_KEY); return Logic.isValidSave(s) ? s : null; }

  // ---------- 효과음 (오실레이터 단순 음) ----------
  var actx = null;
  function audio() {
    if (!prefs.sound) return null;
    try {
      if (!actx) { var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null; actx = new AC(); }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(freq, at, dur, type, vol) {
    var ctx = audio(); if (!ctx) return;
    var t0 = ctx.currentTime + at;
    var o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn); gn.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  var SFX = {
    correct: function () { tone(523, 0, 0.15, 'triangle'); tone(659, 0.1, 0.15, 'triangle'); tone(784, 0.2, 0.3, 'triangle'); },
    wrong: function () { tone(220, 0, 0.25, 'square', 0.1); tone(165, 0.22, 0.4, 'square', 0.1); },
    special: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * 0.08, 0.25, 'sine', 0.16); }); },
    fanfare: function () {
      [[523, 0, 0.18], [523, 0.2, 0.18], [523, 0.4, 0.18], [659, 0.6, 0.5], [587, 1.1, 0.2], [659, 1.3, 0.2], [784, 1.5, 0.9]]
        .forEach(function (n) { tone(n[0], n[1], n[2], 'triangle', 0.2); });
    },
    tick: function () { tone(880, 0, 0.08, 'sine', 0.12); },
    timeup: function () { tone(330, 0, 0.6, 'sawtooth', 0.08); },
    click: function () { tone(660, 0, 0.06, 'sine', 0.08); }
  };
  function sfx(name) { try { SFX[name](); } catch (e) { /* 무시 */ } }

  // ---------- 공통 UI ----------
  function show(el, on) { el.classList.toggle('hidden', !on); }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function teamChip(t) {
    var c = TEAM_COLORS[t];
    return '<span class="chip" style="background:' + c.bg + ';color:' + c.fg + '">' + (t + 1) + '</span>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function teamName(t) { return g.teams[t].name; }
  function icon(name) { return V.tex.icon(name); }
  function headIcon(t, px, face) { return V.headIcon(t, TEAM_COLORS[t].bg, px, face); }
  function vh(n) { return root.innerHeight * n / 100; }

  /** 외곽선 변수, 돌 버튼, 구름, 잔디 바닥 등 텍스처를 CSS에 넣는다 */
  function initLook() {
    var rs = document.documentElement.style;
    rs.setProperty('--ol2', V.outline(2));
    rs.setProperty('--ol3', V.outline(3));
    rs.setProperty('--ol4', V.outline(4));
    rs.setProperty('--ol6', V.outline(6));
    rs.setProperty('--stone', V.tex.stoneButton());
    document.querySelector('.ground').style.backgroundImage = V.tex.grassSide(0);
    makeClouds($('sky'));
    makeClouds(document.querySelector('.res-sky'));
  }
  function makeClouds(host) {
    if (!host) return;
    var spots = [[8, 70, 0], [22, 95, 1], [38, 80, 0], [14, 120, 1], [55, 105, 0]];
    spots.forEach(function (s, i) {
      var c = document.createElement('div');
      c.className = 'cloud';
      c.style.top = s[0] + 'vh';
      c.style.backgroundImage = V.tex.cloud(s[2]);
      c.style.animationDuration = s[1] + 's';
      c.style.animationDelay = (-s[1] * (i * 0.23 + 0.1)) + 's';
      c.style.opacity = i % 2 ? 0.8 : 0.95;
      if (i % 2) { c.style.width = '13vw'; c.style.height = '4.3vw'; }
      host.appendChild(c);
    });
  }

  // ---------- 설정 화면 ----------
  /** 출제에 쓰는 세트: 기본 세트(편집기 덮어쓰기 적용) + 내 세트, 빈 문항 제외(editor.js) */
  function allSets() {
    if (root.TTEditor) return root.TTEditor.getPlayableSets();
    return Array.isArray(root.QUIZ_SETS) ? root.QUIZ_SETS : [];
  }
  function playableIds(ids) {
    var sets = allSets();
    return ids.filter(function (id) { return sets.some(function (s) { return s.id === id && s.questions.length > 0; }); });
  }
  function editorOpen() { return !!(root.TTEditor && root.TTEditor.isOpen()); }

  function setupChar(t) {
    if (!setupChars[t]) setupChars[t] = V.create({ team: t, outfit: TEAM_COLORS[t].bg, size: 150 });
    return setupChars[t];
  }

  function renderSetupChars() {
    var host = $('setup-chars');
    var size = Math.min(vh(21), 230);
    host.innerHTML = '';
    for (var t = 0; t < setup.teamCount; t++) {
      if (setup.names[t] === undefined) setup.names[t] = (t + 1) + '조';
      var col = document.createElement('div');
      col.className = 'setup-char';
      var c = setupChar(t);
      c.setSize(size);
      col.appendChild(c.el);
      var row = document.createElement('label');
      row.className = 'name-row';
      row.innerHTML = teamChip(t) + '<input type="text" maxlength="8" data-t="' + t + '" value="' + esc(setup.names[t]) + '" aria-label="' + (t + 1) + '조 이름">';
      col.appendChild(row);
      host.appendChild(col);
    }
  }

  function renderSetup() {
    var tc = $('team-count');
    tc.innerHTML = '';
    for (var n = 2; n <= 6; n++) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = n + '조';
      b.className = 'seg' + (setup.teamCount === n ? ' on' : '');
      b.dataset.n = n;
      tc.appendChild(b);
    }
    if ($('setup-chars').children.length !== setup.teamCount) renderSetupChars();
    var list = $('set-list');
    list.innerHTML = '';
    var sets = allSets();
    if (!sets.length) list.innerHTML = '<p class="warn">문제 세트를 찾지 못했습니다. sets 폴더를 확인하세요.</p>';
    setup.setIds = playableIds(setup.setIds);
    sets.forEach(function (s) {
      // 세트 이름·설명은 사용자가 만들거나 가져온 글자일 수 있어 textContent 로만 넣는다
      var n = (s.questions || []).length;
      var on = setup.setIds.indexOf(s.id) !== -1;
      var lab = document.createElement('label');
      lab.className = 'set-card' + (on ? ' on' : '') + (n === 0 ? ' off' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.id = s.id; cb.checked = on; cb.disabled = n === 0;
      var ti = document.createElement('span'); ti.className = 'set-title'; ti.textContent = s.title || s.id;
      var de = document.createElement('span'); de.className = 'set-desc'; de.textContent = s.description || '';
      var co = document.createElement('span'); co.className = 'set-count'; co.textContent = n + '문항';
      lab.appendChild(cb); lab.appendChild(ti); lab.appendChild(de); lab.appendChild(co);
      if (n === 0) lab.title = '출제할 수 있는 문항이 없습니다(문제 편집에서 문항을 넣으세요)';
      list.appendChild(lab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#size-opts .seg'), function (b) {
      b.classList.toggle('on', b.dataset.size === setup.sizeKey);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#time-opts .seg'), function (b) {
      b.classList.toggle('on', Number(b.dataset.time) === setup.timeLimit);
    });
    var total = Logic.buildQuestionPool(sets, setup.setIds).length;
    $('setup-summary').textContent = setup.setIds.length ? '선택한 문제: ' + total + '문항' : '문제 세트를 하나 이상 고르세요';
    $('btn-start').disabled = total === 0;
    show($('btn-resume'), !!loadSave());
  }

  function bindSetup() {
    $('team-count').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setup.teamCount = Number(b.dataset.n);
      renderSetupChars(); renderSetup();
      for (var t = 0; t < setup.teamCount; t++) setupChars[t].play('idle').setFace('normal');
      var last = setupChars[setup.teamCount - 1];
      last.setFace('happy').play('cheer');
      setTimeout(function () { last.setFace('normal').play('idle'); }, 900);
    });
    $('setup-chars').addEventListener('input', function (e) {
      if (e.target.dataset.t !== undefined) setup.names[Number(e.target.dataset.t)] = e.target.value;
    });
    $('set-list').addEventListener('change', function (e) {
      var id = e.target.dataset.id; if (!id) return;
      var i = setup.setIds.indexOf(id);
      if (e.target.checked && i === -1) setup.setIds.push(id);
      if (!e.target.checked && i !== -1) setup.setIds.splice(i, 1);
      renderSetup();
    });
    $('size-opts').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setup.sizeKey = b.dataset.size; renderSetup();
    });
    $('time-opts').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setup.timeLimit = Number(b.dataset.time); renderSetup();
    });
    $('btn-start').addEventListener('click', startNewGame);
    $('btn-resume').addEventListener('click', resumeGame);
  }

  function startNewGame() {
    var names = [];
    for (var t = 0; t < setup.teamCount; t++) {
      var nm = (setup.names[t] || '').trim();
      names.push(nm || (t + 1) + '조');
    }
    pool = Logic.buildQuestionPool(allSets(), setup.setIds);
    if (!pool.length) { toast('문제 세트를 고르세요'); return; }
    g = Logic.createGame({ teamNames: names, setIds: setup.setIds, sizeKey: setup.sizeKey, timeLimit: setup.timeLimit });
    saveGame();
    enterGame();
  }

  function resumeGame() {
    var s = loadSave();
    if (!s) { toast('저장된 판이 없습니다'); renderSetup(); return; }
    g = s;
    pool = Logic.buildQuestionPool(allSets(), g.setIds);
    // 저장된 판의 세트가 편집으로 사라졌거나 비었으면 조용히 남은 세트 전체에서 출제
    if (!pool.length) pool = Logic.buildQuestionPool(allSets(), allSets().map(function (x) { return x.id; }));
    if (!pool.length) { toast('출제할 문제가 없습니다. 문제 편집에서 문항을 넣으세요'); return; }
    enterGame();
    if (g.ended) showResults(false);
  }

  function enterGame() {
    show($('setup'), false);
    show($('game'), true);
    buildHeroes();
    buildScoreRows();
    renderGame();
    showHero(g.turn, 'idle', 'normal');
    requestAnimationFrame(function () { layoutBoard(); layoutHero(); });
  }

  function backToSetup() {
    closeModal();
    clearPodium();
    show($('results'), false);
    show($('game'), false);
    show($('setup'), true);
    if (g) {
      setup.teamCount = g.teams.length;
      setup.names = g.teams.map(function (t) { return t.name; });
      setup.setIds = g.setIds.filter(function (id) { return allSets().some(function (s) { return s.id === id; }); });
      setup.sizeKey = g.sizeKey; setup.timeLimit = g.timeLimit;
    }
    renderSetupChars();
    renderSetup();
  }

  // ---------- 보드 옆 캐릭터 ----------
  function buildHeroes() {
    var stage = $('hero-stage');
    stage.innerHTML = '';
    heroChars = [];
    for (var t = 0; t < g.teams.length; t++) {
      var c = V.create({ team: t, outfit: TEAM_COLORS[t].bg, size: 300 });
      c.el.classList.add('hidden');
      stage.appendChild(c.el);
      heroChars.push(c);
    }
    heroTeam = -1;
  }
  function layoutHero() {
    var stage = $('hero-stage');
    if (!stage.clientHeight) return;
    var size = Math.min(stage.clientHeight * 1.05, stage.clientWidth * 1.6);
    heroChars.forEach(function (c) { c.setSize(size); });
  }
  /** 보드 옆에 t조 캐릭터를 세운다. mode/face 로 반응, holdMs 뒤 현재 차례 조로 돌아감 */
  function showHero(t, mode, face, holdMs) {
    clearTimeout(heroTimer);
    if (!heroChars.length) return;
    heroChars.forEach(function (c, i) { c.el.classList.toggle('hidden', i !== t); });
    var c = heroChars[t];
    if (heroTeam !== t || mode) c.play(mode || 'idle');
    c.setFace(face || 'normal');
    heroTeam = t;
    var nm = $('hero-name');
    nm.innerHTML = teamChip(t) + '<span>' + esc(teamName(t)) + '</span>';
    nm.style.borderColor = '';
    if (holdMs) heroTimer = setTimeout(function () { showHero(g.ended ? t : g.turn, 'idle', 'normal'); }, holdMs);
  }

  // ---------- 게임 화면 ----------
  /** 빈 땅 지형: 잔디(대부분)/모래/돌/눈. 칸 번호로 고정 */
  function terrainOf(i) {
    var h = ((i + 1) * 2654435761) >>> 0;
    var r = h % 10;
    var v = (h >>> 8) % 3;
    if (r < 6) return { top: V.tex.grassTop(v), side: V.tex.grassSide(v) };
    if (r < 8) return { top: V.tex.sandTop(v), side: V.tex.sandSide(v) };
    if (r < 9) return { top: V.tex.snowTop(v), side: V.tex.snowSide(v) };
    return { top: V.tex.stoneTop(v), side: V.tex.stoneSide(v) };
  }

  function renderBoard(fx) {
    fx = fx || {};
    var board = $('board');
    var atk = {};
    if (!g.ended) Logic.attackableCells(g.cells, g.cols, g.rows, g.turn).forEach(function (i) { atk[i] = true; });
    var html = '';
    for (var i = 0; i < g.cells.length; i++) {
      var c = g.cells[i], r = Math.floor(i / g.cols);
      var cls = ['cell'], topImg, sideImg;
      if (c.owner === -1) {
        cls.push('neutral');
        var tr = terrainOf(i); topImg = tr.top; sideImg = tr.side;
      } else {
        cls.push('owned');
        topImg = V.tex.wool(TEAM_COLORS[c.owner].bg); sideImg = V.tex.wool(TEAM_COLORS[c.owner].bg, true);
      }
      if (atk[i]) cls.push('attackable');
      if (c.fort) cls.push('fort');
      if (fx.pop && fx.pop.indexOf(i) !== -1) cls.push('pop');
      if (fx.drop && fx.drop.indexOf(i) !== -1) cls.push('drop');
      var inner = '<span class="cell-no">' + (i + 1) + '</span>';
      if (c.owner >= 0) inner += '<span class="cell-team">' + (c.owner + 1) + '조</span>';
      if (c.fort) inner += '<span class="wall" style="background-image:' + V.tex.battlement() + '"></span><span class="badge" title="요새" style="background-image:' + icon('castle') + '"></span>';
      else if (c.used && c.special) inner += '<span class="badge used" title="발동한 특수 칸" style="background-image:' + icon(SPECIAL_ICON[c.special]) + '"></span>';
      if (atk[i]) inner += '<span class="atk"></span><span class="atk-icon" style="background-image:' + icon('sword') + '"></span>';
      html += '<button type="button" class="' + cls.join(' ') + '" style="z-index:' + (r + 1) + '" data-idx="' + i + '" aria-label="' + (i + 1) + '번 칸">' +
        '<span class="blk"><span class="top" style="background-image:' + topImg + '">' + inner + '</span>' +
        '<span class="side" style="background-image:' + sideImg + '"></span></span></button>';
    }
    board.innerHTML = html;
    board.style.gridTemplateColumns = 'repeat(' + g.cols + ', var(--cell))';
    layoutBoard();
  }

  function layoutBoard() {
    if (!g) return;
    var wrap = $('board-wrap'), board = $('board');
    var w = wrap.clientWidth - 8, h = wrap.clientHeight - 24;
    if (w <= 0 || h <= 0) return;
    var gap = 4;
    // 맨 윗줄 점령 칸이 솟아오르는 높이(0.1칸)만큼 위 여유
    var size = Math.floor(Math.min((w - gap * (g.cols - 1)) / g.cols, (h - gap * (g.rows - 1)) / (g.rows + 0.1)));
    size = Math.max(size, 30);
    board.style.setProperty('--cell', size + 'px');
    board.style.marginTop = Math.round(size * 0.1) + 'px';
  }

  function buildScoreRows() {
    var sb = $('scoreboard');
    sb.innerHTML = '';
    scoreRows = [];
    var px = Math.round(Math.min(vh(6.2), 64));
    for (var t = 0; t < g.teams.length; t++) {
      var row = document.createElement('div');
      row.className = 'score-row';
      row.appendChild(headIcon(t, px));
      var name = document.createElement('div');
      name.className = 'score-name';
      var total = document.createElement('div');
      total.className = 'score-total';
      var gauge = document.createElement('div');
      gauge.className = 'gauge';
      var detail = document.createElement('div');
      detail.className = 'score-detail';
      row.appendChild(name); row.appendChild(total); row.appendChild(gauge); row.appendChild(detail);
      sb.appendChild(row);
      scoreRows.push({ row: row, name: name, total: total, gauge: gauge, detail: detail });
    }
  }

  function renderScores() {
    var sc = Logic.computeScores(g.cells, g.cols, g.rows, g.teams.length);
    sc.forEach(function (s) {
      var r = scoreRows[s.team]; if (!r) return;
      var cur = !g.ended && s.team === g.turn;
      r.row.classList.toggle('current', cur);
      r.name.innerHTML = esc(teamName(s.team)) + (cur ? '<span class="turn-tag">◀</span>' : '');
      r.total.innerHTML = s.total + '<small>점</small>';
      var bg = TEAM_COLORS[s.team].bg, html = '';
      for (var i = 0; i < s.cells; i++) html += '<i class="' + (i < s.largest ? 'big' : '') + '" style="background:' + bg + '"></i>';
      r.gauge.innerHTML = html;
      r.detail.textContent = '땅 ' + s.cells + ' · 연결 ' + s.largest;
    });
  }

  function renderTopbar() {
    var b = $('turn-banner');
    b.innerHTML = '';
    b.classList.toggle('ended', g.ended);
    if (g.ended) b.textContent = '게임 종료';
    else {
      b.appendChild(headIcon(g.turn, Math.round(Math.min(vh(6), 56))));
      var s = document.createElement('span');
      s.textContent = teamName(g.turn) + ' 차례';
      b.appendChild(s);
    }
    $('empty-left').textContent = '남은 빈 땅 ' + Logic.emptyCount(g.cells) + '칸';
    $('btn-undo').disabled = !g.history.length;
    $('btn-sound').textContent = prefs.sound ? '소리 켬' : '소리 끔';
  }

  function renderGame(fx) {
    renderTopbar();
    renderBoard(fx);
    renderScores();
  }

  function onBoardClick(e) {
    var b = e.target.closest('.cell'); if (!b || !g) return;
    if (modal || busy) return;
    if (g.ended) { toast('게임이 끝났습니다. 되돌리기(Z)로 이전 상태로 갈 수 있습니다'); return; }
    var idx = Number(b.dataset.idx);
    var res = Logic.canSelect(g.cells, g.cols, g.rows, idx, g.turn);
    if (!res.ok) { toast(res.reason); return; }
    openQuestion(idx, res.kind, null);
  }

  // ---------- 문제 창 ----------
  function openQuestion(idx, kind, excludeKey) {
    var r = Logic.pickQuestion(pool, g.used, kind, Math.random, excludeKey);
    if (!r || !r.question) { toast('문제가 없습니다'); return; }
    if (r.reset) g.used = [];
    g.used.push(r.question.key);
    stopTimer();
    modal = { idx: idx, kind: kind, question: r.question, revealed: false, expired: false, timerId: null, endAt: 0, lastTick: -1 };
    showHero(g.turn, kind === 'attack' ? 'point' : 'idle', 'normal');
    renderModal();
    show($('qmodal'), true);
    sfx('click');
    if (g.timeLimit > 0) startTimer(g.timeLimit);
  }

  function fitQuestionClass(text) {
    var len = text.length;
    if (len > 90) return 'len-xl';
    if (len > 58) return 'len-l';
    if (len > 30) return 'len-m';
    return 'len-s';
  }

  function renderModal() {
    var m = modal, q = m.question, t = g.turn;
    var target = g.cells[m.idx];
    var kindText = m.kind === 'attack' ? '공격 — ' + esc(teamName(target.owner)) + '의 땅' : '빈 땅 차지하기';
    var head = $('q-head');
    head.innerHTML = '';
    head.appendChild(headIcon(t, Math.round(Math.min(vh(6.5), 64))));
    head.insertAdjacentHTML('beforeend',
      '<span class="q-team">' + esc(teamName(t)) + '</span>' +
      '<span class="q-target">' + (m.idx + 1) + '번 땅 · ' + kindText + '</span>' +
      '<span class="q-level" title="난이도 ' + q.level + '">' +
      [1, 2, 3].map(function (n) { return '<i class="' + (n <= q.level ? '' : 'off') + '" style="background-image:' + icon('star') + '"></i>'; }).join('') +
      '</span>');
    var qt = $('q-text');
    qt.textContent = q.q;
    qt.className = 'q-text ' + fitQuestionClass(q.q);
    $('a-text').textContent = q.a;
    $('a-note').textContent = q.note || '';
    show($('a-note'), !!q.note);
    show($('answer'), m.revealed);
    $('btn-reveal').disabled = m.revealed;
    buildTimerBar();
    renderTimer();
  }

  function buildTimerBar() {
    var bar = $('q-timer-bar');
    bar.innerHTML = '';
    if (g.timeLimit <= 0) return;
    var n = Math.min(g.timeLimit, 15);
    for (var i = 0; i < n; i++) bar.appendChild(document.createElement('i'));
  }
  function startTimer(sec) {
    modal.endAt = Date.now() + sec * 1000;
    modal.timerId = setInterval(function () {
      if (!modal) return;
      renderTimer();
      var left = Math.ceil((modal.endAt - Date.now()) / 1000);
      if (left <= 0 && !modal.expired) {
        modal.expired = true; stopTimer(); renderTimer(); sfx('timeup');
      } else if (left <= 5 && left > 0 && left !== modal.lastTick) {
        modal.lastTick = left; sfx('tick');
      }
    }, 200);
  }
  function stopTimer() {
    if (modal && modal.timerId) { clearInterval(modal.timerId); modal.timerId = null; }
  }
  function renderTimer() {
    var el = $('q-timer');
    if (!modal || g.timeLimit <= 0) { show(el, false); return; }
    show(el, true);
    var num = $('q-timer-num'), segs = $('q-timer-bar').children;
    var leftMs = modal.expired ? 0 : Math.max(0, modal.endAt - Date.now());
    if (!modal.timerId && !modal.expired) { el.className = 'q-timer paused'; return; }
    var frac = leftMs / (g.timeLimit * 1000);
    var on = Math.ceil(frac * segs.length - 1e-6);
    var col = frac > 0.6 ? '#48d04a' : frac > 0.3 ? '#ff9f2e' : '#ee3b3b';
    for (var i = 0; i < segs.length; i++) {
      segs[i].className = i < on ? '' : 'off';
      segs[i].style.background = col;
    }
    if (modal.expired) { num.textContent = '시간 종료!'; el.className = 'q-timer over'; return; }
    num.textContent = Math.ceil(leftMs / 1000) + '초';
    el.className = 'q-timer';
  }

  function reveal() {
    if (!modal || modal.revealed) return;
    modal.revealed = true;
    stopTimer();
    renderModal();
  }

  function closeModal() {
    stopTimer();
    modal = null;
    show($('qmodal'), false);
    if (g && heroChars.length && !busy) showHero(g.turn, 'idle', 'normal');
  }

  function changeQuestion() {
    if (!modal) return;
    openQuestion(modal.idx, modal.kind, modal.question.key);
  }

  function decide(correct) {
    if (!modal || busy) return;
    var idx = modal.idx;
    stopTimer();
    modal = null;
    show($('qmodal'), false);
    var ev = Logic.judge(g, idx, correct, Math.random);
    saveGame();
    var fx = { pop: [], drop: [] };
    if (correct) fx.pop.push(idx);
    if (ev.special === 'bonus' && ev.effectIdx >= 0) fx.pop.push(ev.effectIdx);
    if (ev.special === 'quake' && ev.effectIdx >= 0) fx.drop.push(ev.effectIdx);
    renderGame(fx);
    if (!correct) {
      sfx('wrong'); toast('오답 — 땅은 그대로입니다');
      showHero(ev.team, 'flinch', 'sweat', 1500);
    } else {
      sfx('correct');
      showHero(ev.team, 'cheer', ev.special ? 'shine' : 'happy', ev.special ? 2400 : 1500);
    }
    if (ev.special) {
      busy = true;
      setTimeout(function () { showFx(ev, function () { busy = false; afterJudge(); }); }, 450);
    } else {
      afterJudge();
    }
  }

  function afterJudge() {
    if (g.ended) setTimeout(function () { showResults(true); }, 700);
  }

  // ---------- 특수 칸 연출 ----------
  function showFx(ev, done) {
    var info = SPECIAL_INFO[ev.special];
    var detail = info.desc;
    if (ev.special === 'bonus') detail = ev.effectIdx >= 0 ? (ev.effectIdx + 1) + '번 땅을 덤으로 얻었습니다!' : '맞닿은 빈 땅이 없어 효과가 없습니다';
    if (ev.special === 'quake') detail = ev.effectIdx >= 0
      ? esc(teamName(ev.effectPrevOwner)) + '의 ' + (ev.effectIdx + 1) + '번 땅이 빈 땅이 되었습니다!' : '맞닿은 다른 조 땅이 없어 효과가 없습니다';
    if (ev.special === 'again') detail = esc(teamName(ev.team)) + '가 한 번 더 합니다!';
    if (ev.special === 'fort') detail = (ev.idx + 1) + '번 땅은 이제 공격받지 않습니다';
    var fx = $('fx');
    fx.innerHTML = '<div class="win fx-card fx-' + ev.special + '"><div class="fx-icon" style="background-image:' + icon(SPECIAL_ICON[ev.special]) + '"></div>' +
      '<div class="fx-title">' + info.title + '</div><div class="fx-desc">' + detail + '</div></div>';
    show(fx, true);
    sfx('special');
    setTimeout(function () { show(fx, false); done(); }, 1700);
  }

  // ---------- 결과 ----------
  function clearPodium() {
    podiumChars.forEach(function (c) { c.destroy(); });
    podiumChars = [];
    $('podium').innerHTML = '';
  }

  function showResults(withSound) {
    closeModal();
    clearPodium();
    var ranked = Logic.rankScores(Logic.computeScores(g.cells, g.cols, g.rows, g.teams.length));
    var html = '';
    ranked.forEach(function (s) {
      html += '<div class="res-row rank-' + s.rank + '" style="--team:' + TEAM_COLORS[s.team].bg + '">' +
        '<span class="res-rank">' + s.rank + '위</span>' + teamChip(s.team) +
        '<span class="res-name">' + esc(teamName(s.team)) + '</span>' +
        '<span class="res-calc">땅 ' + s.cells + ' + 연결 ' + s.largest + '</span>' +
        '<span class="res-total">' + s.total + '점</span></div>';
    });
    $('res-list').innerHTML = html;
    $('btn-res-undo').disabled = !g.history.length;
    show($('results'), true);
    buildPodium(ranked.slice(0, 3));
    if (withSound) sfx('fanfare');
  }

  function buildPodium(top) {
    var host = $('podium');
    // 가운데 1위, 왼쪽 2위, 오른쪽 3위
    var order = [1, 0, 2].filter(function (i) { return top[i]; });
    var heights = [27, 18, 11];
    var charPx = Math.min(vh(34), 330);
    var stoneImg = V.tex.stoneBrick();
    order.forEach(function (i) {
      var s = top[i];
      var col = document.createElement('div');
      col.className = 'pod';
      var c = V.create({ team: s.team, outfit: TEAM_COLORS[s.team].bg, size: charPx });
      if (s.rank === 1) c.setFace('happy').play('cheer');
      else c.setFace(i === 1 ? 'happy' : 'normal').play('idle');
      podiumChars.push(c);
      var nm = document.createElement('div');
      nm.className = 'pod-name';
      nm.textContent = teamName(s.team);
      col.appendChild(nm);
      col.appendChild(c.el);
      var blk = document.createElement('div');
      blk.className = 'pod-block';
      blk.style.height = heights[i] + 'vh';
      blk.style.backgroundImage = s.rank === 1 ? V.tex.wool('#f0c020') : stoneImg;
      blk.innerHTML = '<div class="pod-rank">' + s.rank + '위</div><div class="pod-score">' + s.total + '점</div>';
      col.appendChild(blk);
      host.appendChild(col);
    });
  }

  function endGameByTeacher() {
    if (!g || modal || busy) return;
    if (!root.confirm('게임을 끝내고 결과를 볼까요?')) return;
    g.history.push(JSON.stringify({ cells: g.cells, turn: g.turn, used: g.used, ended: g.ended }));
    g.ended = true;
    saveGame();
    renderGame();
    showResults(true);
  }

  // ---------- 되돌리기 / 기타 ----------
  function doUndo() {
    if (!g || modal || busy) return;
    if (!Logic.undo(g)) { toast('되돌릴 판정이 없습니다'); return; }
    saveGame();
    clearPodium();
    show($('results'), false);
    renderGame();
    showHero(g.turn, 'idle', 'normal');
    toast('직전 판정을 취소했습니다');
  }

  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } catch (e) { /* 무시 */ }
  }

  function toggleSound() {
    prefs.sound = !prefs.sound;
    storageSet(PREF_KEY, prefs);
    if (g) renderTopbar();
    if (prefs.sound) sfx('click');
  }

  function onKey(e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (editorOpen()) return; // 문제 편집기에서는 게임 단축키를 쓰지 않는다
    var code = e.code;
    if (code === 'KeyF') { e.preventDefault(); toggleFullscreen(); return; }
    if ($('game').classList.contains('hidden')) return;
    if (modal) {
      if (code === 'Space') { e.preventDefault(); reveal(); }
      else if (code === 'KeyO') { e.preventDefault(); decide(true); }
      else if (code === 'KeyX') { e.preventDefault(); decide(false); }
      else if (code === 'KeyN') { e.preventDefault(); changeQuestion(); }
      else if (code === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    if (code === 'KeyZ') { e.preventDefault(); doUndo(); }
    else if (code === 'Space') { e.preventDefault(); }
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layoutBoard();
      layoutHero();
      if (!$('setup').classList.contains('hidden')) renderSetupChars();
    }, 80);
  }

  function init() {
    var p = storageGet(PREF_KEY);
    if (p && typeof p.sound === 'boolean') prefs.sound = p.sound;
    initLook();
    var sets = allSets();
    var firstPlayable = sets.filter(function (x) { return x.questions.length > 0; })[0];
    if (firstPlayable) setup.setIds = [firstPlayable.id];
    // 문제 편집기를 닫으면 세트 목록·문항 수를 바로 다시 그린다
    document.addEventListener('ttsets-changed', function () { renderSetup(); });
    var s = loadSave();
    if (s) {
      setup.teamCount = s.teams.length;
      setup.names = s.teams.map(function (t) { return t.name; });
      setup.sizeKey = s.sizeKey; setup.timeLimit = s.timeLimit;
      var known = s.setIds.filter(function (id) { return sets.some(function (x) { return x.id === id; }); });
      if (known.length) setup.setIds = known;
    }
    bindSetup();
    renderSetupChars();
    renderSetup();
    $('board').addEventListener('click', onBoardClick);
    $('btn-reveal').addEventListener('click', reveal);
    $('btn-correct').addEventListener('click', function () { decide(true); });
    $('btn-wrong').addEventListener('click', function () { decide(false); });
    $('btn-change').addEventListener('click', changeQuestion);
    $('btn-close').addEventListener('click', closeModal);
    $('btn-undo').addEventListener('click', doUndo);
    $('btn-sound').addEventListener('click', toggleSound);
    $('btn-full').addEventListener('click', toggleFullscreen);
    $('btn-full-setup').addEventListener('click', toggleFullscreen);
    $('btn-end').addEventListener('click', endGameByTeacher);
    $('btn-setup').addEventListener('click', function () {
      if (modal || busy) return;
      if (g && !g.ended && !root.confirm('설정 화면으로 갈까요? (지금 판은 저장되어 "이어하기"로 돌아올 수 있습니다)')) return;
      backToSetup();
    });
    $('btn-again').addEventListener('click', backToSetup);
    $('btn-res-undo').addEventListener('click', doUndo);
    $('btn-res-board').addEventListener('click', function () { clearPodium(); show($('results'), false); });
    document.addEventListener('keydown', onKey);
    root.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', function () { setTimeout(onResize, 60); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
