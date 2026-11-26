// 실행: node tests/logic.test.mjs
// game.js와 sets/*.js를 vm으로 불러와 순수 로직과 문제 세트 형식을 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadLogic() {
  const ctx = { module: { exports: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), ctx, { filename: 'game.js' });
  return ctx.module.exports;
}
function loadSets() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  const dir = path.join(ROOT, 'sets');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.window.QUIZ_SETS;
}
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// 보드 문자열 → cells. '.'=빈 칸, 숫자=조 번호(0부터), 'F'=0조 요새
function board(rows) {
  const cells = [];
  rows.join('').split('').forEach((ch) => {
    if (ch === '.') cells.push({ owner: -1, special: null, used: false, fort: false });
    else if (ch === 'F') cells.push({ owner: 0, special: null, used: false, fort: true });
    else cells.push({ owner: Number(ch), special: null, used: false, fort: false });
  });
  return { cells, cols: rows[0].length, rows: rows.length };
}

// vm 안에서 만든 배열은 프로토타입이 달라 JSON으로 옮겨 비교한다
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

const L = loadLogic();
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('[순수 로직]');
test('neighbors: 모서리/가운데', () => {
  same(L.neighbors(0, 5, 4).slice().sort((a, b) => a - b), [1, 5]);
  same(L.neighbors(7, 5, 4).slice().sort((a, b) => a - b), [2, 6, 8, 12]);
  same(L.neighbors(19, 5, 4).slice().sort((a, b) => a - b), [14, 18]);
});
test('isAdjacent: 줄 바뀜·대각선은 인접 아님', () => {
  assert.equal(L.isAdjacent(4, 5, 5), false);  // 0행 끝 - 1행 처음
  assert.equal(L.isAdjacent(0, 6, 5), false);  // 대각선
  assert.equal(L.isAdjacent(0, 1, 5), true);
  assert.equal(L.isAdjacent(0, 5, 5), true);
});
test('canSelect: 빈 칸/자기 칸/인접 공격/비인접/요새', () => {
  const b = board(['0.1', '...', 'F.2']);
  assert.equal(L.canSelect(b.cells, b.cols, b.rows, 1, 0).kind, 'empty');
  assert.equal(L.canSelect(b.cells, b.cols, b.rows, 0, 0).kind, 'own');
  assert.equal(L.canSelect(b.cells, b.cols, b.rows, 2, 0).ok, false); // 1조 땅은 0조와 비인접
  assert.equal(L.canSelect(b.cells, b.cols, b.rows, 6, 2).kind, 'fort'); // 요새는 인접해도 불가
  const b2 = board(['01', '..']);
  const r = L.canSelect(b2.cells, b2.cols, b2.rows, 1, 0);
  assert.equal(r.ok, true); assert.equal(r.kind, 'attack');
  same(L.attackableCells(b2.cells, b2.cols, b2.rows, 0), [1]);
});
test('largestRegion: 상하좌우 연결만 인정', () => {
  const b = board(['00.1', '0.11', '.0.1', '0000']);
  assert.equal(L.largestRegion(b.cells, b.cols, b.rows, 0), 5); // 위 덩어리 3, 아래 덩어리 5
  assert.equal(L.largestRegion(b.cells, b.cols, b.rows, 1), 4);
  assert.equal(L.largestRegion(b.cells, b.cols, b.rows, 2), 0);
  const d = board(['0.', '.0']); // 대각선만
  assert.equal(L.largestRegion(d.cells, d.cols, d.rows, 0), 1);
});
test('computeScores / rankScores: 동점 같은 순위', () => {
  const b = board(['001', '.11', '22.']);
  const sc = L.computeScores(b.cells, b.cols, b.rows, 3);
  same(sc.map((s) => s.total), [4, 6, 4]);
  const r = L.rankScores(sc);
  assert.equal(r[0].team, 1); assert.equal(r[0].rank, 1);
  same(r.slice(1).map((s) => s.rank), [2, 2]);
});

