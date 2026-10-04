'use strict';
/* =====================================================================
 * 마왕성의 마지막 포탑 — 엔진
 * 코어 리듬: 자동 전투 → 3택1(2~3초) → 즉시 화면 변화 → 보상 → 다시 자동 전투
 * 데이터(키워드·특성·웨이브·카드·해금)는 js/data.js 에 있다.
 * ===================================================================== */
const DPR = Math.min(2, window.devicePixelRatio || 1); // 고해상도 대응(성능 위해 최대 2배)
const $ = id => document.getElementById(id), cv = $('field'), ctx = cv.getContext('2d');
const W = 540, H = 960;
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickN = (a, n) => shuffle([...a]).slice(0, n);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------- 에셋 ---------------- */
const IMG_FILES = {
  bg: 'img/bg.png', impact: 'img/impact.png', cannon: 'img/cannon.png',
  turret_base: 'img/turret_base.png', turret_barrel: 'img/turret_barrel.png', turret_flash: 'img/turret_flash.png',
  anim_skeleton: 'img/anim_skeleton.png', anim_goblin: 'img/anim_goblin.png', anim_demon: 'img/anim_demon.png',
  anim_lich: 'img/anim_lich.png', anim_orc: 'img/anim_orc.png', anim_vampire: 'img/anim_vampire.png',
  anim_enemies: 'img/anim_enemies.png', anim_projectiles: 'img/anim_projectiles.png',
};
for (const k of ['plus','trough','red','purple','green','inset','shield','multi','axe','spirit','blast','fire','frost','crit',
  'damage','reload','repair','bat','recruiticon']) IMG_FILES['ui_' + k] = 'ui/' + k + '.webp';

let assets = {}, animSheets = {}, impactFx, enemyWhite, enemySteel;
let mode = 'loading', s = null, t = 0, last = 0, toastTime = 0, audioOn = false, audioCtx;

function imageLoad(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(src)); i.src = src; }); }
function whiteOf(img, color = '#fff') { const q = document.createElement('canvas'); q.width = img.width; q.height = img.height; const z = q.getContext('2d'); z.drawImage(img, 0, 0); z.globalCompositeOperation = 'source-in'; z.fillStyle = color; z.fillRect(0, 0, q.width, q.height); q._fx = img._fx; return q; }
// impact 이미지의 사각 테두리를 원형으로 페이드하고, 뚫린 중심부를 코드로 채움
function cleanImpact(img) {
  const q = document.createElement('canvas'), w = q.width = img.width, h = q.height = img.height, z = q.getContext('2d'), cx = w * .51, cy = h * .24;
  z.drawImage(img, 0, 0); z.globalCompositeOperation = 'destination-in';
  let g = z.createRadialGradient(cx, cy, w * .3, cx, cy, w * .55); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); z.fillStyle = g; z.fillRect(0, 0, w, h);
  z.globalCompositeOperation = 'destination-out';
  for (const [x0, y0, x1, y1] of [[0, 0, 0, h * .2], [0, h, 0, h * .8], [0, 0, w * .2, 0], [w, 0, w * .8, 0]]) { const e = z.createLinearGradient(x0, y0, x1, y1); e.addColorStop(0, '#000'); e.addColorStop(1, 'rgba(0,0,0,0)'); z.fillStyle = e; z.fillRect(0, 0, w, h); }
  z.globalCompositeOperation = 'source-over'; g = z.createRadialGradient(cx, cy, 0, cx, cy, w * .16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(250,225,255,.95)'); g.addColorStop(1, 'rgba(220,140,255,0)'); z.fillStyle = g; z.fillRect(0, 0, w, h);
  return q;
}

/* ---------------- 스프라이트 ---------------- */
function frameSprite(img, n) { const hero = img.width === 2688, cols = hero ? 7 : 4, cell = hero ? 384 : 256; return { img, x: (n % cols) * cell, y: Math.floor(n / cols) * cell, w: cell, h: cell }; }
function anchoredFrame(c, img, n, x, y, size, dx = 0) { const f = frameSprite(img, n), anchor = f.w === 384 ? 354 : 236, o = ((img && img._fx && img._fx[n]) || 0) + dx; c.drawImage(img, f.x, f.y, f.w, f.h, x - size / 2 + o * size / f.w, y - size * anchor / f.h, size, size); }
// 프레임별 좌우 보정값(셀 픽셀)
const FRAME_FX = { vampire: { 1: -38, 3: -37, 5: -36, 7: -40, 8: -40, 9: -40, 10: -40, 11: -40, 12: -40 }, orc: { 3: -23, 5: -21, 11: -42, 12: -38 }, enemies: { 7: -52 } };
function drawPortraitAt(c, i, x, y, w) { anchoredFrame(c, animSheets[HEROES[i].key], 0, x, y, w * 1.6); }
function drawPortrait(c, i, w = 150) { c.clearRect(0, 0, w, w); drawPortraitAt(c, i, w / 2, w, w); }
function drawUI(c, key, x, y, w, h) { const im = assets['ui_' + key]; if (im) c.drawImage(im, x, y, w, h); }
function drawUIFrame(c, key, x, y, w, h, b = 8) {
  const im = assets['ui_' + key]; if (!im) return; const cut = Math.min(40, Math.floor(Math.min(im.width, im.height) / 3)); b = Math.min(b, w / 2, h / 2);
  const sx = [0, cut, im.width - cut], sy = [0, cut, im.height - cut], sw = [cut, im.width - cut * 2, cut], sh = [cut, im.height - cut * 2, cut], dx = [x, x + b, x + w - b], dy = [y, y + b, y + h - b], dw = [b, w - b * 2, b], dh = [b, h - b * 2, b];
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) if (dw[q] > 0 && dh[r] > 0) c.drawImage(im, sx[q], sy[r], sw[q], sh[r], dx[q], dy[r], dw[q], dh[r]);
}
function drawUIGauge(c, x, y, w, h, ratio, color) { drawUI(c, 'trough', x, y, w, h); c.save(); c.beginPath(); c.rect(x, y, w * clamp(ratio, 0, 1), h); c.clip(); drawUI(c, color, x, y, w, h); c.restore(); }
function drawUIIcon(c, key, w = 150, scale = .76) { const im = assets['ui_' + key]; c.clearRect(0, 0, w, w); if (!im) return; const k = w * scale / Math.max(im.width, im.height), iw = im.width * k, ih = im.height * k; c.drawImage(im, (w - iw) / 2, (w - ih) / 2, iw, ih); }

/* ---------------- 포탑 ---------------- */
const TURRET = { x: 270, y: 773, muzzle: 120, limit: Math.PI / 3 };
const SPREAD_GAP = 12, SPREAD_ANGLE = .09, SPREAD_TIME = .16; // 탄 간격(px), 탄당 최종 벌어짐(rad), 벌어지는 시간(초)
const heading = (dx, dy) => Math.atan2(dy, dx) + Math.PI / 2;
const clampAim = a => clamp(a, -TURRET.limit, TURRET.limit);
function recoilAt(remaining) { const u = (.32 - remaining) / .32; return remaining > 0 ? 9 * (u < .2 ? Math.sin(u / .2 * Math.PI / 2) : Math.pow((1 - u) / .8, 2)) : 0; }
function muzzleAt(a, recoil = 0) { const d = TURRET.muzzle - recoil; return { x: TURRET.x + Math.sin(a) * d, y: TURRET.y - Math.cos(a) * d }; }
function drawTurret(c, x, y, angle, remaining, scale = 1, power = 0) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  const base = assets.turret_base; c.drawImage(base, -96, -38, 192, 192 * base.height / base.width);
  const recoil = recoilAt(remaining); c.save(); c.rotate(angle); c.translate(0, recoil);
  c.drawImage(assets.turret_barrel, -36.85, -123.28, 73.7, 153.765);
  // 수정 맥동: 포신 강화 단계가 오를수록 더 크고 밝게 (선택 결과가 바로 보이게)
  c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .10 + .08 * Math.sin(t * 5) + power * .07; c.fillStyle = '#c36bff'; c.beginPath(); c.arc(0, 0, 11 + power * 4, 0, Math.PI * 2); c.fill(); c.restore();
  if (remaining > 0) { const n = Math.min(3, Math.floor((.32 - remaining) / .08)); c.drawImage(assets.turret_flash, n * 256, 0, 256, 256, -46, -TURRET.muzzle - 86.25, 92, 92); }
  c.restore(); c.restore();
}

function tone(f = 300, d = .05, type = 'sine', vol = .035) {
  if (!audioOn) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(f * .55, audioCtx.currentTime + d);
    g.gain.setValueAtTime(vol, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + d);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + d);
  } catch { }
}

