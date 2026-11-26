/* 배경음악 — WebAudio 오실레이터(square/triangle/sine)만 쓰는 자작 칩튠 루프 3곡. 잡음(noise) 소리는 쓰지 않는다.
   calm(설정·보드 대기) / tense(문제 푸는 중, hurry 면 빨라짐) / fanfare(결과).
   브라우저 자동재생 정책 때문에 사용자의 첫 클릭·키 입력 뒤에 시작하고, 탭이 숨겨지면 멈춘다.
   확인용: TTMusic.state() 가 AudioContext 상태·현재 곡·예약한 음표 수를 돌려준다. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  // 음 이름 → MIDI 번호
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function m(name) { // 'C4', 'F#3', 'Bb4', '-'(쉼)
    if (!name || name === '-') return null;
    var mt = /^([A-G])([#b]?)(\d)$/.exec(name);
    var n = NOTE[mt[1]] + (mt[2] === '#' ? 1 : mt[2] === 'b' ? -1 : 0);
    return 12 * (Number(mt[3]) + 1) + n;
  }
  function seq(str) { return str.trim().split(/\s+/).map(m); }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // 8분음표 단위 스텝. 모두 이 프로젝트를 위해 새로 지은 짧은 루프(기존 곡 인용 없음)
  var TRACKS = {
    calm: {
      bpm: 96, vol: 1,
      lead: { wave: 'triangle', gain: 0.55, len: 0.9, notes: seq(
        'E5 - G5 - A5 G5 E5 - D5 - E5 - C5 - - - ' +
        'D5 - E5 - G5 - E5 D5 C5 - A4 - G4 - - - ' +
        'E5 - G5 - A5 - C6 - A5 G5 E5 - G5 - - - ' +
        'A5 - G5 E5 D5 - C5 - D5 - E5 - C5 - - -') },
      bass: { wave: 'sine', gain: 0.7, len: 1.6, notes: seq(
        'C3 - - - G3 - - - A2 - - - E3 - - - ' +
        'F2 - - - C3 - - - G2 - - - G2 - D3 - ' +
        'C3 - - - G3 - - - A2 - - - E3 - - - ' +
        'F2 - - - G2 - - - C3 - - - C3 - - -') },
      arp: { wave: 'sine', gain: 0.18, len: 0.5, notes: seq(
        'C5 E5 G5 E5 B4 D5 G5 D5 A4 C5 E5 C5 G4 B4 E5 B4 ' +
        'A4 C5 F5 C5 G4 C5 E5 C5 B4 D5 G5 D5 B4 D5 G5 D5 ' +
        'C5 E5 G5 E5 B4 D5 G5 D5 A4 C5 E5 C5 G4 B4 E5 B4 ' +
        'A4 C5 F5 C5 B4 D5 G5 D5 C5 E5 G5 E5 C5 E5 G5 E5') }
    },
    tense: {
      bpm: 132, vol: 0.9,
      lead: { wave: 'square', gain: 0.32, len: 0.7, notes: seq(
        'A4 - - C5 B4 - A4 - E5 - - D5 C5 - B4 - ' +
        'A4 - - C5 B4 - G4 - A4 - - - - - E4 - ' +
        'F4 - - A4 G4 - F4 - E4 - G#4 - B4 - E5 - ' +
        'D5 - C5 - B4 - G#4 - A4 - - - - - - -') },
      bass: { wave: 'square', gain: 0.22, len: 0.45, notes: seq(
        'A2 A2 E3 A2 A2 A2 E3 A2 A2 A2 E3 A2 G2 G2 D3 G2 ' +
        'F2 F2 C3 F2 F2 F2 C3 F2 E2 E2 B2 E2 E2 E2 G#2 E2 ' +
        'D2 D2 A2 D2 D2 D2 A2 D2 E2 E2 B2 E2 E2 E2 B2 E2 ' +
        'F2 F2 C3 F2 G2 G2 D3 G2 A2 A2 E3 A2 E2 E2 G#2 B2') },
      arp: { wave: 'triangle', gain: 0.2, len: 0.3, notes: seq(
        'A5 - E5 - A5 - E5 - A5 - E5 - G5 - D5 - ' +
        'F5 - C5 - F5 - C5 - E5 - B4 - E5 - B4 - ' +
        'D5 - A4 - D5 - A4 - E5 - B4 - E5 - B4 - ' +
        'F5 - C5 - G5 - D5 - A5 - E5 - G#5 - E5 -') }
    },
    fanfare: {
      bpm: 120, vol: 1,
      lead: { wave: 'square', gain: 0.3, len: 0.85, notes: seq(
        'F5 - F5 A5 C6 - A5 - Bb5 - G5 - F5 - - - ' +
        'G5 - G5 Bb5 D6 - Bb5 - C6 - A5 - G5 - - - ' +
        'A5 - C6 - F6 - E6 D6 C6 - Bb5 - A5 - G5 - ' +
        'F5 - A5 - G5 - E5 - F5 - - - C6 - - -') },
      bass: { wave: 'triangle', gain: 0.75, len: 0.8, notes: seq(
        'F2 - C3 - F2 - C3 - Bb2 - F3 - Bb2 - F3 - ' +
        'G2 - D3 - G2 - D3 - C3 - G3 - C3 - G3 - ' +
        'F2 - C3 - D3 - A3 - Bb2 - F3 - C3 - G3 - ' +
        'F2 - C3 - C3 - G3 - F2 - C3 - F2 - - -') },
      arp: { wave: 'sine', gain: 0.18, len: 0.4, notes: seq(
        'F4 A4 C5 A4 F4 A4 C5 A4 F4 Bb4 D5 Bb4 F4 Bb4 D5 Bb4 ' +
        'G4 Bb4 D5 Bb4 G4 Bb4 D5 Bb4 E4 G4 C5 G4 E4 G4 C5 G4 ' +
        'F4 A4 C5 A4 D4 F4 A4 F4 F4 Bb4 D5 Bb4 E4 G4 C5 G4 ' +
        'F4 A4 C5 A4 E4 G4 C5 G4 F4 A4 C5 A4 F4 A4 C5 F5') }
    }
  };
  var STEPS = 64;
  // 보통 단계 음량 0.2(효과음 0.2~0.4보다 작게. 0.05는 노트북 스피커에서 거의 안 들렸다). setVolume 으로 0.5/1/2배
  var MUSIC_VOL = 0.2;
  var FADE = 0.35;

  var ctx = null, master = null, comp = null, enabled = true, track = null, hurry = false;
  var step = 0, nextTime = 0, timer = null, scheduled = 0, unlocked = false, hidden = false;
  var log = [];

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = 0;
    // 크게(2배)에서 음이 겹쳐도 찢어지지 않게 출력 끝에 압축기
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }
  function note(part, midi, t, stepDur, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = part.wave;
    o.frequency.setValueAtTime(hz(midi), t);
    var len = Math.max(0.05, stepDur * part.len);
    var peak = part.gain * vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + len + 0.03);
    scheduled++;
  }
  function stepDur() {
    var T = TRACKS[track];
    var bpm = T.bpm * (track === 'tense' && hurry ? 1.4 : 1);
    return 60 / bpm / 2; // 8분음표
  }
  function schedule() {
    if (!ctx || !track || hidden) return;
    var T = TRACKS[track];
    while (nextTime < ctx.currentTime + 0.25) {
      var d = stepDur();
      ['lead', 'bass', 'arp'].forEach(function (k) {
        var n = T[k].notes[step % STEPS];
        if (n !== null && n !== undefined) note(T[k], n, nextTime, d, T.vol);
      });
      nextTime += d;
      step = (step + 1) % STEPS;
    }
  }
  function fadeTo(v) {
    if (!ctx) return;
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.linearRampToValueAtTime(v, t + FADE);
  }
  function startLoop() {
    if (timer || !ctx) return;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 60);
    schedule();
  }
  function stopLoop() { clearInterval(timer); timer = null; }

  function apply() {
    var want = enabled && unlocked && !hidden && !!track;
    if (!want) {
      if (ctx) fadeTo(0);
      setTimeout(function () { if (!(enabled && unlocked && !hidden && track)) stopLoop(); }, FADE * 1000 + 50);
      return;
    }
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    startLoop();
    fadeTo(MUSIC_VOL);
  }

  /** 곡 바꾸기(같은 곡이면 그대로). 짧게 줄였다가 다시 키운다 */
  function play(name) {
    if (!TRACKS[name] || name === track) return;
    var prev = track;
    log.push({ t: Math.round(performance.now()), track: name, from: prev });
    if (log.length > 50) log.shift();
    if (ctx && timer && prev) {
      fadeTo(0);
      setTimeout(function () { track = name; step = 0; hurry = false; if (ctx) nextTime = ctx.currentTime + 0.05; apply(); }, FADE * 1000);
    } else {
      track = name; step = 0; hurry = false;
      apply();
    }
  }
  function setHurry(on) { hurry = !!on; }
  function setEnabled(on) { enabled = !!on; apply(); }
  /** 음량(마스터 게인 목표값). 0이면 끔 */
  function setVolume(v) {
    v = Math.max(0, Number(v) || 0);
    MUSIC_VOL = v;
    enabled = v > 0;
    apply();
  }

  // 첫 사용자 입력 뒤에만 소리를 낸다(자동재생 정책)
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    apply();
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', function () {
    hidden = document.hidden;
    if (hidden) { if (ctx) { fadeTo(0); stopLoop(); } }
    else apply();
  });

  root.TTMusic = {
    play: play, setHurry: setHurry, setEnabled: setEnabled, setVolume: setVolume,
    state: function () {
      return { ctx: ctx ? ctx.state : 'none', track: track, enabled: enabled, unlocked: unlocked, hidden: hidden, volume: MUSIC_VOL,
        looping: !!timer, hurry: hurry, scheduled: scheduled, gain: master ? +master.gain.value.toFixed(3) : 0, log: log.slice(-8) };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