const POOL = [
  { key: 'a', level: 1 }, { key: 'b', level: 2 }, { key: 'c', level: 3 }, { key: 'd', level: 3 }
];
test('pickQuestion: 빈 칸은 level 1~2, 공격은 level 3', () => {
  const rng = seeded(1);
  for (let i = 0; i < 30; i++) {
    assert.ok(L.pickQuestion(POOL, [], 'empty', rng).question.level <= 2);
    assert.equal(L.pickQuestion(POOL, [], 'attack', rng).question.level, 3);
  }
});
test('pickQuestion: level 3 소진 시 가장 높은 level, 1~2 소진 시 다른 level', () => {
  assert.equal(L.pickQuestion(POOL, ['c', 'd'], 'attack', seeded(2)).question.key, 'b');
  assert.equal(L.pickQuestion(POOL, ['c', 'd', 'b'], 'attack', seeded(2)).question.key, 'a');
  assert.equal(L.pickQuestion(POOL, ['a', 'b'], 'empty', seeded(2)).question.level, 3);
});
test('pickQuestion: 전부 소진 시 reset, 문제 바꾸기는 직전 문제 제외', () => {
  const r = L.pickQuestion(POOL, ['a', 'b', 'c', 'd'], 'empty', seeded(3));
  assert.equal(r.reset, true); assert.ok(r.question);
  for (let i = 0; i < 20; i++) {
    const x = L.pickQuestion(POOL, ['a'], 'empty', seeded(i), 'b');
    assert.notEqual(x.question.key, 'b');
  }
  assert.equal(L.pickQuestion([{ key: 'only', level: 1 }], ['only'], 'empty', seeded(1), 'only').question.key, 'only');
  assert.equal(L.pickQuestion([], [], 'empty'), null);
});
test('buildQuestionPool: 선택 세트만, level 보정', () => {
  const sets = [{ id: 'x', questions: [{ q: 'Q', a: 'A', level: 9 }, { q: '', a: 'A' }] }, { id: 'y', questions: [{ q: 'Q2', a: 'A2', level: 1 }] }];
  const p = L.buildQuestionPool(sets, ['x']);
  assert.equal(p.length, 1); assert.equal(p[0].key, 'x#0'); assert.equal(p[0].level, 3);
});
test('placeSpecials: 약 20%, 네 종류 모두 사용', () => {
  const sp = L.placeSpecials(30, seeded(5));
  const list = sp.filter(Boolean);
  assert.equal(list.length, 6);
  same([...new Set(list)].sort(), ['again', 'bonus', 'fort', 'quake']);
  assert.equal(L.placeSpecials(20, seeded(6)).filter(Boolean).length, 4);
  assert.equal(L.placeSpecials(40, seeded(7)).filter(Boolean).length, 8);
});

function game(rowsStr, nTeams = 3) {
  const b = board(rowsStr);
  return { v: 1, teams: Array.from({ length: nTeams }, (_, i) => ({ name: i + 1 + '조' })), setIds: [], sizeKey: 'm',
    cols: b.cols, rows: b.rows, timeLimit: 0, cells: b.cells, turn: 0, used: [], history: [], ended: false };
}
test('judge: 정답 점령·턴 이동, 오답 변화 없음, undo 복원', () => {
  const g = game(['...', '...']);
  L.judge(g, 0, true);
  assert.equal(g.cells[0].owner, 0); assert.equal(g.turn, 1);
  L.judge(g, 1, false);
  assert.equal(g.cells[1].owner, -1); assert.equal(g.turn, 2);
  assert.equal(L.undo(g), true); assert.equal(g.turn, 1);
  assert.equal(L.undo(g), true); assert.equal(g.cells[0].owner, -1); assert.equal(g.turn, 0);
  assert.equal(L.undo(g), false);
});
test('특수 칸: 한 번 더 / 요새', () => {
  const g = game(['...', '...']);
  g.cells[0].special = 'again';
  const ev = L.judge(g, 0, true);
  assert.equal(ev.special, 'again'); assert.equal(g.turn, 0);
  g.cells[5].special = 'fort';
  L.judge(g, 5, true);
  assert.equal(g.cells[5].fort, true); assert.equal(g.turn, 1);
  assert.equal(L.canSelect(g.cells, g.cols, g.rows, 5, 1).kind, 'fort');
});
test('특수 칸: 보너스 땅(인접 빈 칸), 없으면 무효', () => {
  const g = game(['.1.', '111']);
  g.cells[0].special = 'bonus';
  const ev = L.judge(g, 0, true, seeded(1));
  assert.equal(ev.effectIdx, -1);
  const g2 = game(['...', '...']);
  g2.cells[4].special = 'bonus';
  const ev2 = L.judge(g2, 4, true, seeded(1));
  assert.ok([1, 3, 5].includes(ev2.effectIdx)); assert.equal(g2.cells[ev2.effectIdx].owner, 0);
});
test('특수 칸: 지진은 인접한 다른 조(요새 제외) 칸을 중립으로', () => {
  const g = game(['1.F', '...']);
  g.turn = 2;
  g.cells[1].special = 'quake';
  const ev = L.judge(g, 1, true, seeded(1));
  assert.equal(ev.effectIdx, 0); assert.equal(g.cells[0].owner, -1);
  assert.equal(g.cells[2].owner, 0); // 요새는 그대로
  assert.equal(L.undo(g), true); assert.equal(g.cells[0].owner, 1); assert.equal(g.cells[1].special, 'quake'); assert.equal(g.cells[1].used, false);
});
test('특수 칸은 한 번만 발동, 빈 칸이 없으면 ended', () => {
  const g = game(['..']);
  g.cells[0].special = 'again';
  L.judge(g, 0, true); assert.equal(g.turn, 0);
  assert.equal(g.ended, false);
  L.judge(g, 1, true); assert.equal(g.ended, true);
});
test('createGame + isValidSave + JSON 왕복', () => {
  const g = L.createGame({ teamNames: ['가', '나'], setIds: ['x'], sizeKey: 'l', timeLimit: 20 }, seeded(9));
  assert.equal(g.cells.length, 40);
  assert.equal(g.cells.filter((c) => c.special).length, 8);
  assert.equal(L.isValidSave(JSON.parse(JSON.stringify(g))), true);
  assert.equal(L.isValidSave({}), false);
});