/* ---------------- 메타 성장 (localStorage) ---------------- */
const META_KEY = 'newdefense.meta.v1';
let meta = { bank: 0, owned: {}, prep: { starter: -1, cond: 'base' }, best: 0, wins: 0 };
function loadMeta() { try { const m = JSON.parse(localStorage.getItem(META_KEY)); if (m) meta = { ...meta, ...m, owned: { ...m.owned }, prep: { ...meta.prep, ...m.prep } }; } catch { } }
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { } }

/* ---------------- 공격원(포탑 0, 영웅 1~6)과 키워드 ---------------- */
const blankKw = () => Object.fromEntries(KW_ORDER.map(k => [k, 0]));
const isEvo = (S, k) => S.kw[k] >= EVO_STACK;
const srcName = si => si ? HEROES[si - 1].name : '포탑';
const owners = () => s.src.map((S, i) => S.lv ? i : -1).filter(i => i >= 0);
const unlockedKws = () => KW_ORDER.filter(k => !KEYWORDS[k].locked || meta.owned[k]);
function srcPos(si) { if (!si) return { x: TURRET.x, y: TURRET.y - 20 }; const d = HEROES[si - 1]; return { x: d.x, y: d.y - 40 }; }
function dmgOf(si) { const S = s.src[si]; return si ? HEROES[si - 1].damage * (1 + (S.lv - 1) * .42) : TUNING.turretDamage * Math.pow(1.3, s.power); }
function critChance(si) { return (si ? 0 : .05) + .12 * s.src[si].kw.crit; }
const critMul = S => isEvo(S, 'crit') ? 3 : 2;
const blastRadius = S => 40 + 15 * (S.kw.blast - 1);
const shotCount = S => 1 + S.kw.multi + (isEvo(S, 'multi') ? 2 : 0);

function addKw(si, k, amt = 1, quiet = false) {
  const S = s.src[si], before = S.kw[k]; S.kw[k] = Math.min(MAX_STACK, before + amt);
  const p = srcPos(si), K = KEYWORDS[k];
  burst(p.x, p.y, K.color, 18); s.fx.push({ ring: true, x: p.x, y: p.y, r: 70, life: .45, max: .45, color: K.color });
  if (before < EVO_STACK && S.kw[k] >= EVO_STACK) {
    s.fx.push({ ring: true, x: p.x, y: p.y, r: 140, life: .7, max: .7, color: '#ffffff' }); burst(p.x, p.y, K.color, 40); s.shake = 4;
    if (!quiet) toast(`✦ ${srcName(si)} · ${K.name} 진화!\n${K.evo.replace('진화 · ', '')}`, 2.4); tone(880, .3, 'triangle', .05);
  } else if (!quiet) toast(`${srcName(si)} · ${K.name} ★${S.kw[k]}`, 1.3);
}
function recruit(i, quiet = false) {
  const S = s.src[i + 1], d = HEROES[i]; S.lv = 1; S.cd = .2; S.kw[d.innate] = Math.max(1, S.kw[d.innate]);
  burst(d.x, d.y - 25, d.color, 25); if (!quiet) toast(`${d.name} 합류 · 고유 키워드 ${KEYWORDS[d.innate].name}`);
}

/* ---------------- 런 시작 ---------------- */
function newRun() {
  const cond = meta.prep.cond === 'lone' && meta.owned.lone ? 'lone' : meta.prep.cond === 'cursed' && meta.owned.cursed ? 'cursed' : 'base';
  s = {
    wave: 0, level: 1, xp: 0, need: 22, souls: 0, hp: TUNING.castleHp, maxHp: TUNING.castleHp, kills: 0, time: 0,
    rate: 1, power: 0, src: [{ lv: 1, kw: blankKw() }, ...HEROES.map(() => ({ lv: 0, kw: blankKw(), cd: 0, anim: 0 }))],
    enemies: [], shots: [], fx: [], texts: [], strikes: [], delayed: [], queue: [], spawnCd: 0, nextWave: 1.4,
    cannon: 0, aim: 0, queued: null, autoCd: 1.2, shake: 0, hitstop: 0, id: 0, region: 0, regionFlash: 0,
    curses: {}, soulMul: cond === 'cursed' ? 1.5 : 1, enemySpeedMul: 1, noHeal: false, rerolls: 0, rarePending: 0,
    skillCd: 2, lone: cond === 'lone', cursedMode: cond === 'cursed', cond, cardKind: null, offer: null, traitsKey: '',
  };
  // 런마다 웨이브 특성 조합이 다르게 섞인다 → 매 판 판을 새로 읽어야 한다
  s.waves = WAVES.map(w => ({ ...w, traits: pickN(w.pool || TRAIT_ORDER, w.traits || 0), extraElites: [] }));
  if (s.lone) { s.src[0].kw.multi = 2; s.src[0].kw.blast = 1; }
  else if (meta.owned.starter && meta.prep.starter >= 0) recruit(meta.prep.starter, true);
  mode = 'play';
  for (const id of ['start', 'result', 'pauseOverlay', 'cardsOverlay', 'eliteOverlay', 'metaOverlay']) $(id).classList.add('hidden');
  toast(s.lone ? '외로운 포대 · 마왕성을 지켜라' : s.cursedMode ? '저주받은 성 · 마왕성을 지켜라' : '마왕성을 지켜라', 2);
  updateHud();
}

/* ---------------- 웨이브 ---------------- */
function waveTraits(w) { return [...w.traits]; }
function startWave() {
  s.wave++;
  if (s.wave > WAVES.length) { finish(true); return; }
  const w = s.waves[s.wave - 1], specs = [];
  for (let i = 0; i < w.n; i++) specs.push({ trait: w.traits.length && Math.random() < .7 ? pick(w.traits) : null });
  const elites = [...w.extraElites]; for (let i = 0; i < (w.elite || 0); i++) elites.push(w.traits.length ? w.traits : [pick(TRAIT_ORDER)]);
  elites.forEach((tr, i) => specs.splice(Math.floor(specs.length * (i + 1) / (elites.length + 1)), 0, { elite: true, traits: tr }));
  s.queue = specs; s.spawnCd = .3;
  let msg = `웨이브 ${s.wave}`;
  if (w.region != null && w.region !== s.region) { s.region = w.region; s.regionFlash = 1; msg = `지역 변화 · ${REGIONS[s.region].name}\n` + msg; }
  if (w.boss) { spawnEnemy({ boss: true }); msg += ' · 최후의 침입자 버섯왕'; }
  else if (w.mini) { spawnEnemy({ mini: true }); msg += ' · 미니보스 강철 버섯'; }
  if (w.traits.length) msg += '\n' + w.traits.map(k => TRAITS[k].name).join(' · ');
  if (elites.length) msg += ' · 엘리트';
  toast(msg, 2.2); tone(220, .2, 'triangle', .04);
}
function waveCleared() {
  const w = s.waves[s.wave - 1];
  if (s.wave >= WAVES.length) { finish(true); return; }
  if (!s.noHeal) s.hp = Math.min(s.maxHp, s.hp + TUNING.waveHeal);
  if (w.offerElite === true || (w.offerElite === 'hunter' && meta.owned.hunter)) { showElite(); return; }
  s.nextWave = 2.4; previewToast();
}
function previewToast() {
  const n = s.waves[s.wave]; if (!n) return;
  const parts = waveTraits(n).map(k => TRAITS[k].name); if (n.boss) parts.unshift('보스'); if (n.mini) parts.unshift('미니보스');
  if (n.elite || n.extraElites.length) parts.push('엘리트');
  toast(`방어 성공${s.noHeal ? '' : ` · 성 +${TUNING.waveHeal}`}\n다음: ${parts.length ? parts.join(' · ') : '일반 침입'}`, 2);
}

function spawnEnemy(spec) {
  const type = spec.boss || spec.mini ? 2 : Math.floor(Math.random() * 3);
  const traits = {}; for (const k of spec.traits || (spec.trait ? [spec.trait] : [])) traits[k] = true;
  const T = TUNING, scale = Math.pow(1 + T.hpGrowth, s.wave);
  let hp = (T.hpBase + s.wave * T.hpWave + (type === 2 ? 16 : 0)) * scale, speed = (type === 1 ? 35 : 23) + s.wave * .9, size = type === 0 ? 77 : 70, count = 1;
  if (spec.boss) { hp = T.bossHp; speed = 12; size = 152; }
  if (spec.mini) { hp = T.miniHp; speed = 15; size = 118; traits.armored = true; }
  if (spec.elite) { hp *= 5; size *= 1.3; speed *= .8; }
  if (traits.swarm && !spec.elite && !spec.boss && !spec.mini) { hp *= .45; size *= .68; count = 3; }
  if (traits.fast) speed *= 1.75;
  if (traits.armored) speed *= .85;
  speed *= s.enemySpeedMul;
  const cx = spec.boss || spec.mini ? 270 : 140 + Math.random() * 260, lane = spec.boss || spec.mini ? 0 : Math.random() * 2 - 1;
  for (let i = 0; i < count; i++) {
    const hpv = Math.round(hp);
    s.enemies.push({
      id: ++s.id, type, boss: !!spec.boss, mini: !!spec.mini, elite: !!spec.elite, traits, size, x: cx + (i - (count - 1) / 2) * 22,
      y: (spec.boss ? 140 : 150 - Math.random() * 25) - i * 14, lane: clamp(lane + (i - (count - 1) / 2) * .18, -1, 1),
      hp: hpv, max: hpv, speed, hit: 0, slow: 0, burn: 0, burnDps: 0, atk: 0, phase: Math.random() * 6, shield: traits.shielded ? 1 : 0,
    });
  }
}

