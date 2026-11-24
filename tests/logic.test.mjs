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
test('세트 5개 로드, id 중복 없음', () => {
  assert.equal(sets.length, 5);
  assert.equal(new Set(sets.map((s) => s.id)).size, 5);
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

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