console.log('[문제 세트]');
const sets = loadSets();
test('세트 9개 로드, id 중복 없음', () => {
  assert.equal(sets.length, 9);
  assert.equal(new Set(sets.map((s) => s.id)).size, 9);
});
for (const s of sets) {
  test(`${s.id}: 형식·문항 수·level 분포`, () => {
    assert.ok(s.title && Array.isArray(s.questions));
    const min = s.id === 'recreation' ? 40 : 30;
    assert.ok(s.questions.length >= min, `문항 ${s.questions.length} < ${min}`);
    const cnt = { 1: 0, 2: 0, 3: 0 };
    s.questions.forEach((q, i) => {
      assert.ok(typeof q.q === 'string' && q.q.trim(), `#${i} q 없음`);
      assert.ok(typeof q.a === 'string' && q.a.trim(), `#${i} a 없음`);
      assert.ok([1, 2, 3].includes(q.level), `#${i} level ${q.level}`);
      cnt[q.level]++;
    });
    assert.equal(new Set(s.questions.map((q) => q.q)).size, s.questions.length, '중복 문제');
    assert.ok(cnt[1] >= 8 && cnt[2] >= 8 && cnt[3] >= 6, JSON.stringify(cnt));
    console.log(`       ${s.questions.length}문항 (level1 ${cnt[1]}, level2 ${cnt[2]}, level3 ${cnt[3]})`);
  });
}