/* ---------------- 조준 ---------------- */
function laneX(e, y) { const lw = 130 - 100 * clamp((y - 150) / 470, 0, 1); return 270 + (e.lane || 0) * lw; }
function bodyY(e) { return e.y - e.size * (e.boss ? .35 : .3); }
function hitRadius(e) { return e.boss ? 42 : 22 * e.size / 72; }
function predictPos(e, tt) { if (e.y >= 620) return { x: e.x, y: e.y }; const vy = e.speed * (e.slow > 0 ? TUNING.slowFactor : 1), y = Math.min(620, e.y + vy * tt), lx = (laneX(e, e.y) + laneX(e, y)) / 2; return { x: lx + (e.x - lx) * Math.exp(-1.5 * tt), y }; }
function leadPoint(e, ox, oy, start, speed) { const off = e.y - bodyY(e); let q = { x: e.x, y: e.y }; for (let i = 0; i < 4; i++) { const tt = Math.max(0, Math.hypot(q.x - ox, q.y - off - oy) - start) / speed; q = predictPos(e, tt); } return { x: q.x, y: q.y - off }; }
function aimAt(e) { const q = leadPoint(e, TURRET.x, TURRET.y, TURRET.muzzle, TUNING.shellSpeed); return clampAim(heading(q.x - TURRET.x, q.y - TURRET.y)); }
const doomed = e => e.hp - (e.pend || 0) <= 0;
const live = () => s.enemies.filter(e => e.hp > 0 && !doomed(e));
function urgent() { let b = null; for (const e of live()) if (!b || e.y > b.y) b = e; return b; }
function reserve(p, e) { p.target = e; p.res = p.damage * (p.crit ? 2 : 1); e.pend = (e.pend || 0) + p.res; }
function release(p) { if (p.res && p.target) p.target.pend = Math.max(0, (p.target.pend || 0) - p.res); p.res = 0; }

/* ---------------- 공격: 투사체 생성 ---------------- */
function makeShot(si, x, y, angle, speed, opts = {}) {
  const S = s.src[si], { hit, mul, ...rest } = opts;
  const p = {
    si, row: si ? HEROES[si - 1].row : 0, x, y, angle, speed, age: 0, trail: [], damage: dmgOf(si) * (mul || 1),
    crit: Math.random() < critChance(si), hit: new Set(hit || []), pierce: opts.child ? 0 : (isEvo(S, 'pierce') ? Infinity : S.kw.pierce),
    chainLeft: opts.chainLeft ?? S.kw.chain, straight: !opts.homing, homing: !!opts.homing, child: !!opts.child, ...rest,
  };
  if (s.shots.length < 280) s.shots.push(p);
  return p;
}
// 다중 키워드: 포구에서 나란히 나온 뒤 부채꼴로 벌어짐 (포탑·영웅 공통)
function volley(si, ox, oy, target, aim) {
  const S = s.src[si], n = Math.min(9, shotCount(S)), speed = si ? HEROES[si - 1].speed : TUNING.shellSpeed;
  if (aim == null) { const q = leadPoint(target, ox, oy, 0, speed); aim = heading(q.x - ox, q.y - oy); }
  const px = Math.cos(aim), py = Math.sin(aim), gap = si ? 9 : SPREAD_GAP; let main = 0;
  for (let j = 0; j < n; j++) if (Math.abs(j - (n - 1) / 2) < Math.abs(main - (n - 1) / 2)) main = j;
  for (let j = 0; j < n; j++) {
    const k = j - (n - 1) / 2, rank = n % 2 ? Math.abs(k) : Math.abs(k) - .5;
    const p = makeShot(si, ox + px * k * gap, oy + py * k * gap, aim, speed, { spreadBase: aim, spread: Math.sign(k) * rank * SPREAD_ANGLE });
    if (j === main) reserve(p, target);
  }
}
function heroFire(i) {
  const e = urgent(); if (!e) return; const d = HEROES[i];
  volley(i + 1, d.x + (i < 3 ? 27 : -27), d.y - d.mouth, e);
}

/* ---------------- 공격: 명중 처리 (규칙은 여기 한 곳에만) ---------------- */
function onHit(p, e) {
  release(p); p.hit.add(e.id);
  const S = s.src[p.si], dmg = p.damage * (p.crit ? critMul(S) : 1), by = bodyY(e);
  s.fx.push({ impact: true, x: e.x, y: by, life: .17, max: .17 });
  dealHit(e, dmg, p.crit, S);
  if (S.kw.blast) explode(e.x, by, blastRadius(S), dmg * .6, p.crit, S, e, false);
  if (p.chainLeft > 0) chainFrom(e, p, dmg);
  burst(e.x, by, KEYWORDS[S.kw.fire ? 'fire' : S.kw.frost ? 'frost' : 'multi'].color, 4);
  if (p.pierce > 0) { p.pierce--; p.damage *= .8; return false; }
  return true;
}
function dealHit(e, dmg, crit, S) {
  if (e.hp <= 0) return;
  e.hit = .1;
  if (e.shield > 0) { // 보호막: 첫 타격 무효
    e.shield = 0; s.fx.push({ ring: true, x: e.x, y: bodyY(e), r: e.size * .55, life: .3, max: .3, color: TRAITS.shielded.color });
    if (s.texts.length < 45) s.texts.push({ x: e.x, y: bodyY(e) - 18, v: '막음', life: .6, color: TRAITS.shielded.color });
    tone(900, .05, 'square', .015); return;
  }
  const armored = e.traits.armored && !crit; if (armored) dmg *= .5; // 장갑: 치명타가 아닌 피해 절반
  e.hp -= dmg;
  if (S.kw.fire) { e.burn = 2.5; e.burnDps = Math.max(e.burnDps, dmg * .3 * S.kw.fire); e.burnEvo ||= isEvo(S, 'fire'); }
  if (S.kw.frost) { e.slow = Math.max(e.slow, 1.2 + .4 * S.kw.frost); e.frostEvo ||= isEvo(S, 'frost'); }
  if (crit) { s.hitstop = Math.max(s.hitstop, .035); s.shake = Math.max(s.shake, 1.4); }
  if (s.texts.length < 45) s.texts.push({ x: e.x + (Math.random() - .5) * 20, y: bodyY(e) - 16, v: Math.round(dmg), life: .7, crit, color: armored ? '#b9c3cf' : null });
  if (e.hp <= 0) kill(e);
}
function explode(x, y, r, dmg, crit, S, exclude, second) {
  for (const o of s.enemies) if (o !== exclude && o.hp > 0 && Math.hypot(o.x - x, bodyY(o) - y) < r + hitRadius(o) * .5) dealHit(o, dmg, crit, S);
  s.fx.push({ ring: true, x, y, r, life: .32, max: .32, color: KEYWORDS.blast.color }); burst(x, y, '#f3c775', 7); s.shake = Math.max(s.shake, 1.6);
  if (!second && isEvo(S, 'blast')) s.delayed.push({ t: .25, fn: () => explode(x, y, r * 1.2, dmg * .7, crit, S, null, true) });
}
function chainFrom(e, p, dmg) {
  const S = s.src[p.si], range = isEvo(S, 'chain') ? 220 : 150, branches = isEvo(S, 'chain') ? 2 : 1, by = bodyY(e);
  const cand = s.enemies.filter(o => o.hp > 0 && !p.hit.has(o.id) && Math.hypot(o.x - e.x, bodyY(o) - by) < range)
    .sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y)).slice(0, branches);
  for (const o of cand) {
    const c = makeShot(p.si, e.x, by, heading(o.x - e.x, bodyY(o) - by), 720, { homing: true, child: true, target: o, chainLeft: p.chainLeft - 1, hit: [...p.hit], scale: .75 });
    c.damage = dmg * .7 / (c.crit ? critMul(S) : 1);
    s.fx.push({ line: true, x: e.x, y: by, x2: o.x, y2: bodyY(o), life: .18, max: .18, color: KEYWORDS.chain.color });
  }
}
function kill(e) {
  e.hp = 0; s.kills++;
  const soul = e.boss ? 100 : e.mini ? 40 : e.elite ? 25 : e.traits.swarm ? 2 : 5;
  s.souls += Math.max(1, Math.round(soul * s.soulMul));
  s.xp += e.boss ? 40 : e.mini ? 30 : e.elite ? 25 : e.traits.swarm ? 3 : 8;
  burst(e.x, e.y, e.boss || e.elite ? '#f3ca83' : '#d8b0f4', e.boss ? 40 : e.elite ? 24 : 9);
  // 진화한 속성은 죽을 때 한 단계 더 퍼진다
  if (e.burn > 0 && e.burnEvo) spreadStatus(e, o => { o.burn = 2.5; o.burnDps = Math.max(o.burnDps, e.burnDps); o.burnEvo = true; }, KEYWORDS.fire.color);
  if (e.slow > 0 && e.frostEvo) spreadStatus(e, o => { o.slow = Math.max(o.slow, 2); o.frostEvo = true; }, KEYWORDS.frost.color);
  if (e.elite || e.mini) { s.rarePending++; toast(`${e.mini ? '미니보스' : '엘리트'} 격파 · 희귀 카드 획득!`, 1.6); tone(620, .25, 'triangle', .05); }
  if (e.boss) { s.bossKilled = true; s.shake = 6; s.hitstop = .12; tone(500, .4, 'triangle'); }
}
function spreadStatus(e, apply, color) {
  for (const o of s.enemies) if (o !== e && o.hp > 0 && Math.hypot(o.x - e.x, o.y - e.y) < 85) apply(o);
  s.fx.push({ ring: true, x: e.x, y: bodyY(e), r: 85, life: .35, max: .35, color });
}

