'use strict';
/* =====================================================================
 * 게임 데이터 테이블
 * 기획 원칙: "규칙은 적게, 조합과 상황은 다양하게"
 *  - 키워드 7종(형태 4 + 속성 3)이 포탑·영웅 공통 규칙이다.
 *  - 규칙 단 하나: 키워드는 그 키워드를 가진 공격원의 모든 공격에 적용된다.
 *  - 같은 키워드 ★3 = 진화(효과가 한 단계 더 퍼진다).
 *  - 적 특성 4종은 각각 키워드와 한 줄로 연결된다.
 * 콘텐츠 추가는 이 파일의 테이블만 늘리는 것을 원칙으로 한다.
 * ===================================================================== */

const MAX_STACK = 5, EVO_STACK = 3;

/* 키워드: 형태(투사체가 어떻게 나가나) / 속성(맞은 적에게 무엇이 남나) */
const KEYWORDS = {
  multi:  {name:'다중', group:'형태', icon:'multi', color:'#d18bff',
           first:'투사체 +1 (부채꼴)', next:'투사체 +1', evo:'진화 · 투사체 +2 추가'},
  pierce: {name:'관통', group:'형태', icon:'axe', color:'#eadabc', locked:true,
           first:'적 1명을 꿰뚫고 계속 비행', next:'1명 더 관통', evo:'진화 · 무한 관통'},
  chain:  {name:'연쇄', group:'형태', icon:'spirit', color:'#92f3e5', locked:true,
           first:'명중 후 근처 적에게 튕김', next:'1번 더 튕김', evo:'진화 · 튕길 때마다 2갈래'},
  blast:  {name:'폭발', group:'형태', icon:'blast', color:'#f3c775',
           first:'착탄 지점 범위 피해', next:'폭발 범위 +15', evo:'진화 · 2차 폭발'},
  fire:   {name:'화염', group:'속성', icon:'fire', color:'#ff8a4c',
           first:'화상: 피해의 30%/초', next:'화상 피해 +30%', evo:'진화 · 불탄 적이 죽으면 불이 번짐'},
  frost:  {name:'냉기', group:'속성', icon:'frost', color:'#8fdcff',
           first:'둔화(이동 45%↓)', next:'둔화 지속 +0.4초', evo:'진화 · 둔화된 적이 죽으면 냉기가 번짐'},
  crit:   {name:'치명', group:'속성', icon:'crit', color:'#ffe3a0',
           first:'치명타 확률 +12% (2배·장갑 무시)', next:'치명타 확률 +12%', evo:'진화 · 치명타 피해 3배'},
};
const KW_ORDER = ['multi','pierce','chain','blast','fire','frost','crit'];

/* 적 특성: 각각 "유리한 키워드"가 정해져 있지만 정답은 하나가 아니다 */
const TRAITS = {
  armored:  {name:'장갑', color:'#b9c3cf', rule:'치명타가 아닌 피해 절반', counter:'치명 · 높은 화력'},
  swarm:    {name:'떼거리', color:'#c99cf0', rule:'작고 약하지만 3마리씩', counter:'다중 · 폭발 · 연쇄'},
  fast:     {name:'질주', color:'#ffb36b', rule:'이동 속도 1.75배', counter:'냉기 · 집중 포격'},
  shielded: {name:'보호막', color:'#7fe3ff', rule:'첫 타격을 무효화', counter:'다중 · 연쇄 · 관통'},
};
const TRAIT_ORDER = ['armored','swarm','fast','shielded'];

/* 영웅: 각자 고유 키워드 1개를 가지고 시작 (예외 규칙 대신 공용 키워드) */
const HEROES = [
  {key:'skeleton', name:'해골 궁수',   sub:'잊힌 초소의 명사수',   color:'#e3d7b3', x:63,  y:552, damage:18, rate:1.05, row:1, speed:600, mouth:48, size:146, innate:'frost'},
  {key:'goblin',   name:'고블린 폭탄병', sub:'불발 없는 사고뭉치',   color:'#e5b368', x:69,  y:644, damage:27, rate:1.8,  row:2, speed:320, mouth:48, size:134, innate:'blast'},
  {key:'demon',    name:'꼬마 악마',   sub:'작지만 뜨거운 야망',   color:'#d583ee', x:77,  y:762, damage:17, rate:1.05, row:3, speed:560, mouth:67, size:183, innate:'fire'},
  {key:'lich',     name:'리치',        sub:'퇴근을 잊은 마법사',   color:'#a3d9d7', x:481, y:568, damage:22, rate:1.55, row:4, speed:560, mouth:65, size:225, innate:'chain'},
  {key:'orc',      name:'오크 도끼병', sub:'말보다 도끼가 빠른',   color:'#c2c78b', x:480, y:672, damage:34, rate:1.65, row:5, speed:520, mouth:52, size:274, innate:'pierce'},
  {key:'vampire',  name:'뱀파이어',    sub:'밤샘 근무의 달인',     color:'#eb839c', x:477, y:767, damage:15, rate:.88,  row:6, speed:440, mouth:50, size:165, innate:'multi'},
];