// ---------------------------------------------------------------- 문제 편집기 순수 함수(editor.js)
function loadEditorLogic() {
  const ctx = { module: { exports: {} }, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8'), ctx, { filename: 'editor.js' });
  return ctx.module.exports;
}
const E = loadEditorLogic();
const plain = (x) => JSON.parse(JSON.stringify(x));

console.log('[문제 편집기]');
test('parsePaste: 탭 구분, 난이도·메모 생략, 빈 줄 무시', () => {
  const r = E.parsePaste('물가가 오르는 현상?\t인플레이션\t1\t물가\n\n환율이란?\t돈 교환 비율\n  \n도심\t중심\t9\n');
  same(r.items, [
    { q: '물가가 오르는 현상?', a: '인플레이션', level: 1, note: '물가' },
    { q: '환율이란?', a: '돈 교환 비율', level: 2 },
    { q: '도심', a: '중심', level: 2 }
  ]);
  assert.equal(r.skipped, 0);
});
test('parsePaste: | 구분, CRLF, 정답 없는 줄·머리글 줄은 건너뜀', () => {
  const r = E.parsePaste('문제|정답|난이도\r\n수도는?| 서울 |3\r\n정답 없는 줄\r\n질문만|  \r\n가|나|x|메모');
  same(r.items, [{ q: '수도는?', a: '서울', level: 3 }, { q: '가', a: '나', level: 2, note: '메모' }]);
  assert.equal(r.skipped, 3);
});
test('parsePaste: 엑셀식 따옴표 칸(줄바꿈 포함)과 따옴표 글자', () => {
  const r = E.parsePaste('"두 줄\n문제"\t답\t2\n"인용" 문제\t답2');
  same(r.items, [{ q: '두 줄\n문제', a: '답', level: 2 }, { q: '"인용" 문제', a: '답2', level: 2 }]);
});
test('normLevel: 1~3 외에는 2', () => {
  same([1, 2, 3, 0, 4, '3', '', null, 'abc', 2.5].map(E.normLevel), [1, 2, 3, 2, 2, 3, 2, 2, 2, 2]);
});
test('parseImport: 단일 세트·배열·{sets} 허용, 정규화', () => {
  const one = E.parseImport(JSON.stringify({ id: 'a', title: ' 제목 ', questions: [{ q: 'Q', a: 1, level: 7 }] }));
  assert.equal(one.ok, true);
  same(one.sets, [{ id: 'a', title: '제목', description: '', questions: [{ q: 'Q', a: '1', level: 2 }] }]);
  const many = E.parseImport('﻿' + JSON.stringify({ format: 'ttang-battle-sets', sets: [{ questions: [] }, { title: 'B', questions: [{ q: 'x', a: 'y', note: 'n', level: 3 }] }] }));
  assert.equal(many.ok, true);
  assert.equal(many.sets.length, 2);
  assert.equal(many.sets[0].title, '이름 없는 세트');
  same(many.sets[1].questions, [{ q: 'x', a: 'y', level: 3, note: 'n' }]);
  assert.equal(E.parseImport('[{"title":"t","questions":[]}]').ok, true);
});
test('parseImport: 잘못된 파일은 한 줄 오류로 거부', () => {
  const bad = ['not json', '{"title":"t"}', '[]', '[1]', '{"sets":[{"title":"t"}]}',
    '{"questions":["문자열"]}', '{"questions":[{"q":{"x":1},"a":"a"}]}', '{"title":{"a":1},"questions":[]}'];
  bad.forEach((t) => {
    const r = E.parseImport(t);
    assert.equal(r.ok, false, t);
    assert.ok(typeof r.error === 'string' && r.error && !r.error.includes('\n'), t);
  });
  assert.match(E.parseImport('{"sets":[{"title":"t","questions":[{"q":"a","a":"b"},5]}]}').error, /1번째 세트 2번 문항/);
});
test('uniqueId / uniqueTitle / placeSets: id·제목 충돌 처리', () => {
  assert.equal(E.uniqueId('social-5', ['social-5', 'social-5-2']), 'social-5-3');
  assert.equal(E.uniqueId('한글만', []), 'my-set');
  assert.equal(E.uniqueTitle('세트', ['세트', '세트 (2)']), '세트 (3)');
  assert.equal(E.uniqueTitle('새 이름', ['세트']), '새 이름');
  const existing = [{ id: 'social-5', title: '사회' }, { id: 'my-set', title: '내 세트' }];
  const placed = E.placeSets([
    { id: 'social-5', title: '사회', questions: [] },
    { id: '', title: '내 세트', questions: [] },
    { id: 'new', title: '새것', questions: [] },
    { id: 'new', title: '새것', questions: [] }
  ], existing);
  same(placed.map((s) => [s.id, s.title]), [['social-5-2', '사회 (2)'], ['my-set-2', '내 세트 (2)'], ['new', '새것'], ['new-2', '새것 (2)']]);
  assert.ok(placed.every((s) => !s.title.includes('가져옴')));
});
test('mergeSets: 기본(덮어쓰기 적용) + 내 세트, 원본 불변', () => {
  const builtins = [{ id: 'b1', title: '기본1', description: 'd', questions: [{ q: 'q1', a: 'a1', level: 1 }] }, { id: 'b2', title: '기본2', questions: [] }];
  const snapshot = JSON.stringify(builtins);
  const store = { v: 1, user: [{ id: 'u1', title: '내 것', questions: [{ q: 'x', a: 'y', level: 3 }] }, { id: 'b2', title: '이름 겹침', questions: [] }, { bad: true }],
    overrides: { b1: { title: '기본1 수정', description: '', questions: [{ q: 'q1', a: '고침', level: 2 }] }, zz: 5 } };
  const m = E.mergeSets(builtins, store);
  same(m.map((s) => [s.id, s.title, s.builtin, s.modified]), [['b1', '기본1 수정', true, true], ['b2', '기본2', true, false], ['u1', '내 것', false, false], ['b2-2', '이름 겹침', false, false]]);
  assert.equal(m[0].questions[0].a, '고침');
  assert.equal(JSON.stringify(builtins), snapshot);
  same(plain(E.normalizeStore('깨진 값')), { v: 1, user: [], overrides: {} });
});
test('playableSets: 문제나 정답이 빈 문항은 출제에서 제외', () => {
  const sets = [{ id: 's', title: 'S', questions: [{ q: 'a', a: 'b', level: 1 }, { q: '  ', a: 'b', level: 1 }, { q: 'a', a: '', level: 1 }] }, { id: 'e', title: 'E', questions: [] }];
  const p = E.playableSets(sets);
  assert.equal(p[0].questions.length, 1);
  assert.equal(E.countValid(sets[0]), 1);
  assert.equal(L.buildQuestionPool(p, ['s', 'e']).length, 1);
});
test('buildExport → parseImport 왕복, 파일 이름', () => {
  const sets = [{ id: 'm', title: '우리 반', description: '설명', questions: [{ q: 'Q', a: 'A', level: 3, note: 'N' }, { q: 'Q2', a: 'A2', level: 1 }] }];
  const back = E.parseImport(JSON.stringify(E.buildExport(sets)));
  assert.equal(back.ok, true);
  same(back.sets, plain(sets));
  assert.equal(E.exportFileName('우리 반/사회:1'), '땅따먹기-우리_반_사회_1.json');
});

// ---------------------------------------------------------------- 스틸·게임 길이·기록·그림
console.log('[스틸·게임 길이·복습·그림]');
const INFO = (k) => ({ key: k, q: 'Q' + k, a: 'A' + k, note: '', img: '' });
test('normalizeGame: 이전 버전 저장본은 스틸권 전원 보유·기록 없음·길이 없음', () => {
  const g = game(['...', '...'], 3);
  L.normalizeGame(g);
  same(g.steals, [true, true, true]);
  same(g.log, []);
  assert.equal(g.length, 'none'); assert.equal(g.stealOn, true); assert.equal(g.extra, false);
  same(g.turnsDone, [0, 0, 0]);
  const c = L.createGame({ teamNames: ['a', 'b'], setIds: [], sizeKey: 's', steal: false, length: 't10' }, seeded(1));
  assert.equal(c.stealOn, false); assert.equal(c.timeLeftMs, 600000);
});
test('stealCandidates: 차례 조 제외, 스틸권 남은 조만, 끄면 없음', () => {
  const g = game(['...'], 4);
  g.turn = 1;
  same(L.stealCandidates(g), [0, 2, 3]);
  g.steals[2] = false;
  same(L.stealCandidates(g), [0, 3]);
  g.stealOn = false;
  same(L.stealCandidates(g), []);
});
test('judgeSteal 성공: 스틸 조가 칸 차지, 권 소모, 차례는 원래 조 다음', () => {
  const g = game(['.1.', '...'], 3);
  g.turn = 0;
  const ev = L.judgeSteal(g, 1, 2, true, seeded(1), INFO('k1')); // 0조가 1조 땅 공격 → 오답 → 2조 스틸
  assert.equal(g.cells[1].owner, 2); assert.equal(g.steals[2], false);
  assert.equal(g.turn, 1); assert.equal(ev.team, 2); assert.equal(ev.origTeam, 0);
  assert.equal(g.log.at(-1).result, 'steal-ok'); assert.equal(g.log.at(-1).stealTeam, 2);
});
test('judgeSteal 실패: 변화 없음, 권은 소모, 되돌리기로 권·기록 복구', () => {
  const g = game(['...'], 3);
  g.turn = 2;
  L.judgeSteal(g, 0, 0, false, seeded(1), INFO('k2'));
  assert.equal(g.cells[0].owner, -1); assert.equal(g.steals[0], false); assert.equal(g.turn, 0);
  assert.equal(g.log.length, 1);
  assert.equal(L.undo(g), true);
  same(g.steals, [true, true, true]); same(g.log, []); assert.equal(g.turn, 2);
});
test('judgeSteal: 특수 칸 발동, "한 번 더"는 추가 턴 없음', () => {
  const g = game(['...', '...'], 3);
  g.cells[0].special = 'again';
  g.turn = 1;
  const ev = L.judgeSteal(g, 0, 2, true, seeded(1), INFO('k3'));
  assert.equal(ev.special, 'again'); assert.equal(ev.extraTurn, false);
  assert.equal(g.turn, 2); assert.equal(g.extra, false); // 원래 조(1)의 다음 조
  g.cells[4].special = 'bonus';
  const ev2 = L.judgeSteal(g, 4, 0, true, seeded(2), INFO('k4'));
  assert.equal(ev2.special, 'bonus'); assert.ok(ev2.effectIdx >= 0); assert.equal(g.cells[ev2.effectIdx].owner, 0);
});
test('judge 기록: 정답/오답 결과와 문제 글자, 그림은 유무만', () => {
  const g = game(['...'], 2);
  L.judge(g, 0, true, seeded(1), { key: 'a#0', q: '문제', a: '답', note: 'n', img: 'data:image/png;base64,AAAA' });
  L.judge(g, 1, false, seeded(1), INFO('a#1'));
  same(g.log.map((r) => [r.key, r.team, r.result, r.hasImg]), [['a#0', 0, 'correct', true], ['a#1', 1, 'wrong', false]]);
  assert.ok(!JSON.stringify(g.log).includes('base64'));
});
test('턴제: 정규 차례만 셈("한 번 더"·스틸 제외), N번씩 마치면 종료', () => {
  const g = game(['......', '......'], 2);
  g.length = 'r3';
  same(plain(L.roundInfo(g)), { round: 1, total: 3 });
  g.cells[0].special = 'again';
  L.judge(g, 0, true, seeded(1), INFO('x')); // 0조 1턴 + 한 번 더
  same(g.turnsDone, [1, 0]); assert.equal(g.turn, 0);
  L.judge(g, 1, false, seeded(1), INFO('y')); // 추가 턴: 세지 않음
  same(g.turnsDone, [1, 0]); assert.equal(g.turn, 1);
  L.judgeSteal(g, 2, 0, false, seeded(1), INFO('z')); // 1조 차례(스틸 포함)
  same(g.turnsDone, [1, 1]); assert.equal(g.ended, false);
  same(plain(L.roundInfo(g)), { round: 2, total: 3 });
  for (let i = 0; i < 4; i++) L.judge(g, 3, false, seeded(1), INFO('w' + i));
  same(g.turnsDone, [3, 3]); assert.equal(g.ended, true); assert.equal(L.turnsComplete(g), true);
});
test('시간제: tickClock 은 일시정지 중 멈춤, 0이면 다음 판정에서 종료', () => {
  const g = game(['....'], 2);
  g.length = 't10'; L.normalizeGame(g);
  assert.equal(g.timeLeftMs, 600000);
  assert.equal(L.tickClock(g, 599000), false);
  g.clockPaused = true;
  assert.equal(L.tickClock(g, 5000), false); assert.equal(g.timeLeftMs, 1000);
  g.clockPaused = false;
  assert.equal(L.tickClock(g, 5000), true); assert.equal(g.timeLeftMs, 0);
  assert.equal(g.ended, false); // 진행 중 문제를 마칠 때까지 기다림
  L.judge(g, 0, true, seeded(1), INFO('t'));
  assert.equal(g.ended, true);
  const g2 = game(['..'], 2);
  assert.equal(L.tickClock(g2, 99999), false); // 길이 제한 없음
});
test('reviewList: 틀린 것(오답·스틸 실패)만, 같은 문제는 마지막 기록 하나', () => {
  const log = [
    { key: 'a', result: 'wrong' }, { key: 'b', result: 'correct' }, { key: 'c', result: 'steal-ok' },
    { key: 'd', result: 'steal-fail' }, { key: 'a', result: 'correct' }, { key: 'e', result: 'wrong' }
  ];
  same(L.reviewList(log, false).map((r) => r.key), ['d', 'e']);
  same(L.reviewList(log, true).map((r) => r.key), ['b', 'c', 'd', 'a', 'e']);
});
test('sanitizeImg: data:image/ 와 상대 경로만 허용 (game.js·editor.js 같은 규칙)', () => {
  const cases = [
    ['data:image/png;base64,AAAA', true], ['sets/img/a.png', true], ['img/한글 그림.png', true], ['img/a\nb.png', false], ['  sets/x.jpg  ', true],
    ['http://x/a.png', false], ['https://x/a.png', false], ['javascript:alert(1)', false], ['data:text/html,<b>', false],
    ['/abs/a.png', false], ['//cdn/a.png', false], ['C:\\a.png', false], ['a"onerror=.png', false], [123, false], ['', false]
  ];
  for (const [v, ok] of cases) {
    assert.equal(!!L.sanitizeImg(v), ok, String(v));
    assert.equal(L.sanitizeImg(v), E.sanitizeImg(v), 'same rule: ' + v);
  }
});
test('buildQuestionPool·가져오기: img 는 검증 후 유지, 나쁜 주소는 버림', () => {
  const sets = [{ id: 's', questions: [{ q: 'Q', a: 'A', img: 'sets/img/p.png' }, { q: 'Q2', a: 'A2', img: 'javascript:x' }] }];
  const p = L.buildQuestionPool(sets, ['s']);
  assert.equal(p[0].img, 'sets/img/p.png'); assert.equal(p[1].img, '');
  const r = E.parseImport(JSON.stringify({ sets: [{ title: 't', questions: [{ q: 'q', a: 'a', img: 'data:image/jpeg;base64,/9j/' }, { q: 'q', a: 'a', img: 'http://evil/x.png' }] }] }));
  assert.equal(r.ok, true);
  assert.equal(r.sets[0].questions[0].img, 'data:image/jpeg;base64,/9j/');
  assert.equal('img' in r.sets[0].questions[1], false);
  const back = E.parseImport(JSON.stringify(E.buildExport(r.sets)));
  assert.equal(back.sets[0].questions[0].img, 'data:image/jpeg;base64,/9j/');
});

// ---------------------------------------------------------------- 음량·추첨·힌트·보기·기록·캐릭터
console.log('[음량·추첨·힌트·보기·기록·캐릭터]');
test('음량: 단계 배수(음악 2배·효과음 1.6배), 순환, 예전 설정 변환', () => {
  same(['off', 'low', 'mid', 'high'].map((l) => L.volumeScale('music', l)), [0, 0.5, 1, 2]);
  same(['off', 'low', 'mid', 'high'].map((l) => L.volumeScale('sfx', l)), [0, 0.5, 1, 1.6]);
  assert.equal(L.MUSIC_BASE * L.volumeScale('music', 'mid'), 0.2);
  same(['off', 'low', 'mid', 'high'].map(L.nextVolume), ['low', 'mid', 'high', 'off']);
  same(plain(L.migratePrefs({ sound: true, music: false })), { sfx: 'mid', music: 'off' });
  same(plain(L.migratePrefs({ sound: false, music: true })), { sfx: 'off', music: 'mid' });
  same(plain(L.migratePrefs({ sfx: 'high', music: 'low' })), { sfx: 'high', music: 'low' });
  same(plain(L.migratePrefs(null)), { sfx: 'mid', music: 'mid' });
});
test('추첨 가방: 한 바퀴 동안 중복 없음, 원본 불변, 다음 바퀴 첫 번호 ≠ 직전 번호', () => {
  const rng = seeded(11);
  for (let n = 2; n <= 8; n++) {
    let bag = [], last;
    for (let round = 0; round < 20; round++) {
      const seen = new Set();
      for (let k = 0; k < n; k++) {
        const before = JSON.stringify(bag);
        const r = L.drawStudent(bag, n, rng, last);
        assert.equal(JSON.stringify(bag), before, '원본 가방 불변');
        assert.ok(r.num >= 1 && r.num <= n);
        if (k === 0 && last !== undefined) assert.notEqual(r.num, last, `n=${n} 바퀴 경계 연속`);
        assert.ok(!seen.has(r.num), `n=${n} 중복`);
        seen.add(r.num); bag = r.bag; last = r.num;
      }
      assert.equal(seen.size, n);
    }
  }
  same(L.drawStudent([7, 1], 4, seeded(1)).num <= 4, true); // 인원이 줄면 범위 밖 번호는 버림
  assert.equal(L.clampDrawSize(1), 4); assert.equal(L.clampDrawSize(9), 4); assert.equal(L.clampDrawSize('6'), 6);
});
test('추첨 가방은 판정과 함께 저장·되돌리기', () => {
  const g = game(['....'], 2);
  L.normalizeGame(g);
  g.draw.on = true;
  const r = L.drawStudent(g.draw.bags[0], 4, seeded(3));
  L.judge(g, 0, true, seeded(1), { key: 'a', q: 'q', a: 'a', bags: { 0: r.bag }, students: { 0: r.num } });
  same(g.draw.bags[0], plain(r.bag)); assert.equal(g.log[0].students[0], r.num);
  L.undo(g);
  same(g.draw.bags[0], []);
});
test('힌트: 글자 수 → 초성, 공백·문장부호 유지, 괄호 병기는 (…)', () => {
  assert.equal(L.hintText('국내 총생산(GDP)', 1), '○○ ○○○(…)');
  assert.equal(L.hintText('국내 총생산(GDP)', 2), 'ㄱㄴ ㅊㅅㅅ(…)');
  assert.equal(L.hintText('2·3차 산업', 1), '○·○○ ○○');
  assert.equal(L.hintText('2·3차 산업', 2), '2·3ㅊ ㅅㅇ');
  assert.equal(L.hintText('GDP', 1), '○○○');
  assert.equal(L.hintText('GDP', 2), 'G○○');
  assert.equal(L.hintText('Paris agreement', 2), 'P○○○○ a○○○○○○○○');
  assert.equal(L.hintText('빨강, 초록, 파랑', 2), 'ㅃㄱ, ㅊㄹ, ㅍㄹ');
  assert.equal(L.hintText('1000', 2), '1○○○');
  assert.equal(L.hintText('쿠릴 열도(북방 4도)', 1), '○○ ○○(…)');
});
test('보기: 정리(2~5개), 정답 판정(공백·대소문자 무시, 번호)', () => {
  same(L.normalizeChoices([' 가 ', '', '나']), ['가', '나']);
  assert.equal(L.normalizeChoices(['하나']), null);
  assert.equal(L.normalizeChoices(['1', '2', '3', '4', '5', '6']), null);
  assert.equal(L.normalizeChoices('가;나'), null);
  const ch = ['선진국', '개발 도상국', 'GDP', '3해리'];
  assert.equal(L.choiceIndex(ch, '개발도상국'), 1);
  assert.equal(L.choiceIndex(ch, 'gdp'), 2);
  assert.equal(L.choiceIndex(ch, '③'), 2);
  assert.equal(L.choiceIndex(ch, '4'), 3);
  assert.equal(L.choiceIndex(ch, '5'), -1);
  assert.equal(L.choiceIndex(ch, '없는 답'), -1);
  assert.equal(L.choiceIndex(['3', '12'], '12'), 1); // 글자 일치가 번호보다 먼저
  for (const [c, a] of [[ch, '개발도상국'], [ch, '②'], [['O', 'X'], 'x'], [['가'], '가']]) {
    assert.equal(E.choiceIndex(E.normalizeChoices(c) || c, a), L.choiceIndex(L.normalizeChoices(c) || c, a), 'same rule');
  }
  const p = L.buildQuestionPool([{ id: 's', questions: [{ q: 'Q', a: '나', choices: ['가', '나'] }, { q: 'Q2', a: 'b', choices: ['b'] }] }], ['s']);
  same(p[0].choices, ['가', '나']); assert.equal(p[1].choices, null);
});
test('편집기: 보기 검증(정답이 보기를 가리켜야 출제), 붙여넣기 5번째 칸, 가져오기', () => {
  assert.equal(E.isValidQuestion({ q: 'Q', a: '나', choices: ['가', '나'] }), true);
  assert.equal(E.isValidQuestion({ q: 'Q', a: '다', choices: ['가', '나'] }), false);
  assert.equal(E.isValidQuestion({ q: 'Q', a: '다', choices: ['가', ''] }), true); // 보기 1개면 일반 문항
  const r = E.parsePaste('수도는?\t서울\t1\t\t부산;서울;대구\n환율?|비율|2|메모|가;나|다\n보기 하나|답|1||하나');
  same(r.items, [
    { q: '수도는?', a: '서울', level: 1, choices: ['부산', '서울', '대구'] },
    { q: '환율?', a: '비율', level: 2, note: '메모', choices: ['가', '나', '다'] },
    { q: '보기 하나', a: '답', level: 1 }
  ]);
  const imp = E.parseImport(JSON.stringify({ sets: [{ title: 't', questions: [{ q: 'q', a: '나', choices: ['가', '나', ''] }, { q: 'q', a: 'a', choices: ['x'] }] }] }));
  same(imp.sets[0].questions, [{ q: 'q', a: '나', level: 2, choices: ['가', '나'] }, { q: 'q', a: 'a', level: 2 }]);
  assert.equal(E.parseImport(JSON.stringify({ questions: [{ q: 'q', a: 'a', choices: '가;나' }] })).ok, false);
  const st = E.normalizeStore({ v: 1, user: [{ id: 'u', title: 'U', questions: [{ q: 'q', a: '', choices: ['', '나', ''] }] }], overrides: {} });
  same(st.user[0].questions[0].choices, ['', '나', '']); // 편집 중인 빈 보기 칸은 저장본에서 유지
});
test('기록: 생성(정답률·순위), 같은 판 갱신, 100판 제한, CSV(BOM·따옴표)', () => {
  const g = game(['01..'], 2);
  L.normalizeGame(g);
  g.gameId = 'G1'; g.className = '3-2';
  g.log = [{ result: 'correct' }, { result: 'wrong' }, { result: 'steal-ok' }, { result: 'steal-fail' }];
  const rec = L.buildRecord(g, ['사회 "Ⅴ"', '레크'], new Date('2026-11-25T03:04:00Z'));
  assert.equal(rec.correctRate, 50); assert.equal(rec.questions, 4); assert.equal(rec.className, '3-2');
  same(rec.teams.map((t) => [t.name, t.rank, t.score, t.cells]), [['1조', 1, 2, 1], ['2조', 1, 2, 1]]);
  let list = L.upsertRecord([], rec);
  list = L.upsertRecord(list, { ...rec, correctRate: 75 });
  assert.equal(list.length, 1); assert.equal(list[0].correctRate, 75);
  for (let i = 0; i < 120; i++) list = L.upsertRecord(list, { ...rec, id: 'x' + i });
  assert.equal(list.length, 100); assert.equal(list[0].id, 'x119');
  const csv = L.recordsToCSV([rec]);
  assert.ok(csv.startsWith('﻿날짜,반,세트,'));
  assert.ok(csv.includes('"사회 ""Ⅴ"" / 레크"'));
  assert.equal(csv.trim().split('\r\n').length, 3);
});
test('캐릭터 모양: 기본은 조 순서, 8종 범위 밖 값은 기본으로, 이전 저장본 호환', () => {
  const g = game(['..'], 3);
  L.normalizeGame(g);
  same(g.looks, [0, 1, 2]);
  const c = L.createGame({ teamNames: ['a', 'b', 'c'], setIds: [], sizeKey: 's', looks: [7, 99, -1] }, seeded(1));
  same(c.looks, [7, 1, 2]);
  assert.equal(L.LOOK_COUNT, 8);
  same(c.draw.sizes, [4, 4, 4]); assert.equal(c.draw.on, false); assert.equal(c.hintOn, true);
  assert.ok(typeof c.gameId === 'string' && c.gameId.length > 3);
});
for (const s of sets) {
  test(`${s.id}: 보기가 있는 문항은 정답이 보기 중 하나`, () => {
    s.questions.forEach((q, i) => {
      if (q.choices === undefined) return;
      const ch = L.normalizeChoices(q.choices);
      assert.ok(ch && ch.length === q.choices.length, `#${i} 보기 형식`);
      assert.notEqual(L.choiceIndex(ch, q.a), -1, `#${i} 정답 "${q.a}"가 보기에 없음`);
    });
    if (/^social-(9|10|11|12)$/.test(s.id)) assert.ok(s.questions.filter((q) => q.choices).length >= 5, '보기형 5개 이상');
  });
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