/* ---------------- 집중 포격 (탭 스킬) ---------------- */
// 포탑의 공격이므로 포탑 키워드(다중·폭발·화염·냉기·치명)가 그대로 적용된다
function trySkill(x, y) {
  if (mode !== 'play') return;
  if (s.skillCd > 0) { tone(120, .05, 'square', .015); return; }
  const S = s.src[0], n = 1 + Math.min(4, S.kw.multi);
  s.skillCd = skillMax();
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, r = j ? 40 + Math.random() * 30 : 0;
    s.strikes.push({ x: x + Math.cos(a) * r, y: clamp(y + Math.sin(a) * r, 150, 700), t: TUNING.skillDelay + j * .12, max: TUNING.skillDelay + j * .12 });
  }
  tone(320, .2, 'sawtooth', .03);
}
const skillMax = () => Math.max(2, TUNING.skillCd - (s.skillCdBonus || 0));
function landStrike(k) {
  const S = s.src[0], r = TUNING.skillRadius + 15 * S.kw.blast, crit = Math.random() < critChance(0);
  const dmg = dmgOf(0) * TUNING.skillMul * (crit ? critMul(S) : 1);
  for (const o of s.enemies) if (o.hp > 0 && Math.hypot(o.x - k.x, bodyY(o) - k.y) < r + hitRadius(o) * .5) dealHit(o, dmg, crit, S);
  s.fx.push({ impact: true, x: k.x, y: k.y, life: .3, max: .3, big: true }, { ring: true, x: k.x, y: k.y, r, life: .4, max: .4, color: '#e9a6ff' });
  burst(k.x, k.y, '#e9a6ff', 22); s.shake = Math.max(s.shake, 4); tone(90, .25, 'sawtooth', .05);
  if (isEvo(S, 'blast')) s.delayed.push({ t: .25, fn: () => explode(k.x, k.y, r * 1.2, dmg * .5, crit, S, null, true) });
}

/* ---------------- 업데이트 ---------------- */
function updateTurret(dt) {
  s.autoCd -= dt;
  if (!s.queued && s.autoCd <= 0) { const e = urgent(); if (e) s.queued = { target: e }; }
  let target = s.queued?.target; if (!target || target.hp <= 0) { target = urgent(); if (s.queued) s.queued.target = target; }
  const desired = target ? aimAt(target) : 0, diff = desired - s.aim;
  s.aim = clampAim(s.aim + clamp(diff * (1 - Math.exp(-dt * 18)), -dt * 4, dt * 4)); // 유한 회전 속도의 지수 보간
  if (!s.queued) return; if (!target) { s.queued = null; return; }
  if (Math.abs(desired - s.aim) > .018) return;
  s.queued = null; s.autoCd = TUNING.turretInterval / s.rate; s.cannon = .32;
  const o = muzzleAt(s.aim); volley(0, o.x, o.y, target, s.aim);
  burst(o.x, o.y, '#ce88ff', 5); tone(140, .065, 'triangle', .045);
}
function updateShots(dt) {
  for (const p of s.shots) {
    if (p.dead) continue; p.age += dt;
    p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > (p.pierce > 0 ? 14 : 7)) p.trail.shift();
    if (p.homing) { // 연쇄 탄: 대상에게 유도
      if (!p.target || p.target.hp <= 0) {
        const n = s.enemies.filter(e => e.hp > 0 && !p.hit.has(e.id) && Math.hypot(e.x - p.x, bodyY(e) - p.y) < 170).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (n) p.target = n; else { p.dead = true; continue; }
      }
      const tx = p.target.x, ty = bodyY(p.target), dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
      if (dist < p.speed * dt + 10) { onHit(p, p.target); p.dead = true; }
      else { p.x += dx / dist * p.speed * dt; p.y += dy / dist * p.speed * dt; p.angle = heading(dx, dy); }
      if (p.age > 2) p.dead = true;
      continue;
    }
    if (p.spread && p.age < SPREAD_TIME + dt) { const u = Math.min(1, p.age / SPREAD_TIME); p.angle = p.spreadBase + p.spread * u * u * (3 - 2 * u); }
    const ox = p.x, oy = p.y; p.x += Math.sin(p.angle) * p.speed * dt; p.y -= Math.cos(p.angle) * p.speed * dt;
    const vx = p.x - ox, vy = p.y - oy, vv = vx * vx + vy * vy || 1;
    // 직선 탄: 이동 구간과 몸통의 최근접 거리로 판정 → 관통이면 계속 비행
    let guard = 0;
    while (!p.dead && guard++ < 12) {
      let best = null, bq = 2;
      for (const e of s.enemies) {
        if (e.hp <= 0 || p.hit.has(e.id)) continue; const by = bodyY(e), q = clamp(((e.x - ox) * vx + (by - oy) * vy) / vv, 0, 1);
        if (q < bq && Math.hypot(ox + q * vx - e.x, oy + q * vy - by) < hitRadius(e)) { best = e; bq = q; }
      }
      if (!best) break;
      if (onHit(p, best)) p.dead = true;
    }
    if (p.age > 3 || p.x < -20 || p.x > 560 || p.y < 60 || p.y > 830) p.dead = true;
  }
  for (const p of s.shots) if (p.dead) release(p);
  s.shots = s.shots.filter(p => !p.dead);
}
function updateEnemies(dt) {
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    e.hit = Math.max(0, e.hit - dt); e.slow = Math.max(0, e.slow - dt);
    if (e.burn > 0) { e.burn -= dt; e.hp -= e.burnDps * dt * (e.traits.armored ? .5 : 1); if (e.hp <= 0) { kill(e); continue; } }
    if (e.y < 620) {
      e.y += e.speed * dt * (e.slow > 0 ? TUNING.slowFactor : 1);
      e.x += (laneX(e, e.y) - e.x) * Math.min(1, dt * 1.5);
    } else {
      e.atk -= dt;
      if (e.atk <= 0) {
        s.hp -= e.boss ? 28 : e.mini ? 40 : e.elite ? 30 : e.traits.swarm ? 6 : 12; e.atk = e.boss ? 1.4 : 1; s.shake = 5;
        burst(270, 810, '#ee8b82', 10); tone(70, .12, 'sawtooth', .025);
        if (!e.boss) e.hp = 0;
      }
    }
  }
  s.enemies = s.enemies.filter(e => e.hp > 0);
}
function update(dt) {
  if (mode !== 'play') return;
  if (s.hitstop > 0) { s.hitstop -= dt; return; }
  s.time += dt; s.cannon = Math.max(0, s.cannon - dt); s.shake = Math.max(0, s.shake - dt * 12);
  s.skillCd = Math.max(0, s.skillCd - dt); s.regionFlash = Math.max(0, s.regionFlash - dt);
  updateTurret(dt);
  // 웨이브 진행
  if (s.nextWave > 0) { s.nextWave -= dt; if (s.nextWave <= 0) { startWave(); if (mode !== 'play') return; } }
  else if (s.queue.length) { s.spawnCd -= dt; if (s.spawnCd <= 0) { spawnEnemy(s.queue.shift()); s.spawnCd = Math.max(.5, TUNING.spawnGap - s.wave * .035); } }
  // 영웅: 공격 애니메이션의 4번째 프레임에서 발사
  for (let i = 0; i < HEROES.length; i++) {
    const S = s.src[i + 1], d = HEROES[i]; if (!S.lv) continue;
    const before = S.anim, fireAt = .6 - .6 * 4 / 7; S.anim = Math.max(0, S.anim - dt); S.cd -= dt;
    if (before > fireAt && S.anim <= fireAt) heroFire(i);
    if (S.cd <= 0 && S.anim <= 0 && urgent()) { S.cd = Math.max(.62, d.rate / (1 + (S.lv - 1) * .11)); S.anim = .6; }
  }
  for (const k of s.strikes) { k.t -= dt; if (k.t <= 0) { k.done = true; landStrike(k); } }
  s.strikes = s.strikes.filter(k => !k.done);
  for (const q of s.delayed) { q.t -= dt; if (q.t <= 0) { q.done = true; q.fn(); } }
  s.delayed = s.delayed.filter(q => !q.done);
  updateEnemies(dt);
  updateShots(dt);
  for (const f of s.fx) { f.life -= dt; if (f.vx != null) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 60 * dt; } }
  s.fx = s.fx.filter(f => f.life > 0); if (s.fx.length > 450) s.fx.splice(0, s.fx.length - 450);
  for (const z of s.texts) { z.life -= dt; z.y -= 28 * dt; } s.texts = s.texts.filter(z => z.life > 0);
  if (s.hp <= 0) { s.hp = 0; finish(false); return; }
  if (s.wave > 0 && !s.queue.length && !s.enemies.length && s.nextWave <= 0 && !s.strikes.length) waveCleared();
  if (mode === 'play') {
    if (s.xp >= s.need) showCards('level');
    else if (s.rarePending > 0) { s.rarePending--; showCards('rare'); }
  }
  updateHud();
}
function burst(x, y, color, n = 9) { if (!s) return; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 35 + Math.random() * 120; s.fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .25 + Math.random() * .3, max: .6, color, size: 1 + Math.random() * 3 }); } }
function toast(msg, d = 1.7) { $('toast').textContent = msg; toastTime = d; $('toast').style.opacity = 1; }