/* 지역: 배경 1장 + 컬러 오버레이만으로 "장소가 바뀌었다"를 표현 */
const REGIONS = [
  {name:'버려진 초소',  tint:null},
  {name:'황혼의 성벽',  tint:'rgba(255,130,50,.34)', glow:'rgba(255,170,90,.18)'},
  {name:'그믐의 성벽',  tint:'rgba(50,70,200,.42)',  glow:'rgba(120,150,255,.16)'},
  {name:'붉은 달',      tint:'rgba(200,30,60,.40)',  glow:'rgba(255,80,110,.20)'},
];

/* 웨이브 설계: 30~40초마다 무언가 새로 등장한다.
 * traits: 이번 웨이브에 섞일 특성 수(런마다 무작위로 뽑힘), pool: 후보 특성 */
const WAVES = [
  {n:7},
  {n:8,  traits:1, pool:['swarm','fast']},
  {n:9,  traits:1, pool:['swarm','fast','shielded'], offerElite:true},
  {n:9,  traits:1, elite:1, region:1},
  {n:6,  traits:1, mini:true, offerElite:'hunter'},
  {n:10, traits:1, offerElite:true},
  {n:11, traits:2, region:2},
  {n:12, traits:2, offerElite:true},
  {n:13, traits:3},
  {n:10, traits:2, boss:true, region:3},
];

/* 저주 카드: 큰 리턴 + 확실한 대가 (포커 축) */
const CURSES = [
  {id:'blood',  title:'피의 계약',   good:'포탑 다중 ★+2',            bad:'성 최대 내구도 -80'},
  {id:'frenzy', title:'광기의 장전', good:'포탑 연사 +60%',           bad:'적 이동 속도 +15%'},
  {id:'pawn',   title:'영혼 담보',   good:'모든 공격원 치명 ★+1',      bad:'이번 런 소울 획득 절반'},
  {id:'pyre',   title:'불타는 성벽', good:'모든 공격원 화염 ★+1',      bad:'웨이브 클리어 회복 없음'},
];

/* 메타 성장: 스탯이 아니라 "다음 런에서 만들 수 있는 빌드의 종류"를 늘린다 */
const UNLOCKS = [
  {id:'pierce',      name:'키워드 · 관통',          desc:'카드 풀에 「관통」 추가',                         cost:120},
  {id:'chain',       name:'키워드 · 연쇄',          desc:'카드 풀에 「연쇄」 추가',                         cost:200},
  {id:'starter',     name:'선발 영웅',              desc:'런 시작 시 영웅 1명을 골라 배치',                 cost:150},
  {id:'hunter',      name:'엘리트 사냥꾼',          desc:'5웨이브 후 엘리트 도전 기회 +1',                  cost:180},
  {id:'lone',        name:'시작 조건 · 외로운 포대', desc:'영웅 영입 불가 · 포탑이 다중★2 폭발★1로 시작',     cost:250},
  {id:'cursed',      name:'시작 조건 · 저주받은 성', desc:'저주 카드가 자주 등장 · 소울 획득 ×1.5',          cost:250},
];

const TUNING = {
  turretDamage:20, turretInterval:1.2, shellSpeed:600,
  castleHp:300, waveHeal:12,
  rerollBase:15, rerollStep:10,
  skillCd:8, skillDelay:.55, skillRadius:70, skillMul:5,
  slowFactor:.55,
  // 적 체력 = (hpBase + 웨이브×hpWave) × (1+hpGrowth)^웨이브
  hpBase:32, hpWave:14, hpGrowth:.15, bossHp:6200, miniHp:1500, spawnGap:1.3,
};
