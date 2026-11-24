/* 복셀 캐릭터 + 픽셀 텍스처 렌더러 (순수 DOM/CSS 3D, 외부 라이브러리 없음)
   - 원본: joodo-reels exam-rpg Hero.tsx(관절·비율·포즈), textures.ts(얼굴·교복 픽셀), rhythm-univ textures.ts(블록·잔디)
   - 1m = 100px 로 만들고 바깥에서 scale 로 크기를 맞춘다. 좌표는 three.js 와 같게(y 위, +z 가 앞) 적고 CSS 로 바꿀 때 y 를 뒤집는다.
   - 사용: Voxel.create({ team, outfit, size }) → { el, setFace, play, setSize }, Voxel.headIcon(team, outfit, size), Voxel.tex.* */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------- 색
  var SKIN = '#f2c9a0', EYE = '#1e1e2a', SHIRT = '#f6f4ee', PANTS = '#80838c', MOUTH = '#7a2323';
  // 면 밝기(climate-craft): 위 1.0, 좌우 0.86/0.78, 앞 0.74, 뒤 0.8, 아래 0.58
  var LIGHT = { px: 0.86, nx: 0.78, py: 1.0, ny: 0.58, pz: 0.74, nz: 0.8 };
  var FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

  function rgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, k) {
    return '#' + rgb(hex).map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v * k)));
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }
  /** 결정적 난수(0~1) */
  function rnd(a, b, c) {
    var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- 픽셀 텍스처(캐시)
  var texCache = {};
  /** draw(put) 으로 w×h 캔버스에 찍고 CSS url("data:...") 를 돌려준다. k: 밝기 배수(면 밝기) */
  function pixelTex(key, w, h, draw, k) {
    k = k === undefined ? 1 : k;
    var ck = key + '@' + k.toFixed(2);
    if (texCache[ck]) return texCache[ck];
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    draw(function (x, y, c, ww, hh) { ctx.fillStyle = c; ctx.fillRect(x, y, ww || 1, hh || 1); });
    if (k !== 1) {
      ctx.globalCompositeOperation = 'multiply';
      var v = Math.round(255 * k);
      ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      ctx.fillRect(0, 0, w, h);
    }
    // 작은따옴표: HTML style="..." 속성 안에 그대로 넣을 수 있게
    texCache[ck] = "url('" + cv.toDataURL() + "')";
    return texCache[ck];
  }
  function spec(key, w, h, draw) { return { key: key, w: w, h: h, draw: draw }; }

  // ---------------------------------------------------------------- 조별 6명 생김새
  // style: cowlick(삐침머리, 원본 주인공) / glasses(둥근 앞머리+안경, 원본 친구) / cap(모자) / long(긴 머리+리본) / spiky(뾰족 머리) / buns(양쪽 똥머리)
  var LOOKS = [
    { style: 'cowlick', hair: '#5a3a22', hairD: '#432a18' },
    { style: 'glasses', hair: '#b8742e', hairD: '#8a5420' },
    { style: 'cap', hair: '#2a2420', hairD: '#16120f', cap: '#f0f0ea', brim: '#c03a30' },
    { style: 'long', hair: '#24202a', hairD: '#141018', ribbon: '#ff5a8a' },
    { style: 'spiky', hair: '#22222e', hairD: '#101018' },
    { style: 'buns', hair: '#7a4a2a', hairD: '#5a3418' }
  ];
  var DEFAULT_VEST = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#F0E442'];

  /** 얼굴 앞면 16x16: 앞머리(생김새별) + 표정(heroFace / friendFace) */
  function faceSpec(look, kind) {
    var L = LOOKS[look];
    return spec('face-' + look + '-' + kind, 16, 16, function (p) {
      var H = L.hair, HD = L.hairD;
      p(0, 0, SKIN, 16, 16);
      if (L.style === 'glasses') {
        p(0, 0, H, 16, 5); p(0, 5, H, 1, 5); p(15, 5, H, 1, 5); p(0, 0, HD, 16, 1);
      } else if (L.style === 'long') {
        p(0, 0, H, 16, 5); p(0, 5, H, 2, 11); p(14, 5, H, 2, 11); p(0, 0, HD, 16, 1);
      } else if (L.style === 'spiky') {
        p(0, 0, H, 16, 4); p(0, 4, H, 2, 6); p(14, 4, H, 2, 6);
        p(2, 4, H, 1, 2); p(4, 4, H, 2, 1); p(7, 4, H, 1, 2); p(10, 4, H, 2, 1); p(13, 4, H, 1, 2);
        p(0, 0, HD, 16, 1);
      } else if (L.style === 'buns') {
        p(0, 0, H, 16, 4); p(0, 4, H, 2, 6); p(14, 4, H, 2, 6); p(2, 4, H, 4, 1); p(10, 4, H, 4, 1);
        p(7, 0, HD, 2, 4); p(0, 0, HD, 16, 1);
      } else {
        // cowlick, cap: 원본 주인공(heroFace) 앞머리
        p(0, 0, H, 16, 4); p(0, 4, H, 2, 6); p(14, 4, H, 2, 6); p(2, 4, H, 5, 1); p(9, 4, H, 3, 1);
        p(0, 0, HD, 16, 1);
      }
      if (L.style === 'glasses') { friendExpr(p, kind); return; }
      p(2, 10, '#f39a9a', 2, 1); p(12, 10, '#f39a9a', 2, 1);
      heroExpr(p, kind);
    });
  }
  function heroExpr(p, kind) {
    var M = MOUTH;
    switch (kind) {
      case 'happy':
        p(3, 8, EYE); p(4, 7, EYE, 2, 1); p(6, 8, EYE); p(9, 8, EYE); p(10, 7, EYE, 2, 1); p(12, 8, EYE);
        p(5, 11, M, 6, 1); p(6, 12, M, 4, 1); p(7, 12, '#e86a6a', 2, 1);
        break;
      case 'sweat':
        p(3, 6, '#ffffff', 4, 3); p(9, 6, '#ffffff', 4, 3); p(4, 7, EYE); p(11, 7, EYE);
        p(5, 11, M); p(6, 12, M); p(7, 11, M); p(8, 12, M); p(9, 11, M); p(10, 12, M);
        p(13, 5, '#7fd0ff', 2, 3); p(1, 6, '#7fd0ff', 1, 3);
        break;
      case 'sleep':
        p(3, 8, EYE, 3, 1); p(10, 8, EYE, 3, 1); p(7, 12, M, 2, 1);
        break;
      case 'shine':
        p(3, 6, '#ffe14a', 4, 3); p(9, 6, '#ffe14a', 4, 3); p(4, 7, '#ffffff', 2, 1); p(10, 7, '#ffffff', 2, 1);
        p(6, 11, M, 4, 2);
        break;
      default:
        p(4, 7, EYE, 2, 2); p(10, 7, EYE, 2, 2); p(6, 12, M, 4, 1);
    }
  }
  function friendExpr(p, kind) {
    var G = '#1e1e2a', M = MOUTH;
    p(2, 6, G, 5, 1); p(2, 9, G, 5, 1); p(2, 6, G, 1, 4); p(6, 6, G, 1, 4);
    p(9, 6, G, 5, 1); p(9, 9, G, 5, 1); p(9, 6, G, 1, 4); p(13, 6, G, 1, 4); p(7, 7, G, 2, 1);
    if (kind === 'shine') {
      p(3, 7, '#ffffff', 3, 2); p(10, 7, '#ffffff', 3, 2); p(5, 12, M, 6, 1); p(10, 11, M, 1, 1);
    } else if (kind === 'sleep') {
      p(3, 8, EYE, 3, 1); p(10, 8, EYE, 3, 1); p(7, 12, M, 2, 1);
    } else {
      p(4, 7, '#ffffff', 2, 2); p(10, 7, '#ffffff', 2, 2); p(4, 8, EYE, 1, 1); p(11, 8, EYE, 1, 1);
      if (kind === 'happy') { p(5, 11, M, 6, 1); p(6, 12, M, 4, 1); p(7, 12, '#e86a6a', 2, 1); }
      else if (kind === 'sweat') { p(6, 12, M, 4, 1); p(14, 4, '#7fd0ff', 1, 3); }
      else { p(6, 12, M, 4, 1); p(5, 11, M, 1, 1); }
    }
    p(1, 11, '#f39a9a', 1, 1); p(14, 11, '#f39a9a', 1, 1);
  }
  function hairSideSpec(look) {
    var L = LOOKS[look];
    return spec('hair-side-' + look, 16, 16, function (p) {
      p(0, 0, SKIN, 16, 16);
      if (L.style === 'long') { p(0, 0, L.hair, 16, 16); p(0, 0, L.hairD, 16, 1); p(3, 4, L.hairD, 1, 10); return; }
      p(0, 0, L.hair, 16, 10); p(0, 0, L.hairD, 16, 1); p(6, 10, '#e5b48a', 3, 3);
      if (L.style === 'glasses') p(10, 7, '#1e1e2a', 6, 1);
    });
  }
  function hairBackSpec(look) {
    var L = LOOKS[look];
    return spec('hair-back-' + look, 16, 16, function (p) {
      p(0, 0, L.hair, 16, 16); p(0, 0, L.hairD, 16, 1);
      if (L.style !== 'long') p(0, 13, SKIN, 16, 3);
      p(4, 4, L.hairD, 1, 6); p(10, 3, L.hairD, 1, 7); p(7, 1, L.hairD, 2, 2);
    });
  }
  function solidSpec(c) { return spec('solid-' + c, 1, 1, function (p) { p(0, 0, c); }); }

  /** 교복 몸통 앞(heroTorsoFront): 셔츠 깃 + 넥타이 + 조끼(조 색) — 가방이 없어 가방끈은 뺐다 */
  function torsoFrontSpec(vest) {
    var vd = shade(vest, 0.75);
    var tie = /^#(D55E00|CC79A7)$/i.test(vest) ? '#26306a' : '#c8343a';
    return spec('torso-front-' + vest, 16, 16, function (p) {
      p(0, 0, vest, 16, 16); p(5, 0, SHIRT, 6, 3); p(6, 3, SHIRT, 4, 3);
      p(7, 1, tie, 2, 9); p(7, 10, shade(tie, 0.8), 2, 1);
      p(0, 14, PANTS, 16, 2); p(4, 8, vd, 1, 1); p(11, 8, vd, 1, 1);
      p(0, 0, shade(vest, 1.12), 5, 1); p(11, 0, shade(vest, 1.12), 5, 1);
    });
  }
  function torsoBackSpec(vest) {
    return spec('torso-back-' + vest, 16, 16, function (p) {
      p(0, 0, vest, 16, 16); p(5, 0, SHIRT, 6, 1); p(7, 2, shade(vest, 0.75), 2, 10); p(0, 14, PANTS, 16, 2);
    });
  }
  function torsoSideSpec(vest) {
    return spec('torso-side-' + vest, 8, 16, function (p) {
      p(0, 0, vest, 8, 16); p(0, 0, SHIRT, 8, 2); p(0, 14, PANTS, 8, 2);
    });
  }
  var ARM = spec('hero-arm', 8, 16, function (p) { p(0, 0, SHIRT, 8, 12); p(0, 11, '#d8d4c8', 8, 1); p(0, 12, SKIN, 8, 4); });
  var LEG = spec('hero-leg', 8, 16, function (p) {
    p(0, 0, PANTS, 8, 16); p(0, 0, '#6e7179', 8, 1); p(3, 1, '#72757d', 1, 11); p(0, 13, '#22232a', 8, 3); p(0, 13, '#3a3b44', 8, 1);
  });

  // ---------------------------------------------------------------- 상자(6면 div)
  function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }
  /** size, pos: m 단위(three 좌표). faces: [+x, -x, +y, -y, +z, -z] 각각 텍스처 spec 또는 색 문자열 */
  function box(size, pos, faces) {
    var b = div('vx-box');
    b.style.transform = 'translate3d(' + pos[0] * 100 + 'px,' + (-pos[1] * 100) + 'px,' + pos[2] * 100 + 'px)';
    var W = size[0] * 100, H = size[1] * 100, D = size[2] * 100;
    var defs = {
      px: [D, H, 'rotateY(90deg) translateZ(' + W / 2 + 'px)'],
      nx: [D, H, 'rotateY(-90deg) translateZ(' + W / 2 + 'px)'],
      py: [W, D, 'rotateX(90deg) translateZ(' + H / 2 + 'px)'],
      ny: [W, D, 'rotateX(-90deg) translateZ(' + H / 2 + 'px)'],
      pz: [W, H, 'translateZ(' + D / 2 + 'px)'],
      nz: [W, H, 'rotateY(180deg) translateZ(' + D / 2 + 'px)']
    };
    var els = {};
    FACE_ORDER.forEach(function (k, i) {
      var f = div('vx-face'), d = defs[k], s = faces[i];
      // 0.4px 겹쳐 이음매가 벌어지지 않게
      f.style.width = (d[0] + 0.8) + 'px'; f.style.height = (d[1] + 0.8) + 'px';
      f.style.left = (-d[0] / 2 - 0.4) + 'px'; f.style.top = (-d[1] / 2 - 0.4) + 'px';
      f.style.transform = d[2];
      if (typeof s === 'string') f.style.backgroundColor = shade(s, LIGHT[k]);
      else f.style.backgroundImage = pixelTex(s.key, s.w, s.h, s.draw, LIGHT[k]);
      b.appendChild(f);
      els[k] = f;
    });
    b._faces = els;
    return b;
  }
  function group(x, y, z) {
    var g = div('vx-g');
    g._base = 'translate3d(' + x * 100 + 'px,' + (-y * 100) + 'px,' + z * 100 + 'px)';
    g.style.transform = g._base;
    return g;
  }

  // 원본 Hero.tsx 수치
  var HIP_Y = 0.72, SHOULDER_DY = 0.68, SHOULDER_X = 0.37;

  /** 머리 그룹(목 기준, 생김새별 장식 포함). 반환 { g, front } */
  function buildHead(look) {
    var L = LOOKS[look];
    var head = group(0, 0, 0);
    var hair = L.hair;
    var hb = box([0.5, 0.5, 0.5], [0, 0.25, 0],
      [hairSideSpec(look), hairSideSpec(look), hair, SKIN, faceSpec(look, 'normal'), hairBackSpec(look)]);
    head.appendChild(hb);
    var add = function (size, pos, c) { head.appendChild(box(size, pos, [c, c, c, c, c, c])); };
    if (L.style === 'cowlick') add([0.08, 0.12, 0.08], [0.05, 0.55, -0.05], hair);
    else if (L.style === 'glasses') { add([0.52, 0.04, 0.04], [0, 0.27, 0.24], '#1e1e2a'); add([0.56, 0.12, 0.56], [0, 0.5, 0], hair); }
    else if (L.style === 'cap') { add([0.54, 0.14, 0.54], [0, 0.48, 0], L.cap); add([0.5, 0.04, 0.24], [0, 0.42, 0.34], L.brim); add([0.14, 0.08, 0.01], [0, 0.48, 0.272], L.brim); }
    else if (L.style === 'long') { add([0.52, 0.62, 0.1], [0, 0.18, -0.22], hair); add([0.18, 0.1, 0.1], [0.16, 0.5, 0.06], L.ribbon); }
    else if (L.style === 'spiky') { add([0.14, 0.14, 0.14], [-0.15, 0.55, 0.02], hair); add([0.14, 0.18, 0.14], [0.02, 0.57, -0.04], hair); add([0.14, 0.14, 0.14], [0.17, 0.54, 0.06], hair); }
    else if (L.style === 'buns') { add([0.17, 0.17, 0.17], [-0.21, 0.52, -0.08], hair); add([0.17, 0.17, 0.17], [0.21, 0.52, -0.08], hair); }
    return { g: head, front: hb._faces.pz };
  }

  // ---------------------------------------------------------------- 포즈(Hero.tsx)
  // 원본 IDLE 은 오른팔이 연필 검을 앞으로 내민 자세(armR -1.15). 여기서는 깃발을 든 팔로 바꿨다(armR -0.5).
  var IDLE = { armR: -0.5, armRz: -0.12, armL: -0.35, armLz: 0.2, lean: 0.05, bob: 0, headPitch: 0, legSpread: 0.12, legSwing: 0, fall: 0 };
  var PKEYS = Object.keys(IDLE);
  function ext(a, b) { var o = {}; PKEYS.forEach(function (k) { o[k] = (b && k in b) ? b[k] : a[k]; }); return o; }
  function mix(a, b, t) { var o = {}; PKEYS.forEach(function (k) { o[k] = a[k] + (b[k] - a[k]) * t; }); return o; }
  /** keys(d, [[x,y]...]) 선형 보간(양 끝 고정) */
  function keys(d, pts) {
    if (d <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (d <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]); }
    }
    return pts[pts.length - 1][1];
  }
  var reduceMotion = false;
  try { reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 무시 */ }

  /** mode 의 목표 포즈. f: 모드 시작 후 프레임(30fps), fa: 전체 프레임 */
  function poseFor(mode, f, fa, flag) {
    var p;
    if (mode === 'cheer') {
      var jump = reduceMotion ? 0 : Math.abs(Math.sin((f / 15) * Math.PI)) * 0.28;
      // 깃발을 든 오른팔은 머리 위까지 다 올리지 않는다(깃대가 화면 위로 넘치지 않게)
      p = ext(IDLE, { armR: flag ? -2.3 : -2.9, armRz: flag ? -0.2 : -0.35, armL: -2.9, armLz: 0.35, lean: -0.05, bob: jump, headPitch: -0.15, legSpread: 0.18 });
    } else if (mode === 'flinch') {
      var t = reduceMotion ? 0.75 : keys(f, [[0, 0], [3, 1], [20, 0.75]]);
      p = mix(IDLE, ext(IDLE, { armR: -1.9, armRz: -0.7, armL: -1.9, armLz: 0.7, lean: -0.4, headPitch: -0.35, bob: 0.06 }), t);
    } else if (mode === 'walk') {
      var s = reduceMotion ? 0 : Math.sin(f * 0.35) * 0.5;
      p = ext(IDLE, { legSwing: s, armR: -0.2 - s * 0.6, armRz: -0.1, armL: -0.2 + s * 0.6, armLz: 0.1, lean: 0.08 });
    } else if (mode === 'point') {
      p = ext(IDLE, { armR: -1.6, armRz: -0.1, lean: 0.2 });
    } else {
      p = ext(IDLE);
    }
    if (mode !== 'cheer' && !reduceMotion) p.bob += Math.sin(fa * 0.18) * 0.015; // breathe
    return p;
  }

  // three 의 x·z 회전은 y 를 뒤집은 CSS 에서 부호가 바뀐다(y 회전은 그대로)
  function rad(v) { return v.toFixed(4) + 'rad'; }
  function applyPose(c, p) {
    var n = c.nodes;
    n.root.style.transform = 'translate3d(0,' + (-p.bob * 100).toFixed(2) + 'px,0) rotateX(' + rad(-p.fall) + ')';
    n.legR.style.transform = n.legR._base + ' rotateX(' + rad(-p.legSwing) + ') rotateZ(' + rad(p.legSpread) + ')';
    n.legL.style.transform = n.legL._base + ' rotateX(' + rad(p.legSwing) + ') rotateZ(' + rad(-p.legSpread) + ')';
    n.body.style.transform = n.body._base + ' rotateX(' + rad(-p.lean) + ')';
    n.head.style.transform = n.head._base + ' rotateX(' + rad(-p.headPitch) + ')';
    n.armR.style.transform = n.armR._base + ' rotateX(' + rad(-p.armR) + ') rotateZ(' + rad(-p.armRz) + ')';
    n.armL.style.transform = n.armL._base + ' rotateX(' + rad(-p.armL) + ') rotateZ(' + rad(-p.armLz) + ')';
    if (n.flag) {
      // 깃대는 몸통·팔 회전을 되돌려 늘 곧게 선다: (Rx(-(lean+armR)) Rz(-armRz))^-1 = Rz(armRz) Rx(lean+armR)
      n.flag.style.transform = 'translate3d(0,60px,0) rotateZ(' + rad(p.armRz) + ') rotateX(' + rad(p.lean + p.armR) + ')';
      n.cloth.style.transform = 'translate3d(0,-55px,0) rotateY(' + rad(c.wave || 0) + ')';
    }
  }

  /** 깃발(깃대 + 깃발 천). 손 위치에 붙는 그룹. 천은 깃대 기준으로 펄럭인다 */
  function flagCloth(color) {
    return spec('flag-cloth-' + color, 16, 10, function (p) {
      p(0, 0, color, 16, 10);
      p(0, 0, shade(color, 1.18), 16, 1);
      p(0, 9, shade(color, 0.7), 16, 1);
      p(15, 0, shade(color, 0.7), 1, 10);
      p(5, 3, '#ffffff', 5, 4);
      p(6, 4, color, 3, 2);
    });
  }
  function buildFlag(color) {
    var fg = group(0, 0, 0);
    var pole = '#6b4423';
    fg.appendChild(box([0.06, 0.95, 0.06], [0, 0.25, 0], [pole, pole, pole, pole, pole, pole]));
    fg.appendChild(box([0.11, 0.11, 0.11], [0, 0.76, 0], ['#f0c020', '#f0c020', '#f0c020', '#f0c020', '#f0c020', '#f0c020']));
    var cloth = div('vx-g');
    var cs = flagCloth(color);
    cloth.appendChild(box([0.5, 0.3, 0.03], [-0.28, 0, 0], [color, color, shade(color, 1.1), shade(color, 0.8), cs, cs]));
    fg.appendChild(cloth);
    return { g: fg, cloth: cloth };
  }

  // ---------------------------------------------------------------- 캐릭터
  var UNITS = 285; // 장면 높이(1m=100): 머리 위 만세 + 점프 + 깃대까지 들어가게
  var live = [];

  function create(opts) {
    opts = opts || {};
    var team = opts.team || 0;
    var look = opts.look === undefined ? team % LOOKS.length : opts.look;
    var vest = opts.outfit || DEFAULT_VEST[team % DEFAULT_VEST.length];
    var wrap = div('vx');
    var scene = div('vx-scene');
    var cam = div('vx-cam');
    wrap.appendChild(scene); scene.appendChild(cam);

    var rootG = div('vx-g');
    cam.appendChild(rootG);
    var legFaces = [LEG, LEG, PANTS, '#22232a', LEG, LEG];
    var legR = group(-0.13, HIP_Y, 0), legL = group(0.13, HIP_Y, 0);
    legR.appendChild(box([0.25, HIP_Y, 0.27], [0, -HIP_Y / 2, 0], legFaces));
    legL.appendChild(box([0.25, HIP_Y, 0.27], [0, -HIP_Y / 2, 0], legFaces));
    var body = group(0, HIP_Y, 0);
    body.appendChild(box([0.52, 0.72, 0.3], [0, 0.36, 0],
      [torsoSideSpec(vest), torsoSideSpec(vest), vest, vest, torsoFrontSpec(vest), torsoBackSpec(vest)]));
    var hd = buildHead(look);
    hd.g._base = 'translate3d(0,-72px,0)';
    var armFaces = [ARM, ARM, SHIRT, SKIN, ARM, ARM];
    var armR = group(-SHOULDER_X, SHOULDER_DY, 0), armL = group(SHOULDER_X, SHOULDER_DY, 0);
    armR.appendChild(box([0.22, 0.7, 0.24], [0, -0.31, 0], armFaces));
    armL.appendChild(box([0.22, 0.7, 0.24], [0, -0.31, 0], armFaces));
    body.appendChild(hd.g); body.appendChild(armR); body.appendChild(armL);
    rootG.appendChild(legR); rootG.appendChild(legL); rootG.appendChild(body);
    var hasFlag = opts.flag !== false;
    var fl = hasFlag ? buildFlag(vest) : null;
    if (fl) armR.appendChild(fl.g);

    var c = {
      el: wrap, team: team, look: look, flag: hasFlag,
      nodes: { root: rootG, legR: legR, legL: legL, body: body, head: hd.g, armR: armR, armL: armL, flag: fl && fl.g, cloth: fl && fl.cloth },
      front: hd.front, mode: 'idle', face: 'normal', t0: now(), snap: ext(IDLE), cur: ext(IDLE), dirty: true, wave: 0
    };
    c.setFace = function (kind) {
      if (c.face === kind) return c;
      c.face = kind;
      c.front.style.backgroundImage = pixelTex(faceSpec(look, kind).key, 16, 16, faceSpec(look, kind).draw, LIGHT.pz);
      return c;
    };
    c.play = function (mode) { c.snap = c.cur; c.mode = mode || 'idle'; c.t0 = now(); c.dirty = true; return c; };
    c.setSize = function (px) {
      px = Math.max(40, Math.round(px));
      wrap.style.width = Math.round(px * 0.62) + 'px';
      wrap.style.height = px + 'px';
      wrap.style.perspective = Math.round(px * 5) + 'px';
      scene.style.transform = 'scale(' + (px / UNITS).toFixed(4) + ')';
      return c;
    };
    c.destroy = function () {
      var i = live.indexOf(c); if (i !== -1) live.splice(i, 1);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
    c.setSize(opts.size || 200);
    applyPose(c, c.cur);
    live.push(c);
    startLoop();
    return c;
  }

  /** 점수판·문제 창용 머리 블록 아이콘(움직이지 않음) */
  function headIcon(team, outfit, px, face) {
    var look = team % LOOKS.length;
    var wrap = div('vx vx-icon');
    px = px || 40;
    wrap.style.width = px + 'px'; wrap.style.height = px + 'px';
    wrap.style.perspective = (px * 8) + 'px';
    var scene = div('vx-scene vx-scene-icon');
    scene.style.transform = 'scale(' + (px / 82).toFixed(4) + ')';
    var cam = div('vx-cam vx-cam-icon');
    var hd = buildHead(look);
    hd.g.style.transform = 'translate3d(0,25px,0)';
    if (face && face !== 'normal') hd.front.style.backgroundImage = pixelTex(faceSpec(look, face).key, 16, 16, faceSpec(look, face).draw, LIGHT.pz);
    cam.appendChild(hd.g); scene.appendChild(cam); wrap.appendChild(scene);
    return wrap;
  }

  // ---------------------------------------------------------------- 애니메이션 루프
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  var looping = false;
  function startLoop() {
    if (looping || !root.requestAnimationFrame) return;
    looping = true;
    root.requestAnimationFrame(tick);
  }
  function tick(t) {
    var fa = t / 1000 * 30;
    for (var i = 0; i < live.length; i++) {
      var c = live[i];
      if (!c.el.isConnected || c.el.offsetParent === null) continue; // 화면에 없는 캐릭터는 쉬게
      if (reduceMotion && !c.dirty) continue;
      var f = (t - c.t0) / 1000 * 30;
      var target = poseFor(c.mode, f, fa, c.flag);
      var w = reduceMotion ? 1 : Math.min(1, f / 6);
      c.cur = mix(c.snap, target, w);
      c.wave = reduceMotion ? 0 : Math.sin(fa * 0.22 + c.team) * 0.35;
      applyPose(c, c.cur);
      c.dirty = false;
    }
    root.requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- 블록·아이콘 텍스처(보드, UI)
  function noise(p, w, h, seed, colors, weights) {
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var r = rnd(seed, x, y), acc = 0;
      for (var i = 0; i < colors.length; i++) { acc += weights[i]; if (r < acc) { p(x, y, colors[i]); break; } }
    }
  }
  var DIRT = ['#8b5a35', '#7a4c2c', '#9c6a40', '#6e4426'];
  var tex = {
    /** 잔디 윗면: 4px 체크무늬(grassTex 색) + 점 */
    grassTop: function (v) {
      return pixelTex('grass-top-' + v, 16, 16, function (p) {
        p(0, 0, '#98d957', 16, 16);
        for (var y = 0; y < 16; y += 4) for (var x = 0; x < 16; x += 4) if (((x + y) / 4) % 2) p(x, y, '#86c94a', 4, 4);
        for (var i = 0; i < 10; i++) p(Math.floor(rnd(v, i, 1) * 16), Math.floor(rnd(v, i, 2) * 16), i % 2 ? '#a8e467' : '#76b63e');
      });
    },
    grassSide: function (v) {
      return pixelTex('grass-side-' + v, 16, 16, function (p) {
        noise(p, 16, 16, 30 + v, DIRT, [0.5, 0.25, 0.2, 0.05]);
        p(0, 0, '#86c94a', 16, 3);
        for (var x = 0; x < 16; x++) if (rnd(v, x, 9) < 0.45) p(x, 3, '#76b63e', 1, rnd(v, x, 8) < 0.5 ? 1 : 2);
      }, 0.74);
    },
    sandTop: function (v) { return pixelTex('sand-top-' + v, 16, 16, function (p) { noise(p, 16, 16, 50 + v, ['#e9d9a4', '#dccb92', '#f2e4b6', '#cfbc84'], [0.5, 0.25, 0.18, 0.07]); }); },
    sandSide: function (v) { return pixelTex('sand-side-' + v, 16, 16, function (p) { noise(p, 16, 16, 60 + v, ['#e0cf98', '#d2c088', '#ead9a8'], [0.55, 0.3, 0.15]); }, 0.74); },
    stoneTop: function (v) { return pixelTex('stone-top-' + v, 16, 16, function (p) { noise(p, 16, 16, 70 + v, ['#8f9196', '#7c7e83', '#a2a4a8', '#6e7075'], [0.45, 0.25, 0.2, 0.1]); }); },
    stoneSide: function (v) { return pixelTex('stone-side-' + v, 16, 16, function (p) { noise(p, 16, 16, 80 + v, ['#8f9196', '#7c7e83', '#a2a4a8', '#6e7075'], [0.45, 0.25, 0.2, 0.1]); }, 0.74); },
    snowTop: function (v) { return pixelTex('snow-top-' + v, 16, 16, function (p) { noise(p, 16, 16, 90 + v, ['#f4f8fc', '#e2eaf2', '#ffffff', '#d4dee8'], [0.5, 0.25, 0.18, 0.07]); }); },
    snowSide: function (v) {
      return pixelTex('snow-side-' + v, 16, 16, function (p) {
        noise(p, 16, 16, 100 + v, DIRT, [0.5, 0.25, 0.2, 0.05]);
        p(0, 0, '#f4f8fc', 16, 3);
        for (var x = 0; x < 16; x++) if (rnd(v, x, 7) < 0.4) p(x, 3, '#e2eaf2', 1, 1);
      }, 0.74);
    },
    /** 양털 블록(조 색) */
    wool: function (c, side) {
      return pixelTex('wool-' + c, 16, 16, function (p) {
        p(0, 0, c, 16, 16);
        for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
          var r = rnd(7, x, y);
          if (r < 0.16) p(x, y, shade(c, 0.88));
          else if (r < 0.28) p(x, y, shade(c, 1.1));
        }
        for (var i = 0; i < 6; i++) { var yy = 2 + i * 2 + (i % 2); p((i * 5) % 13, yy, shade(c, 0.82), 3, 1); }
      }, side ? 0.74 : 1);
    },
    /** 돌 벽돌(blockTex 색) — 요새 성벽 */
    stoneBrick: function () {
      return pixelTex('stone-brick', 16, 8, function (p) {
        p(0, 0, '#a9abb0', 16, 8);
        p(0, 3, '#6e7075', 16, 1); p(0, 7, '#6e7075', 16, 1);
        p(7, 0, '#6e7075', 1, 3); p(3, 4, '#6e7075', 1, 3); p(11, 4, '#6e7075', 1, 3);
        p(0, 0, '#c2c4c8', 7, 1); p(8, 0, '#c2c4c8', 8, 1); p(0, 4, '#c2c4c8', 3, 1); p(4, 4, '#c2c4c8', 7, 1); p(12, 4, '#c2c4c8', 4, 1);
        p(2, 1, '#8b8d93', 3, 1); p(10, 5, '#8b8d93', 3, 1);
      });
    },
    /** 성벽 톱니(위 테두리) */
    battlement: function () {
      return pixelTex('battlement', 16, 6, function (p) {
        p(0, 2, '#a9abb0', 16, 4); p(0, 5, '#6e7075', 16, 1);
        p(0, 0, '#a9abb0', 4, 2); p(8, 0, '#a9abb0', 4, 2);
        p(0, 0, '#c2c4c8', 4, 1); p(8, 0, '#c2c4c8', 4, 1); p(4, 2, '#c2c4c8', 4, 1); p(12, 2, '#c2c4c8', 4, 1);
      });
    },
    /** 돌 버튼 바탕 */
    stoneButton: function () { return pixelTex('stone-btn', 16, 16, function (p) { noise(p, 16, 16, 5, ['#8b8b8b', '#7d7d7d', '#999999', '#727272'], [0.5, 0.22, 0.2, 0.08]); }); },
    dirtBlock: function () { return pixelTex('dirt-block', 16, 16, function (p) { noise(p, 16, 16, 11, DIRT, [0.5, 0.25, 0.2, 0.05]); }); },
    cloud: function (v) {
      return pixelTex('cloud-' + v, 24, 8, function (p) {
        var W = '#ffffff', S = '#e6eef8';
        if (v % 2) { p(2, 3, W, 20, 3); p(5, 1, W, 8, 2); p(12, 2, W, 7, 1); p(2, 6, S, 20, 1); }
        else { p(0, 3, W, 24, 3); p(4, 1, W, 6, 2); p(10, 0, W, 8, 3); p(17, 2, W, 4, 1); p(0, 6, S, 24, 1); }
      });
    },
    /** 아이콘 16x16 (투명 바탕) */
    icon: function (name) { return ICONS[name] ? pixelTex('icon-' + name, 16, 16, ICONS[name]) : 'none'; },
    /** 점령 칸 깃발(조 색) 12x16 */
    flag: function (c) {
      return pixelTex('board-flag-' + c, 12, 16, function (p) {
        // 같은 색 양털 위에서도 보이게: 남색 테두리 + 흰 안쪽 테두리 + 조 색 천
        p(1, 1, '#3a2614', 2, 15); p(1, 1, '#8a5a2a', 1, 15);
        p(0, 0, '#f0c020', 4, 2);
        p(3, 2, '#1b1f4a', 9, 9);
        p(3, 3, '#ffffff', 8, 7);
        p(4, 4, c, 6, 5); p(4, 4, shade(c, 1.2), 6, 1); p(4, 8, shade(c, 0.72), 6, 1);
        p(0, 14, '#1b1f4a', 4, 2);
      });
    },
    /** 스틸권 번개(남음: 노랑 / 사용: 회색) */
    bolt: function (on) {
      var C = on ? '#ffe14a' : '#5a5e78', D = on ? '#c88a10' : '#3a3d52';
      return pixelTex('bolt-' + on, 12, 16, function (p) {
        p(5, 0, D, 6, 1); p(4, 1, C, 6, 2); p(3, 3, C, 5, 2); p(2, 5, C, 4, 2);
        p(2, 7, C, 8, 2); p(5, 9, C, 4, 2); p(4, 11, C, 3, 2); p(3, 13, C, 2, 2); p(2, 15, D, 2, 1);
        p(4, 1, '#ffffff', 1, 2);
      });
    }
  };

  var ICONS = {
    sword: function (p) {
      for (var i = 0; i < 9; i++) { p(13 - i, 1 + i, '#c6d0dc'); p(14 - i, 1 + i, '#eef3f8'); p(14 - i, 2 + i, '#7d8898'); }
      p(3, 9, '#6b4423', 2, 2); p(6, 12, '#6b4423', 2, 2); p(4, 10, '#8a5a2a', 3, 3);
      p(3, 12, '#4a2e16', 2, 2); p(1, 14, '#e8b830', 2, 2);
    },
    castle: function (p) {
      var S = '#a9abb0', D = '#6e7075', L = '#c2c4c8';
      p(1, 5, S, 4, 10); p(11, 5, S, 4, 10); p(4, 8, S, 8, 7);
      p(1, 4, S, 1, 1); p(3, 4, S, 1, 1); p(11, 4, S, 1, 1); p(13, 4, S, 1, 1);
      p(1, 5, L, 4, 1); p(11, 5, L, 4, 1); p(4, 8, L, 8, 1);
      p(7, 11, '#3a2a1a', 2, 4); p(2, 8, D, 1, 2); p(13, 8, D, 1, 2);
      p(7, 1, '#444444', 1, 7); p(8, 1, '#e83a3a', 3, 2);
      p(1, 15, D, 14, 1);
    },
    again: function (p) {
      var C = '#4ad0ff', D = '#1a7ab0';
      p(3, 3, C, 8, 2); p(2, 4, C, 2, 4); p(10, 1, C, 1, 6); p(11, 2, C, 1, 4); p(12, 3, C, 1, 2);
      p(5, 11, C, 8, 2); p(12, 8, C, 2, 4); p(5, 9, C, 1, 6); p(4, 10, C, 1, 4); p(3, 11, C, 1, 2);
      p(3, 5, D, 8, 1); p(5, 13, D, 8, 1);
    },
    bonus: function (p) {
      p(2, 7, '#e83a3a', 12, 8); p(1, 5, '#ff5a5a', 14, 3); p(1, 7, '#b02a2a', 14, 1);
      p(7, 5, '#ffe14a', 2, 10); p(4, 2, '#ffe14a', 3, 3); p(9, 2, '#ffe14a', 3, 3); p(5, 3, '#e8b830', 1, 1); p(10, 3, '#e8b830', 1, 1);
      p(2, 14, '#b02a2a', 12, 1);
    },
    quake: function (p) {
      p(6, 6, '#ffe14a', 4, 4);
      p(7, 1, '#ff9f2e', 2, 5); p(7, 10, '#ff9f2e', 2, 5); p(1, 7, '#ff9f2e', 5, 2); p(10, 7, '#ff9f2e', 5, 2);
      p(3, 3, '#ff4a3d', 2, 2); p(11, 3, '#ff4a3d', 2, 2); p(3, 11, '#ff4a3d', 2, 2); p(11, 11, '#ff4a3d', 2, 2);
      p(5, 5, '#ff9f2e', 1, 1); p(10, 5, '#ff9f2e', 1, 1); p(5, 10, '#ff9f2e', 1, 1); p(10, 10, '#ff9f2e', 1, 1);
      p(7, 7, '#ffffff', 2, 2);
    },
    heart: function (p) {
      var R = '#ff4a3d', D = '#b02a2a';
      p(2, 3, R, 4, 2); p(10, 3, R, 4, 2); p(1, 5, R, 14, 4); p(2, 9, R, 12, 2); p(4, 11, R, 8, 2); p(6, 13, R, 4, 1); p(7, 14, R, 2, 1);
      p(3, 4, '#ffffff', 2, 2); p(1, 8, D, 1, 1); p(14, 8, D, 1, 1);
    },
    star: function (p) {
      var Y = '#ffe14a', D = '#c89a1a';
      p(7, 1, Y, 2, 4); p(1, 5, Y, 14, 3); p(3, 8, Y, 10, 2); p(4, 10, Y, 3, 3); p(9, 10, Y, 3, 3); p(3, 13, Y, 2, 2); p(11, 13, Y, 2, 2);
      p(1, 7, D, 2, 1); p(13, 7, D, 2, 1);
    },
    trophy: function (p) {
      var Y = '#ffe14a', D = '#c89a1a';
      p(3, 1, Y, 10, 7); p(1, 2, Y, 2, 3); p(13, 2, Y, 2, 3); p(5, 8, Y, 6, 2); p(7, 10, D, 2, 2); p(4, 12, Y, 8, 3);
      p(4, 2, '#fff6c0', 2, 4); p(4, 14, D, 8, 1);
    }
  };

  /** 외곽선 text-shadow(rhythm-univ theme.ts outline 그대로) */
  function outline(r, color) {
    color = color || '#1b1f4a';
    var parts = [], steps = r >= 6 ? 16 : 8;
    for (var i = 0; i < steps; i++) {
      var a = (i / steps) * Math.PI * 2;
      parts.push((Math.cos(a) * r).toFixed(1) + 'px ' + (Math.sin(a) * r).toFixed(1) + 'px 0 ' + color);
    }
    parts.push('0 ' + Math.round(r * 1.6) + 'px 0 ' + color);
    return parts.join(', ');
  }

  root.Voxel = {
    create: create, headIcon: headIcon, tex: tex, pixelTex: pixelTex, shade: shade, outline: outline,
    LOOKS: LOOKS, reduceMotion: reduceMotion
  };
})(typeof window !== 'undefined' ? window : globalThis);