/* ---------------- 카드 ---------------- */
function starStr(n) { return '★'.repeat(Math.min(n, MAX_STACK)) + '☆'.repeat(Math.max(0, EVO_STACK - n)); }
function kwCard(si, k, amt = 1, rare = false) {
  const S = s.src[si], cur = S.kw[k], nxt = Math.min(MAX_STACK, cur + amt), K = KEYWORDS[k];
  const lines = [cur === 0 ? K.first : K.next];
  if (amt > 1) lines.push(`한 번에 ★+${amt}`);
  return {
    key: `kw${si}${k}`, kind: 'kw', si, k, rare, icon: K.icon, title: `${K.name}`,
    tag: rare ? `엘리트 보상 · ${srcName(si)}` : cur > 0 ? `${srcName(si)} · ★강화` : srcName(si),
    stars: starStr(nxt), evo: cur < EVO_STACK && nxt >= EVO_STACK ? K.evo : '', desc: lines.join('\n'),
    apply: () => addKw(si, k, amt),
  };
}
function randomKwCard(amt = 1, rare = false) {
  const si = pick(owners()), S = s.src[si], pool = unlockedKws().filter(k => S.kw[k] < MAX_STACK);
  if (!pool.length) return null;
  const have = pool.filter(k => S.kw[k] > 0);
  // 절반은 이미 가진 키워드(빌드 강화), 절반은 새 방향 → "강화할까, 피벗할까"
  return kwCard(si, have.length && Math.random() < .5 ? pick(have) : pick(pool), amt, rare);
}
function recruitCard(i) { const d = HEROES[i]; return { key: 'rec' + i, kind: 'recruit', i, title: d.name, tag: '영웅 영입', desc: `${d.sub}\n고유 키워드 · ${KEYWORDS[d.innate].name}`, apply: () => recruit(i) }; }
function levelCard(si) {
  const S = s.src[si], d = HEROES[si - 1];
  return { key: 'lv' + si, kind: 'level', i: si - 1, title: d.name, tag: '영웅 단련', desc: `Lv. ${S.lv} → ${S.lv + 1}\n공격력·속도 증가${S.lv + 1 === 3 || S.lv + 1 === 5 ? '\n오라 각성' : '\n몸집이 커짐'}`, apply: () => { S.lv++; burst(d.x, d.y - 30, d.color, 22); s.fx.push({ ring: true, x: d.x, y: d.y - 30, r: 60, life: .4, max: .4, color: d.color }); } };
}
const powerCard = () => ({ key: 'power', kind: 'power', icon: 'damage', title: '포신 강화', tag: '포탑', desc: `포탄 공격력 +30%\n${Math.round(dmgOf(0))} → ${Math.round(dmgOf(0) * 1.3)} · 포탄이 커짐`, apply: () => { s.power++; burst(TURRET.x, TURRET.y - 40, '#c36bff', 20); } });
const rateCard = () => ({ key: 'rate', kind: 'rate', icon: 'reload', title: '신속 장전', tag: '포탑', desc: '포탑 연사 +20%\n집중 포격 재충전 -0.5초', apply: () => { s.rate *= 1.2; s.skillCdBonus = (s.skillCdBonus || 0) + .5; } });
const repairCard = () => ({ key: 'repair', kind: 'repair', icon: 'repair', title: '성벽 재건', tag: '방어', desc: '최대 내구도 +60\n내구도 100 회복', apply: () => { s.maxHp += 60; s.hp = Math.min(s.maxHp, s.hp + 100); } });
function curseCard(c) {
  return { key: 'curse' + c.id, kind: 'curse', icon: 'bat', title: c.title, tag: '저주 · 큰 대가', desc: c.good, bad: c.bad, apply: () => applyCurse(c) };
}
function applyCurse(c) {
  s.curses[c.id] = true; s.shake = 5; tone(110, .4, 'sawtooth', .05);
  if (c.id === 'blood') { addKw(0, 'multi', 2, true); s.maxHp = Math.max(60, s.maxHp - 80); s.hp = Math.min(s.hp, s.maxHp); }
  if (c.id === 'frenzy') { s.rate *= 1.6; s.enemySpeedMul *= 1.15; for (const e of s.enemies) e.speed *= 1.15; }
  if (c.id === 'pawn') { for (const si of owners()) addKw(si, 'crit', 1, true); s.soulMul *= .5; }
  if (c.id === 'pyre') { for (const si of owners()) addKw(si, 'fire', 1, true); s.noHeal = true; }
  toast(`저주 · ${c.title}\n${c.bad}`, 2.2);
}
function buildOffer(kind) {
  const cards = [], used = new Set(), add = c => { if (c && !used.has(c.key) && cards.length < 3) { used.add(c.key); cards.push(c); } };
  if (kind === 'rare') { let g = 0; while (cards.length < 3 && g++ < 40) add(randomKwCard(2, true)); return cards; }
  const left = HEROES.map((_, i) => i).filter(i => !s.src[i + 1].lv), heroes = owners().filter(i => i > 0);
  if (left.length && !s.lone && (heroes.length === 0 || Math.random() < .5)) add(recruitCard(pick(left)));
  if (s.level >= 3 && Math.random() < (s.cursedMode ? .4 : .14)) { const c = CURSES.filter(c => !s.curses[c.id]); if (c.length) add(curseCard(pick(c))); }
  if (s.hp < s.maxHp * .55 && Math.random() < .5) add(repairCard());
  let g = 0;
  while (cards.length < 3 && g++ < 60) {
    const r = Math.random();
    if (r < .68) add(randomKwCard());
    else if (r < .84 && heroes.length) add(levelCard(pick(heroes)));
    else add(Math.random() < .55 ? powerCard() : rateCard());
  }
  return shuffle(cards);
}
function rerollCost() { return TUNING.rerollBase + TUNING.rerollStep * s.rerolls; }
function waveInfo() {
  const between = !s.queue.length && !s.enemies.length, idx = between ? s.wave : s.wave - 1, w = s.waves[idx];
  if (!w) return null;
  const parts = waveTraits(w).map(k => `<span class="chip"><i style="background:${TRAITS[k].color}"></i>${TRAITS[k].name} · ${TRAITS[k].rule}</span>`);
  if (w.boss) parts.unshift('<span class="chip">보스</span>'); if (w.mini) parts.unshift('<span class="chip">미니보스 · 장갑</span>');
  if (w.elite || w.extraElites.length) parts.push('<span class="chip">엘리트</span>');
  return `${between ? '다음' : '현재'} 웨이브 ${idx + 1}: ${parts.length ? parts.join('') : '<span class="chip">일반</span>'}`;
}
function showCards(kind) {
  if (kind === 'level') { s.xp -= s.need; s.level++; s.need = 22 + (s.level - 1) * 7; }
  s.cardKind = kind; s.offer = buildOffer(kind); mode = 'cards';
  $('cardsEyebrow').textContent = kind === 'rare' ? 'RARE REWARD' : 'CHOOSE YOUR POWER';
  $('cardsTitle').textContent = kind === 'rare' ? '엘리트의 마력' : '마력이 깨어납니다';
  $('cardsSub').textContent = kind === 'rare' ? '키워드 ★2를 한 번에 얻습니다.' : '이번 런을 이끌 힘을 하나 선택하세요.';
  $('nextWave').innerHTML = waveInfo() || '';
  renderCards(); $('cardsOverlay').classList.remove('hidden'); updateHud();
}
function renderCards() {
  $('cards').innerHTML = '';
  for (const a of s.offer) {
    const b = document.createElement('button');
    b.className = 'card ' + (a.kind === 'recruit' ? 'recruit' : a.rare ? 'rare' : a.kind === 'curse' ? 'curse' : '');
    b.innerHTML = `<span class="tag">${a.tag}</span><canvas width="150" height="150"></canvas><strong>${a.title}</strong>${a.stars ? `<em class="stars">${a.stars}</em>` : ''}<p>${a.desc.replaceAll('\n', '<br>')}${a.evo ? `<span class="evo">${a.evo}</span>` : ''}${a.bad ? `<span class="bad">대가 · ${a.bad}</span>` : ''}</p><span class="choose">선택하기</span>`;
    const c = b.querySelector('canvas').getContext('2d');
    if (a.icon) {
      drawUIIcon(c, a.icon, 150, a.kind === 'kw' ? .62 : .76);
      if (a.kind === 'kw') { if (a.si) drawPortraitAt(c, a.si - 1, 122, 150, 46); else drawTurret(c, 124, 132, 0, 0, .19); }
    } else if (a.i !== undefined) drawPortrait(c, a.i);
    b.onclick = () => {
      if (mode !== 'cards') return;
      $('cardsOverlay').classList.add('hidden'); mode = 'play'; a.apply(); tone(660, .15, 'sine', .05); updateHud();
    };
    $('cards').append(b);
  }
  const cost = rerollCost(); $('reroll').textContent = `다시 뽑기 · 소울 ${cost}`; $('reroll').disabled = s.souls < cost;
}
function reroll() {
  if (mode !== 'cards') return; const cost = rerollCost(); if (s.souls < cost) return;
  s.souls -= cost; s.rerolls++; s.offer = buildOffer(s.cardKind); renderCards(); tone(500, .08); updateHud();
}

/* ---------------- 엘리트 도전 (위험 감수 선택) ---------------- */
function showElite() {
  mode = 'elite'; s.eliteOffer = pickN(TRAIT_ORDER, 2);
  $('eliteDesc').innerHTML = `다음 웨이브에 엘리트 1체가 추가됩니다.<br>쓰러뜨리면 <b>희귀 카드(키워드 ★2)</b>와 소울을 얻습니다.`;
  $('eliteTraits').innerHTML = s.eliteOffer.map(k => `<span class="chip"><i style="background:${TRAITS[k].color}"></i>${TRAITS[k].name} · ${TRAITS[k].rule}</span>`).join('');
  $('eliteOverlay').classList.remove('hidden');
}
function answerElite(yes) {
  if (mode !== 'elite') return;
  if (yes) { s.waves[s.wave].extraElites.push(s.eliteOffer); tone(300, .3, 'sawtooth', .04); }
  $('eliteOverlay').classList.add('hidden'); mode = 'play'; s.nextWave = 2.4; previewToast();
}

/* ---------------- HUD · 결과 · 보관소 ---------------- */
function setGauge(id, ratio) { $(id).style.clipPath = `inset(0 ${(1 - clamp(ratio, 0, 1)) * 100}% 0 0)`; }
function updateHud() {
  if (!s) return;
  $('wave').textContent = Math.max(1, s.wave); $('souls').textContent = s.souls; $('level').textContent = `Lv. ${s.level}`;
  $('xpText').textContent = `${Math.floor(s.xp)} / ${s.need}`; setGauge('xpFill', s.xp / s.need); setGauge('hpFill', s.hp / s.maxHp);
  $('hpText').textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
  const b = s.enemies.find(e => e.boss) || s.enemies.find(e => e.mini); $('bossHud').classList.toggle('hidden', !b);
  if (b) { $('bossName').textContent = b.boss ? '침식된 버섯왕' : '강철 버섯 · 장갑'; setGauge('bossFill', b.hp / b.max); }
  const w = s.waves[Math.max(0, s.wave - 1)], key = s.wave + '|' + s.region;
  if (key !== s.traitsKey) {
    s.traitsKey = key;
    $('traits').innerHTML = (s.wave ? `<span class="chip region">${REGIONS[s.region].name}</span>` : '') +
      (s.wave ? waveTraits(w).map(k => `<span class="chip"><i style="background:${TRAITS[k].color}"></i>${TRAITS[k].name}</span>`).join('') : '');
  }
}
function buildHtml() {
  return owners().map(si => {
    const S = s.src[si], chips = KW_ORDER.filter(k => S.kw[k]).map(k => `<span class="chip"><i style="background:${KEYWORDS[k].color}"></i>${KEYWORDS[k].name} ${isEvo(S, k) ? '✦' : '★'}${S.kw[k]}</span>`).join('');
    return `<div><b>${srcName(si)}${si ? ` Lv.${S.lv}` : s.power ? ` +${s.power}` : ''}</b>${chips || '<span class="chip">기본</span>'}</div>`;
  }).join('') + (Object.keys(s.curses).length ? `<div><b>저주</b>${Object.keys(s.curses).map(id => `<span class="chip">${CURSES.find(c => c.id === id).title}</span>`).join('')}</div>` : '');
}
function finish(win) {
  mode = 'result';
  const banked = Math.round(s.souls * (win ? 1 : .6));
  meta.bank += banked; meta.best = Math.max(meta.best, win ? WAVES.length : s.wave - 1); if (win) meta.wins++; saveMeta();
  $('resultLabel').textContent = win ? 'THE CASTLE STILL STANDS' : 'THE WATCH WILL RETURN';
  $('resultTitle').textContent = win ? '오늘도, 성은 무사하다' : '다음 근무에 다시';
  $('resultDesc').textContent = win ? '마왕은 없지만, 마왕군은 여기에 있습니다.' : `${s.wave}웨이브에서 성벽이 무너졌습니다.\n다른 키워드 조합으로 다시 도전하세요.`;
  $('statKills').textContent = s.kills; $('statTime').textContent = `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`; $('statLevel').textContent = s.level;
  $('buildList').innerHTML = buildHtml();
  $('bankLine').textContent = `소울 +${banked} 보관${win ? '' : ' (패배 시 60%)'} · 총 ${meta.bank}`;
  $('resultIcon').src = win ? 'assets/ui/win.webp' : 'assets/ui/lose.webp';
  $('result').classList.remove('hidden');
}
function renderMeta() {
  $('bankMeta').textContent = meta.bank; $('bankStart').textContent = meta.bank;
  $('metaList').innerHTML = '';
  for (const u of UNLOCKS) {
    const own = !!meta.owned[u.id], row = document.createElement('div'); row.className = 'unlock';
    row.innerHTML = `<div><b>${u.name}</b>${u.desc}</div><button class="secondary" ${own || meta.bank < u.cost ? 'disabled' : ''}>${own ? '해금됨' : `소울 ${u.cost}`}</button>`;
    row.querySelector('button').onclick = () => { if (own || meta.bank < u.cost) return; meta.bank -= u.cost; meta.owned[u.id] = true; saveMeta(); tone(700, .2, 'triangle', .05); renderMeta(); };
    $('metaList').append(row);
  }
  renderPrep();
}
function renderPrep() {
  const box = $('prep'), parts = [];
  if (meta.owned.starter) parts.push(`선발 영웅<div class="opts" data-k="starter">${[-1, 0, 1, 2, 3, 4, 5].map(i => `<button data-v="${i}" class="${meta.prep.starter === i ? 'on' : ''}">${i < 0 ? '없음' : HEROES[i].name}</button>`).join('')}</div>`);
  if (meta.owned.lone || meta.owned.cursed) parts.push(`시작 조건<div class="opts" data-k="cond">${[['base', '기본'], ...(meta.owned.lone ? [['lone', '외로운 포대']] : []), ...(meta.owned.cursed ? [['cursed', '저주받은 성']] : [])].map(([v, n]) => `<button data-v="${v}" class="${meta.prep.cond === v ? 'on' : ''}">${n}</button>`).join('')}</div>`);
  box.innerHTML = parts.join(''); box.classList.toggle('hidden', !parts.length);
  for (const g of box.querySelectorAll('.opts')) for (const b of g.querySelectorAll('button')) b.onclick = () => {
    const k = g.dataset.k; meta.prep[k] = k === 'starter' ? Number(b.dataset.v) : b.dataset.v; saveMeta(); renderPrep();
  };
}

/* ---------------- 그리기 ---------------- */
// 키워드 핍: 공격원 발밑에 쌓인 키워드가 색 점으로 보인다 → "이번 판은 이런 놈"
function drawPips(c, cx, cy, S) {
  const groups = KW_ORDER.filter(k => S.kw[k]); if (!groups.length) return;
  const widths = groups.map(k => S.kw[k] * 7), total = widths.reduce((a, b) => a + b, 0) + (groups.length - 1) * 5;
  let x = cx - total / 2;
  groups.forEach((k, gi) => {
    const col = KEYWORDS[k].color, evo = isEvo(S, k);
    if (evo) { c.save(); c.globalAlpha = .45 + .25 * Math.sin(t * 6); c.fillStyle = col; c.fillRect(x - 3, cy - 5, widths[gi] + 5, 10); c.restore(); }
    for (let j = 0; j < S.kw[k]; j++) { c.fillStyle = '#1a1024'; c.beginPath(); c.arc(x + 3.5 + j * 7, cy, 3.8, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(x + 3.5 + j * 7, cy, 2.8, 0, 7); c.fill(); }
    x += widths[gi] + 5;
  });
}
function drawEnemy(e) {
  const row = e.type, frame = row * 4 + Math.floor(t * 7 + e.phase) % 4, size = e.size, height = size * .8;
  ctx.fillStyle = '#1b142033'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 1, size * .28, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (e.traits.fast && e.y < 620) { ctx.save(); ctx.strokeStyle = '#ffd9a8aa'; ctx.lineWidth = 2; for (let j = -1; j <= 1; j++) { const ox = e.x + j * size * .18, oy = e.y - height - 4 - ((t * 90 + j * 13) % 14); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 10); ctx.stroke(); } ctx.restore(); }
  ctx.save();
  if (e.boss) { ctx.shadowColor = '#e576f5'; ctx.shadowBlur = 16; } else if (e.elite || e.mini) { ctx.shadowColor = '#ffd36a'; ctx.shadowBlur = 14 + 4 * Math.sin(t * 6); }
  anchoredFrame(ctx, animSheets.enemies, frame, e.x, e.y, size);
  ctx.restore();
  if (e.traits.armored) { ctx.save(); ctx.globalAlpha = .42; anchoredFrame(ctx, enemySteel, frame, e.x, e.y, size); ctx.restore(); } // 장갑: 강철빛 덧칠
  if (e.hit > 0 && enemyWhite) { ctx.save(); ctx.globalAlpha = Math.min(1, e.hit / .1) * (e.boss ? .4 : .9); anchoredFrame(ctx, enemyWhite, frame, e.x, e.y, size); ctx.restore(); }
  if (e.shield > 0) { const by = bodyY(e), r = size * .45; ctx.save(); ctx.fillStyle = 'rgba(127,227,255,.14)'; ctx.strokeStyle = 'rgba(160,236,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, by, r + Math.sin(t * 5 + e.phase) * 1.5, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
  if (e.boss) { ctx.save(); ctx.translate(e.x, e.y - height - 2); ctx.fillStyle = '#e7c176'; ctx.strokeStyle = '#382735'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-25, -16); ctx.lineTo(-12, -8); ctx.lineTo(0, -24); ctx.lineTo(12, -8); ctx.lineTo(25, -16); ctx.lineTo(22, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  const gw = e.boss || e.mini ? 52 : e.elite ? 44 : 36 * Math.max(.7, size / 72);
  drawUIGauge(ctx, e.x - gw / 2, e.y - height - 10, gw, 6, e.hp / e.max, e.boss || e.elite || e.mini ? 'purple' : 'red');
  if (e.traits.armored) drawUI(ctx, 'shield', e.x - gw / 2 - 15, e.y - height - 15, 14, 14);
  if (e.slow > 0) { ctx.fillStyle = '#c0e4ff'; ctx.globalAlpha = .6; ctx.beginPath(); ctx.ellipse(e.x, e.y, 20 * size / 72, 4, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  if (e.burn > 0) { ctx.fillStyle = '#f4b366'; for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(e.x + (j ? 8 : -6), e.y - 6 - ((t * 40 + j * 9) % 18), 2.5 + Math.sin(t * 20 + j), 0, 7); ctx.fill(); } }
}
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.clearRect(0, 0, W, H); ctx.save();
  if (s?.shake) ctx.translate((Math.random() - .5) * s.shake, (Math.random() - .5) * s.shake);
  ctx.drawImage(assets.bg, 0, 0, W, H);
  const R = s ? REGIONS[s.region] : REGIONS[0];
  if (R.tint) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = R.tint; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'screen'; const g = ctx.createLinearGradient(0, 0, 0, 420); g.addColorStop(0, R.glow); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 420); ctx.restore(); }
  if (s?.regionFlash > 0) { ctx.fillStyle = `rgba(255,240,220,${s.regionFlash * .35})`; ctx.fillRect(0, 0, W, H); }
  const shade = ctx.createLinearGradient(0, 0, 0, 125); shade.addColorStop(0, '#150d2733'); shade.addColorStop(1, '#140e2300'); ctx.fillStyle = shade; ctx.fillRect(0, 0, W, 125);
  // 영웅: 레벨에 따라 몸집과 오라가 바뀌고, 발밑에 키워드 핍
  for (let i = 0; i < HEROES.length; i++) {
    const d = HEROES[i], S = s ? s.src[i + 1] : { lv: 1, anim: 0, kw: blankKw() };
    if (S.lv) {
      const frame = S.anim > 0 ? 7 + Math.min(6, Math.floor((.6 - S.anim) / (.6 / 7))) : Math.floor(t * 5 + i) % 7;
      const size = d.size * 1.5 * (1 + .07 * Math.min(S.lv - 1, 5));
      if (S.lv >= 3) { ctx.save(); ctx.strokeStyle = d.color; ctx.lineWidth = 2; for (let r = 0; r < (S.lv >= 5 ? 2 : 1); r++) { ctx.globalAlpha = .35 + .2 * Math.sin(t * 4 + r * 2); ctx.beginPath(); ctx.ellipse(d.x, d.y - 1, 34 + r * 9, 7 + r * 2, 0, 0, Math.PI * 2); ctx.stroke(); } ctx.restore(); }
      ctx.fillStyle = '#1a102433'; ctx.beginPath(); ctx.ellipse(d.x, d.y - 1, 30, 5, 0, 0, Math.PI * 2); ctx.fill();
      anchoredFrame(ctx, animSheets[d.key], frame, d.x, d.y, size);
      if (s) drawPips(ctx, d.x, d.y + 12, S);
    } else if (!s?.lone) { ctx.save(); ctx.globalAlpha = .5 + Math.sin(t * 2 + i) * .08; drawUI(ctx, 'plus', d.x - 11, d.y - 24, 22, 22); ctx.restore(); }
  }
  if (s) for (const e of [...s.enemies].sort((a, b) => a.y - b.y)) drawEnemy(e);
  // 집중 포격 조준점
  if (s) for (const k of s.strikes) { const u = 1 - k.t / k.max, r = (TUNING.skillRadius + 15 * s.src[0].kw.blast) * (1.4 - .4 * u); ctx.save(); ctx.strokeStyle = `rgba(233,166,255,${.4 + .5 * u})`; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 40; ctx.beginPath(); ctx.arc(k.x, k.y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(k.x - 9, k.y); ctx.lineTo(k.x + 9, k.y); ctx.moveTo(k.x, k.y - 9); ctx.lineTo(k.x, k.y + 9); ctx.stroke(); ctx.restore(); }
  drawTurret(ctx, TURRET.x, TURRET.y, s ? s.aim : 0, s ? s.cannon : 0, 1, s ? Math.min(4, s.power) : 0);
  // 집중 포격 재충전 링
  if (s) { const cd = s.skillCd / skillMax(), ready = s.skillCd <= 0; ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = '#1a102499'; ctx.beginPath(); ctx.arc(TURRET.x, TURRET.y, 30, 0, 7); ctx.stroke(); ctx.strokeStyle = ready ? `rgba(255,221,134,${.7 + .3 * Math.sin(t * 8)})` : '#c36bff'; ctx.beginPath(); ctx.arc(TURRET.x, TURRET.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - clamp(cd, 0, 1))); ctx.stroke(); ctx.restore(); }
  drawUIFrame(ctx, 'inset', 230, 825, 80, 26, 7); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 18px TurretUI,system-ui'; ctx.fillStyle = '#ffdd86'; ctx.fillText('Lv. ' + (s ? s.level : 1), 270, 838); ctx.textBaseline = 'alphabetic';
  if (s) drawPips(ctx, TURRET.x, 812, s.src[0]);
  if (s) {
    const colors = ['#d18bff', '#eadabc', '#f3c775', '#f599ff', '#92f3e5', '#d7cedc', '#e7658d'];
    for (const p of s.shots) {
      const S = s.src[p.si], row = p.row, glow = S.kw.fire ? KEYWORDS.fire.color : S.kw.frost ? KEYWORDS.frost.color : [0, 3, 4].includes(row) ? colors[row] : null;
      ctx.save(); ctx.strokeStyle = glow || colors[row]; ctx.globalAlpha = .55; ctx.lineWidth = glow ? 2.5 : 1; ctx.shadowColor = glow || 'transparent'; ctx.shadowBlur = glow ? 8 : 0;
      ctx.beginPath(); p.trail.forEach((v, j) => j ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.translate(p.x, p.y); ctx.rotate(p.angle || 0); // 모든 아틀라스 행은 위쪽을 향함 → 속도 방향으로 회전
      const n = row * 4 + Math.floor(p.age * 12) % 4, size = [92, 70, 56, 88, 80, 70, 84][row] * (p.scale || 1) * (p.si ? 1 : 1 + .15 * Math.min(4, s.power)) * (p.crit ? 1.25 : 1);
      ctx.drawImage(animSheets.projectiles, (n % 4) * 256, Math.floor(n / 4) * 256, 256, 256, -size / 2, -size / 2, size, size); ctx.restore();
    }
    for (const f of s.fx) {
      ctx.save(); ctx.globalAlpha = Math.min(1, f.life / f.max); ctx.fillStyle = f.color; ctx.strokeStyle = f.color;
      if (f.impact) { const w = f.big ? 150 : 60, h = f.big ? 145 : 58, im = impactFx || assets.impact; ctx.globalAlpha = Math.min(1, f.life / f.max * 1.3); ctx.drawImage(im, f.x - w / 2, f.y + (f.big ? 110 : 44) - h, w, h); }
      else if (f.ring) { ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - f.life / f.max * .8), 0, Math.PI * 2); ctx.stroke(); }
      else if (f.line) { ctx.lineWidth = 2.5; ctx.shadowColor = f.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(f.x, f.y); for (let j = 1; j < 5; j++) { const u = j / 5; ctx.lineTo(f.x + (f.x2 - f.x) * u + (Math.random() - .5) * 14, f.y + (f.y2 - f.y) * u + (Math.random() - .5) * 14); } ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
      else { ctx.translate(f.x, f.y); ctx.rotate(f.life * 8); ctx.fillRect(-f.size / 2, -f.size / 2, f.size, f.size); }
      ctx.restore();
    }
    ctx.textAlign = 'center';
    for (const z of s.texts) { ctx.globalAlpha = Math.min(1, z.life * 3); ctx.font = `900 ${z.crit ? 24 : 19}px TurretUI,system-ui`; ctx.fillStyle = z.color || (z.crit ? '#ffe3a0' : '#fff8ff'); ctx.strokeStyle = '#682889'; ctx.lineWidth = 4; ctx.strokeText(z.v, z.x, z.y); ctx.fillText(z.v, z.x, z.y); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function previewFrames() {
  const c = $('spritePreview').getContext('2d'); c.setTransform(DPR, 0, 0, DPR, 0, 0); c.imageSmoothingQuality = 'high'; c.clearRect(0, 0, 540, 700);
  c.fillStyle = '#f0d9b7'; c.textAlign = 'center'; c.font = '14px TurretUI,system-ui';
  const cycle = t % 3.8, f = cycle < 2.2 ? Math.floor(cycle * 3.18) % 7 : 7 + Math.min(6, Math.floor((cycle - 2.2) * 4.375));
  for (let i = 0; i < 6; i++) { const x = 90 + (i % 3) * 180, y = 145 + Math.floor(i / 3) * 175; anchoredFrame(c, animSheets[HEROES[i].key], f, x, y, HEROES[i].size * 1.5); c.fillText(HEROES[i].name, x, y + 22); }
  drawTurret(c, 104, 453, Math.sin(t * .8) * Math.PI / 3, (t % 1) < .32 ? .32 - t % 1 : 0, .6); c.fillText('포신 ±60° · 포구 발사', 104, 546);
  for (let i = 0; i < 3; i++) anchoredFrame(c, animSheets.enemies, i * 4 + Math.floor(t * 7) % 4, 235 + i * 110, 486, 100);
  c.fillText('이동 4프레임', 350, 536);
  for (let i = 0; i < 7; i++) { const n = i * 4 + Math.floor(t * 12) % 4; c.drawImage(animSheets.projectiles, (n % 4) * 256, Math.floor(n / 4) * 256, 256, 256, 8 + i * 76, 575, 72, 72); }
  c.fillText('진행 방향 ↑ · 비행 4프레임', 270, 680);
}

/* ---------------- 루프 · 입력 · 부팅 ---------------- */
function loop(now) {
  const dt = Math.min(.04, (now - last) / 1000 || .016); last = now; t += dt; update(dt);
  if (toastTime > 0) { toastTime -= dt; if (toastTime <= 0) $('toast').style.opacity = 0; }
  draw(); if (!$('spriteOverlay').classList.contains('hidden')) previewFrames();
  requestAnimationFrame(loop);
}
function fieldPoint(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
cv.addEventListener('pointerdown', e => { if (mode !== 'play') return; const p = fieldPoint(e); trySkill(p.x, Math.min(p.y, 700)); });
const showOverlay = (id, on) => $(id).classList.toggle('hidden', !on);
$('begin').onclick = newRun; $('again').onclick = newRun; $('restart').onclick = newRun;
$('reroll').onclick = reroll; $('eliteYes').onclick = () => answerElite(true); $('eliteNo').onclick = () => answerElite(false);
$('openMeta').onclick = () => { renderMeta(); showOverlay('metaOverlay', true); };
$('resultMeta').onclick = () => { renderMeta(); showOverlay('result', false); mode = 'start'; showOverlay('metaOverlay', true); };
$('closeMeta').onclick = () => { showOverlay('metaOverlay', false); renderMeta(); if (mode === 'start') showOverlay('start', true); };
$('openSprites').onclick = () => showOverlay('spriteOverlay', true); $('closeSprites').onclick = () => showOverlay('spriteOverlay', false);
$('pause').onclick = () => { if (mode === 'play') { mode = 'pause'; $('pauseBuild').innerHTML = `<div id="buildList">${buildHtml()}</div>`; showOverlay('pauseOverlay', true); } };
$('resume').onclick = () => { mode = 'play'; showOverlay('pauseOverlay', false); };
$('sound').onclick = () => { audioOn = !audioOn; $('soundIcon').src = `assets/ui/${audioOn ? 'soundon' : 'soundoff'}.webp`; $('sound').setAttribute('aria-pressed', String(audioOn)); $('sound').setAttribute('aria-label', audioOn ? '효과음 끄기' : '효과음 켜기'); tone(440, .12); };
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') $('pause').click(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && mode === 'play') { e.preventDefault(); const u = urgent(); if (u) trySkill(u.x, bodyY(u)); }
  if (e.code === 'Escape' && mode === 'play') $('pause').click();
});

loadMeta();
Promise.all(Object.entries(IMG_FILES).map(async ([k, v]) => [k, await imageLoad('assets/' + v)])).then(entries => {
  assets = Object.fromEntries(entries);
  animSheets = Object.fromEntries([...HEROES.map(h => h.key), 'enemies', 'projectiles'].map(k => [k, assets['anim_' + k]]));
  for (const k in FRAME_FX) if (animSheets[k]) animSheets[k]._fx = FRAME_FX[k];
  impactFx = cleanImpact(assets.impact); enemyWhite = whiteOf(animSheets.enemies); enemySteel = whiteOf(animSheets.enemies, '#8d9aab');
  for (const id of ['field', 'spritePreview']) { const q = $(id); q.width = Math.round(q.width * DPR); q.height = Math.round(q.height * DPR); }
  const ta = $('titleArt').getContext('2d'), cn = assets.cannon; ta.drawImage(cn, 100 - 85, 195 - 170, 170, 170);
  renderMeta();
  $('loading').classList.add('hidden'); $('start').classList.remove('hidden'); mode = 'start'; requestAnimationFrame(loop);
}).catch(e => { console.error(e); $('loading').textContent = '이미지를 읽지 못했습니다. 페이지를 새로고침해 주세요.'; });
