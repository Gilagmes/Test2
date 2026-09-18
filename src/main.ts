import Phaser from 'phaser';
import './style.css';
import {
  apiBuySkin,
  apiClaimDaily,
  apiCompleteTutorial,
  apiEquipSkin,
  apiGetLeaderboard,
  apiGetProfile,
  apiGetShopSkins,
  apiLogin,
  apiStartMatch,
  apiSubmitMatchResult,
  type ApiSession,
  type ClientActionStream,
  type ClientActionStreamEntry,
  type ClientEventActor,
  type ClientEventLog,
  type ClientEventLogEntry,
  type LeaderboardEntry,
  type PlayerProfile,
  type ShopSkin
} from './api';
import { ACTION_STREAM_VERSION, SIMULATION_RULES, canonicalStringify, createInitialCombatState, renderCombatSnapshot, simulateCombat, stableHash, stepCombatState } from '../shared/combatRules.js';
import type { RenderActorSnapshot, RenderCombatEvent, RenderCombatSnapshot, SharedAction } from '../shared/combatRules.js';
import { haptic, initTelegram } from './telegram';

const tgRuntime = initTelegram();

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const MAP_WIDTH = 2200;
const MAP_HEIGHT = 1200;

const COLORS = {
  bg: 0x090719,
  panel: 0x14102c,
  panel2: 0x201a43,
  blue: 0x36d6ff,
  blueDark: 0x126bff,
  red: 0xff416b,
  redDark: 0x9b1d47,
  gold: 0xffd166,
  white: 0xf8f7ff,
  muted: 0x9aa1c7,
  green: 0x63f29d,
  purple: 0xb06dff
};

type Team = 'blue' | 'red';
type ActorKind = 'hero' | 'minion' | 'tower' | 'core';
type Controller = 'player' | 'bot' | 'minion' | 'tower' | 'structure';
type AbilitySlot = 'primary' | 'secondary' | 'ultimate';
type TutorialAction = 'move' | 'attack' | 'primary' | 'secondary' | 'ultimate' | 'tower' | 'core';

type MatchResult = {
  victory: boolean;
  winner: Team;
  durationSec: number;
  heroName: string;
  heroId: string;
  kills: number;
  deaths: number;
  gold: number;
  level: number;
  tutorial?: boolean;
  eventLog?: ClientEventLog;
  actionStream?: ClientActionStream;
};

type HeroConfig = {
  id: string;
  name: string;
  title: string;
  role: string;
  description: string;
  color: number;
  accent: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  attackCooldown: number;
  abilities: Record<AbilitySlot, { label: string; hotkey: string; cooldown: number; description: string }>;
};

type Actor = {
  id: string;
  team: Team;
  kind: ActorKind;
  controller: Controller;
  name: string;
  heroId?: string;
  role?: string;
  view: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse;
  hpFill: Phaser.GameObjects.Rectangle;
  hpBg: Phaser.GameObjects.Rectangle;
  levelText?: Phaser.GameObjects.Text;
  radius: number;
  maxHp: number;
  hp: number;
  damage: number;
  range: number;
  speed: number;
  attackCooldown: number;
  lastAttack: number;
  abilityReadyAt?: Record<AbilitySlot, number>;
  dead: boolean;
  level: number;
  xp: number;
  gold: number;
  kills: number;
  deaths: number;
  respawnAt?: number;
  target?: Actor;
  pathIndex?: number;
  nextThinkAt?: number;
  stunnedUntil?: number;
  auraUntil?: number;
  shield?: number;
  slowUntil?: number;
  tutorialTag?: 'dummy' | 'tower' | 'core';
  spawn: Phaser.Math.Vector2;
};

type Projectile = {
  id: string;
  team: Team;
  owner: Actor;
  view: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  expiresAt: number;
  hit: Set<string>;
};

type Zone = {
  id: string;
  team: Team;
  owner: Actor;
  view: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  radius: number;
  damage: number;
  nextTickAt: number;
  tickMs: number;
  expiresAt: number;
  slow: boolean;
};

type AbilityButton = {
  slot: AbilitySlot | 'attack';
  container: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Arc;
  cdText: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  readyColor: number;
};

type SharedSimActorView = {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  label?: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Ellipse;
  aura: Phaser.GameObjects.Arc;
  weapon?: Phaser.GameObjects.Rectangle;
  lastHp: number;
};

const HEROES: HeroConfig[] = [
  {
    id: 'kairo',
    name: 'Кайро',
    title: 'Пылающий Кулак',
    role: 'Боец',
    description: 'Врывается в ближний бой, разгоняет комбо и временно окружает себя огненной аурой.',
    color: 0xff6b2a,
    accent: 0xffd166,
    maxHp: 980,
    damage: 64,
    range: 92,
    speed: 242,
    attackCooldown: 620,
    abilities: {
      primary: { label: 'Рывок', hotkey: 'K', cooldown: 4200, description: 'Рывок вперёд с уроном по линии.' },
      secondary: { label: 'Комбо', hotkey: 'L', cooldown: 6200, description: 'Взрывная серия ударов вокруг героя.' },
      ultimate: { label: 'Сверхнова', hotkey: 'Space', cooldown: 18500, description: 'Огненная аура усиливает атаки на 6 секунд.' }
    }
  },
  {
    id: 'reyna',
    name: 'Рэйна',
    title: 'Лунная Клинковая',
    role: 'Ассасин',
    description: 'Быстрая дуэлянтка: резкие рывки, сильный burst-урон и добивание слабых целей.',
    color: 0x7fd7ff,
    accent: 0xd8f3ff,
    maxHp: 720,
    damage: 82,
    range: 105,
    speed: 282,
    attackCooldown: 560,
    abilities: {
      primary: { label: 'Срез', hotkey: 'K', cooldown: 3600, description: 'Лунная дуга перед героем.' },
      secondary: { label: 'Тень', hotkey: 'L', cooldown: 5600, description: 'Короткий телепорт к цели или в выбранном направлении.' },
      ultimate: { label: 'Танец', hotkey: 'Space', cooldown: 17000, description: 'Серия клинковых ударов по врагам рядом.' }
    }
  },
  {
    id: 'teo',
    name: 'Тэо',
    title: 'Громовой Ученик',
    role: 'Маг',
    description: 'Держит дистанцию, ставит грозовые зоны и наказывает скопления врагов.',
    color: 0x8c7cff,
    accent: 0x62f2ff,
    maxHp: 650,
    damage: 58,
    range: 270,
    speed: 236,
    attackCooldown: 760,
    abilities: {
      primary: { label: 'Искра', hotkey: 'K', cooldown: 3300, description: 'Быстрый электрический снаряд.' },
      secondary: { label: 'Печать', hotkey: 'L', cooldown: 7200, description: 'Зона урона и замедления.' },
      ultimate: { label: 'Разряд', hotkey: 'Space', cooldown: 20500, description: 'Молния по большой области после задержки.' }
    }
  }
];

const sharedState: {
  selectedHeroId: string;
  lastResult?: MatchResult;
  currentMatchId: string | null;
  currentMatchSeed: number | null;
  currentMatchValidationToken: string | null;
  session?: ApiSession;
  profile?: PlayerProfile;
  shopSkins: ShopSkin[];
  apiOnline: boolean;
  resultSyncStatus?: 'local' | 'pending' | 'saved' | 'rejected';
  resultSyncMessage?: string;
  loginPromise?: Promise<void>;
} = {
  selectedHeroId: 'kairo',
  currentMatchId: null,
  currentMatchSeed: null,
  currentMatchValidationToken: null,
  shopSkins: [],
  apiOnline: false
};

function ensureApiSession(): Promise<void> {
  if (sharedState.loginPromise) return sharedState.loginPromise;

  sharedState.loginPromise = (async () => {
    const session = await apiLogin(tgRuntime.initData);
    if (session?.ok) {
      sharedState.session = session;
      sharedState.profile = session.user;
      sharedState.apiOnline = true;
    } else {
      sharedState.apiOnline = false;
    }
  })();

  return sharedState.loginPromise;
}

function profileLine(): string {
  const profile = sharedState.profile;
  if (!profile) return sharedState.apiOnline ? 'Профиль загружается...' : 'Offline mode: результаты сохраняются локально';
  return `${profile.firstName} · рейтинг ${profile.stats.rating} · побед ${profile.stats.wins}/${profile.stats.matches} · искры ${profile.inventory.soft}`;
}

function apiStatusLine(): string {
  if (sharedState.apiOnline && sharedState.session) {
    return sharedState.session.mode === 'telegram' ? 'API online · Telegram auth' : 'API online · dev auth';
  }
  return 'API offline · local fallback';
}

async function refreshProfile(): Promise<PlayerProfile | undefined> {
  await ensureApiSession();
  if (!sharedState.session) return sharedState.profile;
  const profile = await apiGetProfile(sharedState.session.token);
  if (profile) sharedState.profile = profile;
  return sharedState.profile;
}

async function loadShopSkins(): Promise<ShopSkin[]> {
  await ensureApiSession();
  if (!sharedState.session) return sharedState.shopSkins;
  const response = await apiGetShopSkins(sharedState.session.token);
  if (response) {
    sharedState.shopSkins = response.skins;
    sharedState.profile = response.user;
  }
  return sharedState.shopSkins;
}


async function prepareServerMatch(heroId: string): Promise<void> {
  sharedState.currentMatchId = null;
  sharedState.currentMatchSeed = null;
  sharedState.currentMatchValidationToken = null;

  await ensureApiSession();
  if (!sharedState.session) return;
  if (sharedState.shopSkins.length === 0) await loadShopSkins();

  const match = await apiStartMatch(sharedState.session.token, heroId);
  sharedState.currentMatchId = match?.id ?? null;
  sharedState.currentMatchSeed = match?.seed ?? null;
  sharedState.currentMatchValidationToken = match?.validationToken ?? null;
}

function equippedSkinForHero(heroId: string): ShopSkin | undefined {
  const skinId = sharedState.profile?.inventory.selectedSkinByHero?.[heroId];
  if (!skinId) return undefined;
  return sharedState.shopSkins.find((skin) => skin.id === skinId);
}

function heroVisual(hero: HeroConfig, forPlayer = false): { color: number; accent: number; skinName?: string } {
  const skin = forPlayer ? equippedSkinForHero(hero.id) : undefined;
  return {
    color: skin?.color ?? hero.color,
    accent: skin?.accent ?? hero.accent,
    skinName: skin?.name
  };
}

function showUiToast(scene: Phaser.Scene, x: number, y: number, message: string, color = COLORS.gold) {
  const toast = scene.add.text(x, y, message, {
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: '22px',
    color: colorToCss(color),
    stroke: '#000000',
    strokeThickness: 4,
    align: 'center',
    wordWrap: { width: 620 }
  }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);

  scene.tweens.add({
    targets: toast,
    y: y - 36,
    alpha: 0,
    duration: 1450,
    ease: 'Cubic.easeOut',
    onComplete: () => toast.destroy()
  });
}

const BLUE_PATH = [
  new Phaser.Math.Vector2(250, 610),
  new Phaser.Math.Vector2(560, 610),
  new Phaser.Math.Vector2(900, 550),
  new Phaser.Math.Vector2(1110, 600),
  new Phaser.Math.Vector2(1370, 650),
  new Phaser.Math.Vector2(1680, 610),
  new Phaser.Math.Vector2(1980, 600)
];

const RED_PATH = [...BLUE_PATH].reverse();

function heroById(id: string): HeroConfig {
  return HEROES.find((hero) => hero.id === id) ?? HEROES[0];
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function teamColor(team: Team): number {
  return team === 'blue' ? COLORS.blue : COLORS.red;
}

function enemyTeam(team: Team): Team {
  return team === 'blue' ? 'red' : 'blue';
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function createTextButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  onClick: () => void | Promise<void>,
  accent = COLORS.blue
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y).setDepth(1000);
  const bg = scene.add.rectangle(0, 0, width, height, COLORS.panel2, 0.95)
    .setStrokeStyle(2, accent, 1)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  const text = scene.add.text(0, 0, label, {
    fontFamily: 'Arial, sans-serif',
    fontSize: '24px',
    fontStyle: 'bold',
    color: colorToCss(COLORS.white)
  }).setOrigin(0.5);

  bg.on('pointerover', () => bg.setFillStyle(accent, 0.24));
  bg.on('pointerout', () => bg.setFillStyle(COLORS.panel2, 0.95));
  bg.on('pointerdown', () => {
    haptic('medium');
    bg.setScale(0.98);
  });
  bg.on('pointerup', () => {
    bg.setScale(1);
    onClick();
  });

  container.add([bg, text]);
  return container;
}

function drawShonenBackground(scene: Phaser.Scene) {
  const g = scene.add.graphics().setDepth(-130);
  g.fillGradientStyle(0x070512, 0x090719, 0x181039, 0x26104e, 1);
  g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  if (scene.textures.exists('title_bg')) {
    scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'title_bg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setAlpha(0.48)
      .setDepth(-124);
    scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x070512, 0.34)
      .setDepth(-123);
  }

  const fx = scene.add.graphics().setDepth(-100);
  for (let i = 0; i < 58; i += 1) {
    const x = Phaser.Math.Between(-160, GAME_WIDTH + 160);
    const y = Phaser.Math.Between(-90, GAME_HEIGHT + 90);
    const len = Phaser.Math.Between(120, 520);
    const alpha = Phaser.Math.FloatBetween(0.04, 0.14);
    const color = i % 4 === 0 ? COLORS.blue : i % 4 === 1 ? COLORS.red : i % 4 === 2 ? COLORS.gold : COLORS.purple;
    fx.lineStyle(i % 5 === 0 ? 4 : 2, color, alpha);
    fx.beginPath();
    fx.moveTo(x, y);
    fx.lineTo(x + len, y - len * 0.35);
    fx.strokePath();
  }

  fx.lineStyle(4, COLORS.gold, 0.19);
  fx.strokeCircle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.48, 270);
  fx.strokeCircle(GAME_WIDTH * 0.5, GAME_HEIGHT * 0.48, 420);
  fx.lineStyle(2, COLORS.blue, 0.16);
  fx.strokeCircle(GAME_WIDTH * 0.18, GAME_HEIGHT * 0.68, 165);
  fx.lineStyle(2, COLORS.red, 0.16);
  fx.strokeCircle(GAME_WIDTH * 0.82, GAME_HEIGHT * 0.28, 175);

  for (let i = 0; i < 18; i += 1) {
    const spark = scene.add.rectangle(
      Phaser.Math.Between(30, GAME_WIDTH - 30),
      Phaser.Math.Between(40, GAME_HEIGHT - 40),
      Phaser.Math.Between(3, 8),
      Phaser.Math.Between(18, 46),
      i % 2 ? COLORS.blue : COLORS.red,
      0.16
    ).setRotation(-0.9).setDepth(-92);
    scene.tweens.add({
      targets: spark,
      alpha: { from: 0.06, to: 0.32 },
      y: spark.y - Phaser.Math.Between(14, 34),
      yoyo: true,
      repeat: -1,
      duration: Phaser.Math.Between(1200, 2400),
      delay: Phaser.Math.Between(0, 900)
    });
  }
}

function createGlassPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  accent = COLORS.blue,
  alpha = 0.82
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y);
  const shadow = scene.add.rectangle(8, 10, width, height, 0x000000, 0.34);
  const bg = scene.add.rectangle(0, 0, width, height, COLORS.panel, alpha)
    .setStrokeStyle(2, accent, 0.66);
  const top = scene.add.rectangle(0, -height / 2 + 13, width - 18, 4, accent, 0.42);
  const shine = scene.add.rectangle(-width * 0.28, -height * 0.18, width * 0.36, 2, 0xffffff, 0.32)
    .setRotation(-0.32);
  container.add([shadow, bg, top, shine]);
  return container;
}

function createPortraitFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  width: number,
  height: number,
  accent: number,
  depth = 10
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y).setDepth(depth);
  const glow = scene.add.rectangle(0, 0, width + 18, height + 18, accent, 0.12);
  const bg = scene.add.rectangle(0, 0, width, height, 0x080616, 0.96).setStrokeStyle(3, accent, 0.84);
  container.add([glow, bg]);

  if (scene.textures.exists(key)) {
    const image = scene.add.image(0, 0, key).setDisplaySize(width - 12, height - 12);
    container.add(image);
  } else {
    const fallback = scene.add.circle(0, 0, Math.min(width, height) * 0.34, accent, 0.78)
      .setStrokeStyle(4, COLORS.white, 0.45);
    container.add(fallback);
  }

  const topLine = scene.add.rectangle(0, -height / 2 + 7, width - 18, 4, COLORS.white, 0.32);
  const bottomLine = scene.add.rectangle(0, height / 2 - 7, width - 18, 4, accent, 0.52);
  container.add([topLine, bottomLine]);
  return container;
}

function createSmallHeroSilhouette(scene: Phaser.Scene, x: number, y: number, hero: HeroConfig, scale = 1) {
  const visual = heroVisual(hero, false);
  const c = scene.add.container(x, y).setScale(scale).setDepth(20);
  const shadow = scene.add.ellipse(0, 46, 104, 24, 0x000000, 0.35);
  const aura = scene.add.circle(0, 0, 58, visual.color, 0.16).setStrokeStyle(3, visual.accent, 0.44);
  const cloak = scene.add.triangle(0, 30, -38, 62, 38, 62, 0, -28, visual.color, 0.42)
    .setStrokeStyle(2, visual.accent, 0.45);
  const body = scene.add.ellipse(0, 8, 52, 68, visual.color, 0.88).setStrokeStyle(4, COLORS.white, 0.42);
  const head = scene.add.circle(0, -38, 20, visual.accent, 0.96).setStrokeStyle(3, COLORS.white, 0.5);
  const hair = scene.add.triangle(0, -54, -25, -38, 0, -76, 25, -38, visual.color, 0.96);
  const weapon = scene.add.rectangle(42, -8, 94, 7, visual.accent, 0.9).setRotation(-0.52);
  c.add([shadow, aura, cloak, body, head, hair, weapon]);
  scene.tweens.add({ targets: aura, scale: 1.15, alpha: 0.31, yoyo: true, repeat: -1, duration: 980 });
  scene.tweens.add({ targets: c, y: y - 10, yoyo: true, repeat: -1, duration: 1650, ease: 'Sine.easeInOut' });
  return c;
}

class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x070512, 0x090719, 0x171039, 0x26104e, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.add.text(GAME_WIDTH / 2, 250, 'SHONEN RIFT', {
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: '58px',
      color: colorToCss(COLORS.white),
      stroke: '#ff416b',
      strokeThickness: 7,
      shadow: { offsetX: 0, offsetY: 0, color: '#36d6ff', blur: 18, fill: true }
    }).setOrigin(0.5);

    const frame = this.add.rectangle(GAME_WIDTH / 2, 382, 520, 24, 0x000000, 0.45)
      .setStrokeStyle(2, COLORS.blue, 0.58);
    const fill = this.add.rectangle(frame.x - 254, frame.y, 0, 14, COLORS.gold, 0.95).setOrigin(0, 0.5);
    const label = this.add.text(GAME_WIDTH / 2, 426, 'Загрузка арены...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '20px',
      color: colorToCss(0xd7dcff)
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      fill.width = 508 * value;
      label.setText(`Загрузка арены... ${Math.round(value * 100)}%`);
    });

    this.load.image('title_bg', '/assets/ui/title_bg.png');
    for (const hero of HEROES) {
      this.load.image(`portrait_${hero.id}`, `/assets/portraits/${hero.id}.png`);
    }
  }

  create() {
    this.scene.start('PreviewScene');
  }
}

class PreviewScene extends Phaser.Scene {
  private previewHashText?: Phaser.GameObjects.Text;
  private previewBannerText?: Phaser.GameObjects.Text;
  private previewStep = 0;

  constructor() {
    super('PreviewScene');
  }

  create() {
    drawShonenBackground(this);

    this.add.text(GAME_WIDTH / 2, 58, 'SHONEN RIFT', {
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: '64px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white),
      stroke: '#ff416b',
      strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 0, color: '#36d6ff', blur: 20, fill: true }
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 112, 'Telegram MOBA Preview · shonen-action 3v3 arena', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.createPill(226, 150, 'Telegram Mini App', COLORS.blue);
    this.createPill(449, 150, '3v3 против ботов', COLORS.gold);
    this.createPill(660, 150, 'Shared deterministic sim', COLORS.purple);
    this.createPill(914, 150, 'Server validation v5', COLORS.green);
    this.createPill(1112, 150, 'Original heroes', COLORS.red);

    this.createHeroShowcase();
    this.createFeaturePanel();
    this.createCombatPreview();
    this.createCallToAction();

    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start('HeroSelectScene'));
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('HeroSelectScene'));
  }

  private createPill(x: number, y: number, label: string, accent: number) {
    const c = this.add.container(x, y).setDepth(20);
    const bg = this.add.rectangle(0, 0, 186, 34, 0x070512, 0.76)
      .setStrokeStyle(2, accent, 0.65);
    const glow = this.add.rectangle(0, 0, 194, 42, accent, 0.08);
    const text = this.add.text(0, 0, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white)
    }).setOrigin(0.5);
    c.add([glow, bg, text]);
  }

  private createHeroShowcase() {
    const panel = createGlassPanel(this, 238, 405, 390, 440, COLORS.gold, 0.78).setDepth(5);
    this.add.text(panel.x, panel.y - 188, 'Герои запуска', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '27px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(6);

    HEROES.forEach((hero, index) => {
      const y = panel.y - 116 + index * 124;
      const visual = heroVisual(hero, false);
      createPortraitFrame(this, panel.x - 126, y, `portrait_${hero.id}`, 84, 96, visual.accent, 7);
      createSmallHeroSilhouette(this, panel.x + 128, y + 8, hero, 0.32).setDepth(8);
      this.add.text(panel.x - 66, y - 28, `${hero.name} · ${hero.role}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '18px',
        color: colorToCss(COLORS.white),
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0, 0.5).setDepth(8);
      this.add.text(panel.x - 66, y + 4, hero.title, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: colorToCss(visual.accent)
      }).setOrigin(0, 0.5).setDepth(8);
      this.add.text(panel.x - 66, y + 32, `HP ${hero.maxHp} · DMG ${hero.damage} · RNG ${hero.range}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        color: colorToCss(COLORS.muted)
      }).setOrigin(0, 0.5).setDepth(8);
    });
  }

  private createFeaturePanel() {
    const panel = createGlassPanel(this, 1044, 405, 338, 440, COLORS.blue, 0.78).setDepth(5);
    this.add.text(panel.x, panel.y - 188, 'Что уже playable', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '25px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(6);

    const features = [
      ['⚔', 'SharedSimScene', 'один combat loop для client/server'],
      ['🎓', 'Tutorial', 'движение, атака, skills, tower, core'],
      ['🛡', 'Anti-cheat', 'event-log, action stream, stateHash'],
      ['🎨', 'Cosmetics', 'магазин скинов, buy/equip flow'],
      ['🏆', 'Meta', 'профиль, daily, leaderboard, рейтинг']
    ];

    features.forEach(([icon, title, text], index) => {
      const y = panel.y - 116 + index * 68;
      const accent = index % 2 === 0 ? COLORS.blue : COLORS.gold;
      this.add.circle(panel.x - 132, y, 22, accent, 0.18).setStrokeStyle(2, accent, 0.58).setDepth(7);
      this.add.text(panel.x - 132, y, icon, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: colorToCss(COLORS.white)
      }).setOrigin(0.5).setDepth(8);
      this.add.text(panel.x - 96, y - 14, title, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '16px',
        color: colorToCss(COLORS.white),
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0, 0.5).setDepth(8);
      this.add.text(panel.x - 96, y + 12, text, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '13px',
        color: colorToCss(0xcfd5ff),
        wordWrap: { width: 210 }
      }).setOrigin(0, 0.5).setDepth(8);
    });
  }

  private createCombatPreview() {
    const x = GAME_WIDTH / 2;
    const y = 405;
    const w = 474;
    const h = 440;
    const frame = createGlassPanel(this, x, y, w, h, COLORS.purple, 0.84).setDepth(5);

    this.add.text(frame.x, frame.y - 188, 'Live MOBA Snapshot', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '27px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(8);

    const arena = this.add.graphics().setDepth(7);
    const left = x - w / 2 + 38;
    const top = y - h / 2 + 70;
    const aw = w - 76;
    const ah = 276;
    arena.fillStyle(0x090719, 0.72);
    arena.fillRoundedRect(left, top, aw, ah, 28);
    arena.lineStyle(3, COLORS.white, 0.14);
    arena.strokeRoundedRect(left, top, aw, ah, 28);
    arena.lineStyle(32, 0x34265a, 0.72);
    arena.beginPath();
    arena.moveTo(left + 34, top + ah * 0.58);
    arena.lineTo(left + 126, top + ah * 0.54);
    arena.lineTo(left + 204, top + ah * 0.48);
    arena.lineTo(left + 292, top + ah * 0.54);
    arena.lineTo(left + aw - 34, top + ah * 0.50);
    arena.strokePath();
    arena.lineStyle(3, COLORS.gold, 0.28);
    arena.beginPath();
    arena.moveTo(left + 34, top + ah * 0.58);
    arena.lineTo(left + 126, top + ah * 0.54);
    arena.lineTo(left + 204, top + ah * 0.48);
    arena.lineTo(left + 292, top + ah * 0.54);
    arena.lineTo(left + aw - 34, top + ah * 0.50);
    arena.strokePath();
    arena.fillStyle(COLORS.blue, 0.12);
    arena.fillCircle(left + 50, top + ah * 0.57, 52);
    arena.fillStyle(COLORS.red, 0.12);
    arena.fillCircle(left + aw - 50, top + ah * 0.5, 52);

    const blueCore = this.createPreviewStructure(left + 50, top + ah * 0.57, 'CORE', COLORS.blue, 32);
    const redCore = this.createPreviewStructure(left + aw - 50, top + ah * 0.5, 'CORE', COLORS.red, 32);
    const blueTower = this.createPreviewStructure(left + 139, top + ah * 0.54, 'T1', COLORS.blue, 24);
    const redTower = this.createPreviewStructure(left + aw - 139, top + ah * 0.53, 'T1', COLORS.red, 24);

    const kairo = this.createPreviewActor(left + 172, top + ah * 0.62, COLORS.gold, 'Кайро', 25);
    const reyna = this.createPreviewActor(left + 205, top + ah * 0.44, COLORS.blue, 'Рэйна', 21);
    const teo = this.createPreviewActor(left + 118, top + ah * 0.72, COLORS.purple, 'Тэо', 20);
    const enemy = this.createPreviewActor(left + aw - 180, top + ah * 0.49, COLORS.red, 'Enemy', 24);
    const enemyMage = this.createPreviewActor(left + aw - 218, top + ah * 0.65, 0xff7aa8, 'Mage', 20);

    const blueMinions = [0, 1, 2].map((i) => this.createPreviewMinion(left + 212 + i * 24, top + ah * 0.58 + (i - 1) * 14, COLORS.blue));
    const redMinions = [0, 1, 2].map((i) => this.createPreviewMinion(left + aw - 230 - i * 24, top + ah * 0.52 + (i - 1) * 14, COLORS.red));

    this.previewBannerText = this.add.text(x, top + 20, 'FIGHT! SHARED SIM', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '21px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(80);

    this.previewHashText = this.add.text(x, y + 150, 'stateHash fnv1a32:preview · client/server ✓', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: colorToCss(COLORS.green)
    }).setOrigin(0.5).setDepth(8);

    const hud = this.add.container(x, y + 114).setDepth(8);
    const hudBg = this.add.rectangle(0, 0, aw, 44, 0x070512, 0.78).setStrokeStyle(2, COLORS.blue, 0.4);
    const hudText = this.add.text(0, 0, 'BLUE 2 : 1 RED · 04:12 · Lv.4 · Gold 920', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '16px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    hud.add([hudBg, hudText]);

    [kairo, reyna, teo, enemy, enemyMage, ...blueMinions, ...redMinions, blueCore, redCore, blueTower, redTower].forEach((obj, index) => {
      this.tweens.add({
        targets: obj,
        y: obj.y + (index % 2 ? -5 : 5),
        duration: 900 + index * 45,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });

    this.time.addEvent({
      delay: 1220,
      loop: true,
      callback: () => this.playPreviewBeat({ kairo, reyna, teo, enemy, enemyMage, redTower, redCore, left, top, aw, ah })
    });
  }

  private createPreviewStructure(x: number, y: number, label: string, color: number, size: number) {
    const c = this.add.container(x, y).setDepth(y + 20);
    const aura = this.add.circle(0, 0, size + 15, color, 0.12).setStrokeStyle(2, color, 0.44);
    const body = label === 'CORE'
      ? this.add.circle(0, 0, size, color, 0.86).setStrokeStyle(4, COLORS.white, 0.34)
      : this.add.rectangle(0, 0, size * 1.1, size * 1.6, color, 0.86).setStrokeStyle(3, COLORS.white, 0.32);
    const text = this.add.text(0, size + 19, label, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '11px',
      color: colorToCss(color),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    c.add([aura, body, text]);
    this.tweens.add({ targets: aura, scale: 1.14, alpha: 0.22, yoyo: true, repeat: -1, duration: 1100 });
    return c;
  }

  private createPreviewActor(x: number, y: number, color: number, label: string, size: number) {
    const c = this.add.container(x, y).setDepth(y + 40);
    const shadow = this.add.ellipse(0, size + 10, size * 2.4, size * 0.55, 0x000000, 0.32);
    const aura = this.add.circle(0, 0, size + 10, color, 0.14).setStrokeStyle(2, color, 0.46);
    const cloak = this.add.triangle(0, size * 0.35, -size * 0.75, size * 1.25, size * 0.75, size * 1.25, 0, -size * 0.85, color, 0.36);
    const body = this.add.ellipse(0, 0, size * 1.08, size * 1.42, color, 0.96).setStrokeStyle(3, COLORS.white, 0.48);
    const head = this.add.circle(0, -size * 0.9, size * 0.38, 0xffddc8, 0.95).setStrokeStyle(2, color, 0.72);
    const hair = this.add.triangle(0, -size * 1.24, -size * 0.52, -size * 0.82, 0, -size * 1.65, size * 0.52, -size * 0.82, color, 0.96);
    const blade = this.add.rectangle(size * 0.9, -size * 0.2, size * 1.55, 5, COLORS.white, 0.72).setRotation(-0.48);
    const name = this.add.text(0, -size * 2.22, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    const hpBg = this.add.rectangle(-size, -size * 1.82, size * 2, 5, 0x000000, 0.62).setOrigin(0, 0.5);
    const hpFill = this.add.rectangle(-size, -size * 1.82, size * 2, 5, COLORS.green, 0.9).setOrigin(0, 0.5);
    c.add([shadow, aura, cloak, body, head, hair, blade, name, hpBg, hpFill]);
    c.setData('hpFill', hpFill);
    c.setData('aura', aura);
    this.tweens.add({ targets: aura, scale: 1.2, alpha: 0.28, yoyo: true, repeat: -1, duration: 780 });
    return c;
  }

  private createPreviewMinion(x: number, y: number, color: number) {
    const c = this.add.container(x, y).setDepth(y + 20);
    const body = this.add.circle(0, 0, 8, color, 0.9).setStrokeStyle(1, COLORS.white, 0.3);
    const blade = this.add.rectangle(8, -2, 14, 3, COLORS.gold, 0.8).setRotation(-0.2);
    c.add([body, blade]);
    return c;
  }

  private playPreviewBeat(items: {
    kairo: Phaser.GameObjects.Container;
    reyna: Phaser.GameObjects.Container;
    teo: Phaser.GameObjects.Container;
    enemy: Phaser.GameObjects.Container;
    enemyMage: Phaser.GameObjects.Container;
    redTower: Phaser.GameObjects.Container;
    redCore: Phaser.GameObjects.Container;
    left: number;
    top: number;
    aw: number;
    ah: number;
  }) {
    this.previewStep = (this.previewStep + 1) % 4;
    const beats = [
      { text: 'Кайро врывается: PLASMA DASH', color: COLORS.gold, from: items.kairo, to: items.enemy },
      { text: 'Рэйна добивает цель: MOON SLASH', color: COLORS.blue, from: items.reyna, to: items.enemyMage },
      { text: 'Тэо ставит грозовую зону', color: COLORS.purple, from: items.teo, to: items.redTower },
      { text: 'RED TOWER DOWN · push core!', color: COLORS.red, from: items.kairo, to: items.redCore }
    ];
    const beat = beats[this.previewStep];
    this.previewBannerText?.setText(beat.text).setColor(colorToCss(beat.color)).setAlpha(1).setScale(1);
    this.tweens.add({ targets: this.previewBannerText, scale: 1.08, duration: 110, yoyo: true });
    this.spawnPreviewLine(beat.from.x, beat.from.y, beat.to.x, beat.to.y, beat.color);
    this.spawnPreviewBurst(beat.to.x, beat.to.y, beat.color);
    this.spawnPreviewDamage(beat.to.x + Phaser.Math.Between(-12, 12), beat.to.y - 38, this.previewStep === 3 ? 'OBJECTIVE!' : `-${Phaser.Math.Between(96, 220)}`, beat.color);
    const hpFill = beat.to.getData('hpFill') as Phaser.GameObjects.Rectangle | undefined;
    if (hpFill) {
      hpFill.scaleX = Phaser.Math.Clamp(0.95 - this.previewStep * 0.18, 0.28, 1);
      this.time.delayedCall(660, () => {
        if (hpFill.active) hpFill.scaleX = 0.88;
      });
    }
    const hashes = ['fnv1a32:e9a21a36', 'fnv1a32:4773866f', 'fnv1a32:adf1d542', 'fnv1a32:4d6329a5'];
    this.previewHashText?.setText(`stateHash ${hashes[this.previewStep]} · client/server ✓`);
  }

  private spawnPreviewLine(x1: number, y1: number, x2: number, y2: number, color: number) {
    const g = this.add.graphics().setDepth(120);
    g.lineStyle(10, color, 0.82);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    g.lineStyle(3, COLORS.white, 0.75);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private spawnPreviewBurst(x: number, y: number, color: number) {
    const ring = this.add.circle(x, y, 18, color, 0.36).setStrokeStyle(4, color, 0.88).setDepth(121);
    this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 430, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  private spawnPreviewDamage(x: number, y: number, text: string, color: number) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: text === 'OBJECTIVE!' ? '17px' : '20px',
      color: colorToCss(color),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(130);
    this.tweens.add({ targets: label, y: y - 34, alpha: 0, duration: 820, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  private createCallToAction() {
    const footer = createGlassPanel(this, GAME_WIDTH / 2, 662, 790, 82, COLORS.gold, 0.72).setDepth(50);
    this.add.text(footer.x - 338, footer.y, 'Готово к playtest: меню, матч, tutorial, shop, backend API', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(0xe5e8ff)
    }).setOrigin(0, 0.5).setDepth(51);

    createTextButton(this, GAME_WIDTH / 2 + 138, 662, 190, 48, 'Играть', async () => {
      await ensureApiSession();
      this.scene.start('HeroSelectScene');
    }, COLORS.gold).setDepth(80);

    createTextButton(this, GAME_WIDTH / 2 + 344, 662, 190, 48, 'Обучение', async () => {
      await ensureApiSession();
      this.scene.start('TutorialIntroScene');
    }, COLORS.blue).setDepth(80);

    createTextButton(this, GAME_WIDTH / 2 - 448, 662, 150, 48, 'Меню', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted).setDepth(80);

    this.add.text(GAME_WIDTH / 2, 710, 'Enter/Space — начать матч · Preview открывается первым экраном live demo', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5).setDepth(51);
  }
}


class MenuScene extends Phaser.Scene {
  private leaderboardLayer?: Phaser.GameObjects.Container;

  constructor() {
    super('MenuScene');
  }

  create() {
    drawShonenBackground(this);

    createPortraitFrame(this, 128, 414, 'portrait_kairo', 190, 250, HEROES[0].accent, 2);
    createPortraitFrame(this, 1152, 414, 'portrait_reyna', 190, 250, HEROES[1].accent, 2);
    createSmallHeroSilhouette(this, 1010, 246, HEROES[2], 0.56).setAlpha(0.72).setDepth(2);

    createTextButton(this, GAME_WIDTH - 100, 44, 160, 42, 'Превью', () => {
      this.scene.start('PreviewScene');
    }, COLORS.purple);

    this.add.text(GAME_WIDTH / 2, 96, 'SHONEN RIFT', {
      fontFamily: 'Arial Black, Impact, sans-serif',
      fontSize: '76px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white),
      stroke: '#ff416b',
      strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 0, color: '#36d6ff', blur: 18, fill: true }
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 158, 'Telegram Arena Prototype', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      color: colorToCss(COLORS.gold)
    }).setOrigin(0.5);

    const runtimeLabel = tgRuntime.inTelegram
      ? `Telegram Mini App · ${tgRuntime.platform}`
      : 'Browser preview · Telegram-ready shell';

    this.add.text(GAME_WIDTH / 2, 202, runtimeLabel, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);

    const apiStatus = this.add.text(GAME_WIDTH / 2, 232, 'API: подключение...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      color: colorToCss(COLORS.gold)
    }).setOrigin(0.5);

    const profileStatus = this.add.text(GAME_WIDTH / 2, 258, profileLine(), {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      color: colorToCss(0xcfd5ff)
    }).setOrigin(0.5);

    ensureApiSession().then(async () => {
      if (sharedState.session && sharedState.shopSkins.length === 0) await loadShopSkins();
      if (!apiStatus.active || !profileStatus.active) return;
      apiStatus.setText(apiStatusLine());
      apiStatus.setColor(colorToCss(sharedState.apiOnline ? COLORS.green : COLORS.red));
      profileStatus.setText(profileLine());
    });

    const frame = createGlassPanel(this, GAME_WIDTH / 2, 402, 790, 206, COLORS.blue, 0.82);

    this.add.text(frame.x, frame.y - 60, '3v3 bot arena · backend-ready · оригинальные shonen-герои', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '25px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white)
    }).setOrigin(0.5);

    this.add.text(frame.x, frame.y - 8,
      'Клиент теперь отправляет старт/результат матча на API.\nБот Telegram открывает игру, профиль, daily-награду и лидерборд.',
      {
        fontFamily: 'Arial, sans-serif',
        fontSize: '19px',
        align: 'center',
        lineSpacing: 8,
        color: colorToCss(0xcfd5ff)
      }
    ).setOrigin(0.5);

    createTextButton(this, GAME_WIDTH / 2 - 165, 520, 300, 58, 'Играть', () => {
      this.scene.start('HeroSelectScene');
    }, COLORS.gold);

    createTextButton(this, GAME_WIDTH / 2 + 165, 520, 300, 58, 'Обучение', () => {
      this.scene.start('TutorialIntroScene');
    }, COLORS.blue);

    const tutorialHint = sharedState.profile?.tutorial?.completed
      ? 'Tutorial пройден'
      : 'Новичкам: начните с обучения';
    this.add.text(GAME_WIDTH / 2, 562, tutorialHint, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(sharedState.profile?.tutorial?.completed ? COLORS.muted : COLORS.green)
    }).setOrigin(0.5);

    createTextButton(this, GAME_WIDTH / 2 - 300, 616, 230, 46, 'Профиль', () => {
      this.scene.start('ProfileScene');
    }, COLORS.blue);

    createTextButton(this, GAME_WIDTH / 2 - 60, 616, 230, 46, 'Магазин', () => {
      this.scene.start('ShopScene');
    }, COLORS.purple);

    createTextButton(this, GAME_WIDTH / 2 + 180, 616, 230, 46, 'Daily', async () => {
      await this.claimDaily(profileStatus);
    }, COLORS.green);

    createTextButton(this, GAME_WIDTH / 2 + 420, 616, 230, 46, 'Рейтинг', async () => {
      await this.openLeaderboard();
    }, COLORS.gold);

    this.add.text(GAME_WIDTH / 2, 682, 'ПК: WASD/стрелки · J атака · K/L навыки · Space ультимейт', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);
  }

  private async claimDaily(profileStatus: Phaser.GameObjects.Text) {
    await ensureApiSession();
    if (!sharedState.session) {
      showUiToast(this, GAME_WIDTH / 2, 590, 'Backend недоступен: daily работает только через API', COLORS.red);
      return;
    }

    const result = await apiClaimDaily(sharedState.session.token);
    if (!result) {
      showUiToast(this, GAME_WIDTH / 2, 590, 'Не удалось получить награду', COLORS.red);
      return;
    }

    sharedState.profile = result.user;
    profileStatus.setText(profileLine());
    showUiToast(this, GAME_WIDTH / 2, 590, result.message, result.claimed ? COLORS.green : COLORS.gold);
  }

  private async openLeaderboard() {
    const rows = await apiGetLeaderboard(10);
    this.showLeaderboard(rows);
  }

  private showLeaderboard(rows: LeaderboardEntry[]) {
    this.leaderboardLayer?.destroy();
    const layer = this.add.container(0, 0).setDepth(4000);
    this.leaderboardLayer = layer;

    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setInteractive();
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 620, 480, COLORS.panel, 0.98)
      .setStrokeStyle(3, COLORS.gold, 0.85);
    const title = this.add.text(panel.x, panel.y - 196, 'Лидерборд', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '38px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5);

    const content = rows.length
      ? rows.map((row, index) => {
        const name = row.username ? `@${row.username}` : row.firstName;
        return `${index + 1}. ${name} — ${row.rating} RP · W ${row.wins}/${row.matches} · K/D ${row.kills}/${row.deaths}`;
      }).join('\n')
      : 'Пока пусто. Сыграйте матч, чтобы попасть в рейтинг.';

    const list = this.add.text(panel.x - 260, panel.y - 130, content, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '20px',
      color: colorToCss(0xe5e8ff),
      lineSpacing: 12,
      wordWrap: { width: 520 }
    }).setOrigin(0, 0);

    const close = createTextButton(this, panel.x, panel.y + 190, 220, 52, 'Закрыть', () => {
      this.leaderboardLayer?.destroy();
      this.leaderboardLayer = undefined;
    }, COLORS.red);
    close.setDepth(4001);

    layer.add([dim, panel, title, list, close]);
  }
}

class TutorialIntroScene extends Phaser.Scene {
  constructor() {
    super('TutorialIntroScene');
  }

  create() {
    drawShonenBackground(this);
    createPortraitFrame(this, 178, 390, 'portrait_kairo', 230, 300, HEROES[0].accent, 2);
    createSmallHeroSilhouette(this, 1050, 415, HEROES[1], 0.86);

    this.add.text(GAME_WIDTH / 2, 82, 'Обучение', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '58px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 7,
      shadow: { offsetX: 0, offsetY: 0, color: '#36d6ff', blur: 16, fill: true }
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 134, 'Короткий guided-match: движение, атака, способности, башня и ядро', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '20px',
      color: colorToCss(COLORS.gold)
    }).setOrigin(0.5);

    const panel = createGlassPanel(this, GAME_WIDTH / 2, 354, 720, 330, COLORS.blue, 0.88).setDepth(5);
    const tips = [
      '1. Двигайтесь к светящемуся маркеру: джойстик слева или WASD.',
      '2. Нажмите АТК или J, чтобы атаковать тренировочного врага.',
      '3. Используйте K и L — обычные способности героя.',
      '4. Нажмите Space или ULT, чтобы активировать ультимейт.',
      '5. Разрушьте безопасную учебную башню — она стоит перед ядром.',
      '6. Добейте учебное красное ядро и получите награду за первое обучение.'
    ].join('\n\n');

    this.add.text(panel.x - 310, panel.y - 135, tips, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '21px',
      color: colorToCss(0xe5e8ff),
      lineSpacing: 2,
      wordWrap: { width: 620 }
    }).setOrigin(0, 0).setDepth(6);

    const already = sharedState.profile?.tutorial?.completed || localStorage.getItem('shonen-rift-tutorial-completed') === 'true';
    this.add.text(GAME_WIDTH / 2, 553, already ? 'Обучение уже пройдено — можно повторить без повторной награды.' : 'Награда за первое прохождение: 120 искр', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '20px',
      color: colorToCss(already ? COLORS.muted : COLORS.green),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    createTextButton(this, GAME_WIDTH / 2 - 240, 628, 260, 58, 'Назад', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted);

    createTextButton(this, GAME_WIDTH / 2 + 70, 628, 320, 58, 'Начать обучение', async () => {
      sharedState.selectedHeroId = sharedState.selectedHeroId || 'kairo';
      sharedState.currentMatchId = null;
      sharedState.currentMatchSeed = null;
      sharedState.currentMatchValidationToken = null;
      await ensureApiSession();
      if (sharedState.session && sharedState.shopSkins.length === 0) await loadShopSkins();
      this.scene.start('SharedSimScene', { heroId: sharedState.selectedHeroId, tutorial: true });
    }, COLORS.gold);
  }
}


class ProfileScene extends Phaser.Scene {
  private detailsText?: Phaser.GameObjects.Text;
  private apiText?: Phaser.GameObjects.Text;

  constructor() {
    super('ProfileScene');
  }

  create() {
    drawShonenBackground(this);

    this.add.text(GAME_WIDTH / 2, 70, 'Профиль игрока', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '46px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5);

    this.apiText = this.add.text(GAME_WIDTH / 2, 112, apiStatusLine(), {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(sharedState.apiOnline ? COLORS.green : COLORS.gold)
    }).setOrigin(0.5);

    const panel = this.add.rectangle(GAME_WIDTH / 2, 345, 760, 360, COLORS.panel, 0.94)
      .setStrokeStyle(3, COLORS.blue, 0.72);

    this.detailsText = this.add.text(panel.x - 330, panel.y - 140, 'Загрузка профиля...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '23px',
      color: colorToCss(0xe5e8ff),
      lineSpacing: 14,
      wordWrap: { width: 660 }
    }).setOrigin(0, 0);

    this.renderProfile(sharedState.profile);
    Promise.all([refreshProfile(), loadShopSkins()]).then(([profile]) => {
      if (!this.detailsText?.active) return;
      this.apiText?.setText(apiStatusLine());
      this.apiText?.setColor(colorToCss(sharedState.apiOnline ? COLORS.green : COLORS.red));
      this.renderProfile(profile);
    });

    createTextButton(this, GAME_WIDTH / 2 - 300, 606, 220, 54, 'Назад', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted);
    createTextButton(this, GAME_WIDTH / 2 - 65, 606, 220, 54, 'Играть', () => {
      this.scene.start('HeroSelectScene');
    }, COLORS.gold);
    createTextButton(this, GAME_WIDTH / 2 + 170, 606, 220, 54, 'Магазин', () => {
      this.scene.start('ShopScene');
    }, COLORS.purple);
    createTextButton(this, GAME_WIDTH / 2 + 405, 606, 220, 54, 'Daily', async () => {
      await this.claimDaily();
    }, COLORS.green);
  }

  private renderProfile(profile?: PlayerProfile) {
    if (!this.detailsText) return;
    if (!profile) {
      this.detailsText.setText(
        'Профиль пока недоступен.\n\nЗапустите backend API или откройте игру через Telegram Mini App.\nВ offline mode результаты боя всё равно сохраняются локально.'
      );
      return;
    }

    const stats = profile.stats;
    const winRate = stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0;
    const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(2);
    const equipped = HEROES.map((hero) => {
      const skinId = profile.inventory.selectedSkinByHero?.[hero.id];
      const skin = sharedState.shopSkins.find((item) => item.id === skinId);
      return `${hero.name}: ${skin?.name ?? 'Стандартный образ'}`;
    }).join('\n');

    this.detailsText.setText(
      `👤 ${profile.firstName}${profile.username ? ` · @${profile.username}` : ''}\n` +
      `⭐ Рейтинг: ${stats.rating}\n` +
      `💠 Искры: ${profile.inventory.soft}\n` +
      `🎮 Матчи: ${stats.matches} · Победы: ${stats.wins} · Winrate: ${winRate}%\n` +
      `⚔️ K/D: ${stats.kills}/${stats.deaths} (${kd})\n` +
      `⏱ Лучшее время победы: ${stats.bestTimeSec ? fmtTime(stats.bestTimeSec) : 'нет'}\n` +
      `🔥 Daily streak: ${profile.daily.streak} дн.\n` +
      `🎓 Обучение: ${profile.tutorial?.completed ? 'пройдено' : 'не пройдено'}\n\n` +
      `Экипированные образы:\n${equipped}`
    );
  }

  private async claimDaily() {
    await ensureApiSession();
    if (!sharedState.session) {
      showUiToast(this, GAME_WIDTH / 2, 590, 'Backend недоступен', COLORS.red);
      return;
    }
    const result = await apiClaimDaily(sharedState.session.token);
    if (!result) {
      showUiToast(this, GAME_WIDTH / 2, 590, 'Не удалось получить daily', COLORS.red);
      return;
    }
    sharedState.profile = result.user;
    this.renderProfile(result.user);
    showUiToast(this, GAME_WIDTH / 2, 590, result.message, result.claimed ? COLORS.green : COLORS.gold);
  }
}

class ShopScene extends Phaser.Scene {
  private walletText?: Phaser.GameObjects.Text;
  private loadingText?: Phaser.GameObjects.Text;

  constructor() {
    super('ShopScene');
  }

  create() {
    drawShonenBackground(this);

    this.add.text(GAME_WIDTH / 2, 56, 'Магазин скинов', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '46px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 96, 'Только косметика: без pay-to-win, сила героя не меняется', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);

    this.walletText = this.add.text(GAME_WIDTH - 120, 54, 'Искры: ...', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(1, 0.5);

    this.loadingText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Загрузка магазина...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '24px',
      color: colorToCss(0xe5e8ff)
    }).setOrigin(0.5);

    this.updateWallet();

    loadShopSkins().then(() => {
      if (!this.scene.isActive('ShopScene')) return;
      this.renderShop();
    });

    createTextButton(this, 130, 58, 190, 50, 'Назад', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted);

    createTextButton(this, 345, 58, 190, 50, 'Профиль', () => {
      this.scene.start('ProfileScene');
    }, COLORS.blue);
  }

  private updateWallet() {
    this.walletText?.setText(`Искры: ${sharedState.profile?.inventory.soft ?? 0}`);
  }

  private renderShop() {
    this.loadingText?.destroy();
    this.updateWallet();

    if (!sharedState.session) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Backend недоступен. Магазин работает только через API.', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: colorToCss(COLORS.red),
        align: 'center'
      }).setOrigin(0.5);
      return;
    }

    const skins = sharedState.shopSkins;
    const cardW = 360;
    const cardH = 205;
    const startX = 250;
    const startY = 230;

    skins.forEach((skin, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      this.createSkinCard(startX + col * 390, startY + row * 235, cardW, cardH, skin);
    });

    this.createDefaultSkinPanel();
  }

  private createDefaultSkinPanel() {
    const y = 655;
    this.add.text(170, y, 'Стандартный образ:', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0, 0.5);

    HEROES.forEach((hero, i) => {
      createTextButton(this, 425 + i * 190, y, 170, 42, hero.name, async () => {
        await this.equipDefault(hero.id);
      }, hero.color);
    });
  }

  private createSkinCard(x: number, y: number, width: number, height: number, skin: ShopSkin) {
    const rarityColor = skin.rarity === 'epic' ? COLORS.purple : COLORS.blue;
    const bg = this.add.rectangle(x, y, width, height, COLORS.panel, 0.95)
      .setStrokeStyle(2, skin.equipped ? COLORS.gold : rarityColor, skin.equipped ? 1 : 0.65);

    const preview = this.add.container(x - width / 2 + 62, y - 32);
    const aura = this.add.circle(0, 0, 42, skin.color, 0.18).setStrokeStyle(3, skin.accent, 0.72);
    const body = this.add.circle(0, 0, 25, skin.color, 0.96).setStrokeStyle(4, COLORS.white, 0.55);
    const head = this.add.circle(0, -28, 13, skin.accent, 0.96).setStrokeStyle(2, COLORS.white, 0.45);
    const blade = this.add.rectangle(30, -4, 52, 6, skin.accent, 0.95).setRotation(-0.5);
    preview.add([aura, body, head, blade]);
    this.tweens.add({ targets: aura, scale: 1.2, alpha: 0.34, yoyo: true, repeat: -1, duration: 980 });

    const ownedLabel = skin.equipped ? 'ЭКИПИРОВАН' : skin.owned ? 'КУПЛЕН' : `${skin.price} искр`;
    this.add.text(x - width / 2 + 122, y - 78, `${skin.heroName} · ${skin.rarity.toUpperCase()}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(rarityColor)
    }).setOrigin(0, 0.5);

    this.add.text(x - width / 2 + 122, y - 48, skin.name, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '21px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0, 0.5);

    this.add.text(x - width / 2 + 24, y + 22, skin.description, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(0xd7dcff),
      wordWrap: { width: width - 48 },
      lineSpacing: 5
    }).setOrigin(0, 0.5);

    this.add.text(x + width / 2 - 24, y - 78, ownedLabel, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(skin.equipped ? COLORS.gold : skin.owned ? COLORS.green : COLORS.gold),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(1, 0.5);

    const actionLabel = skin.equipped ? 'Активен' : skin.owned ? 'Экипировать' : 'Купить';
    createTextButton(this, x + width / 2 - 98, y + height / 2 - 34, 170, 42, actionLabel, async () => {
      await this.handleSkinAction(skin);
    }, skin.equipped ? COLORS.gold : skin.owned ? COLORS.green : rarityColor);
  }

  private async handleSkinAction(skin: ShopSkin) {
    if (skin.equipped) {
      showUiToast(this, GAME_WIDTH / 2, 610, 'Этот скин уже экипирован', COLORS.gold);
      return;
    }

    await ensureApiSession();
    if (!sharedState.session) {
      showUiToast(this, GAME_WIDTH / 2, 610, 'Backend недоступен', COLORS.red);
      return;
    }

    const response = skin.owned
      ? await apiEquipSkin(sharedState.session.token, skin.heroId, skin.id)
      : await apiBuySkin(sharedState.session.token, skin.id);

    if (!response) {
      showUiToast(this, GAME_WIDTH / 2, 610, 'Ошибка запроса', COLORS.red);
      return;
    }

    if (response.user) sharedState.profile = response.user;
    if (response.skins) sharedState.shopSkins = response.skins;

    showUiToast(this, GAME_WIDTH / 2, 610, response.message ?? response.error ?? 'Готово', response.ok ? COLORS.green : COLORS.red);
    if (response.ok) this.time.delayedCall(420, () => this.scene.restart());
  }

  private async equipDefault(heroId: string) {
    await ensureApiSession();
    if (!sharedState.session) {
      showUiToast(this, GAME_WIDTH / 2, 610, 'Backend недоступен', COLORS.red);
      return;
    }

    const response = await apiEquipSkin(sharedState.session.token, heroId, null);
    if (response?.user) sharedState.profile = response.user;
    if (response?.skins) sharedState.shopSkins = response.skins;
    showUiToast(this, GAME_WIDTH / 2, 610, response?.message ?? 'Стандартный образ выбран', response?.ok ? COLORS.green : COLORS.red);
    if (response?.ok) this.time.delayedCall(420, () => this.scene.restart());
  }
}


class HeroSelectScene extends Phaser.Scene {
  private selectedId = sharedState.selectedHeroId;

  constructor() {
    super('HeroSelectScene');
  }

  create() {
    drawShonenBackground(this);

    ensureApiSession().then(async () => {
      if (sharedState.session && sharedState.shopSkins.length === 0) {
        await loadShopSkins();
        if (this.scene.isActive('HeroSelectScene')) this.scene.restart();
      }
    });

    this.add.text(GAME_WIDTH / 2, 68, 'Выбор героя', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '44px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 112, 'Оригинальные герои в духе shonen action', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '19px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);

    const cardWidth = 342;
    const startX = GAME_WIDTH / 2 - cardWidth - 28;

    HEROES.forEach((hero, index) => {
      this.createHeroCard(startX + index * (cardWidth + 28), 346, cardWidth, 410, hero);
    });

    createTextButton(this, GAME_WIDTH / 2 - 310, 654, 220, 56, 'Назад', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted);
    createTextButton(this, GAME_WIDTH / 2, 654, 260, 56, 'Начать матч', async () => {
      sharedState.selectedHeroId = this.selectedId;
      await prepareServerMatch(this.selectedId);
      this.scene.start('SharedSimScene', { heroId: this.selectedId });
    }, COLORS.gold);
    this.add.text(GAME_WIDTH / 2 + 320, 654, 'Основной бой и tutorial: shared sim\nClassic скрыт как dev fallback', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(COLORS.muted),
      align: 'center',
      wordWrap: { width: 280 }
    }).setOrigin(0.5);
  }

  private createHeroCard(x: number, y: number, width: number, height: number, hero: HeroConfig) {
    const visual = heroVisual(hero, true);
    const isSelected = () => this.selectedId === hero.id;
    const container = this.add.container(x, y).setDepth(20);
    const bg = this.add.rectangle(0, 0, width, height, COLORS.panel, 0.94)
      .setStrokeStyle(isSelected() ? 4 : 2, isSelected() ? COLORS.gold : visual.color, isSelected() ? 1 : 0.58)
      .setInteractive({ useHandCursor: true });

    const glow = this.add.rectangle(0, -86, 184, 184, visual.color, 0.12)
      .setStrokeStyle(4, visual.accent, 0.48);
    const avatar = this.add.container(0, -86);
    const aura = this.add.circle(0, 0, 92, visual.color, 0.08).setStrokeStyle(3, visual.accent, 0.62);
    const portraitKey = `portrait_${hero.id}`;
    if (this.textures.exists(portraitKey)) {
      const portrait = this.add.image(0, 0, portraitKey).setDisplaySize(170, 170);
      const vignette = this.add.rectangle(0, 66, 170, 38, 0x000000, 0.38);
      const edgeTop = this.add.rectangle(0, -86, 160, 4, COLORS.white, 0.26);
      const edgeBottom = this.add.rectangle(0, 86, 160, 4, visual.accent, 0.62);
      avatar.add([aura, portrait, vignette, edgeTop, edgeBottom]);
    } else {
      const body = this.add.circle(0, 0, 42, visual.color, 1).setStrokeStyle(5, 0xffffff, 0.85);
      const head = this.add.circle(0, -43, 22, visual.accent, 1).setStrokeStyle(3, 0xffffff, 0.7);
      const slash = this.add.rectangle(34, -12, 92, 8, visual.accent, 0.88).setRotation(-0.58);
      avatar.add([aura, body, head, slash]);
    }

    const title = this.add.text(0, 28, hero.name, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '34px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    const subtitle = this.add.text(0, 66, visual.skinName ? `${hero.title} · ${visual.skinName}` : hero.title, {
      fontFamily: 'Arial, sans-serif',
      fontSize: visual.skinName ? '16px' : '18px',
      color: colorToCss(visual.accent)
    }).setOrigin(0.5);

    const role = this.add.text(0, 104, hero.role, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.gold)
    }).setOrigin(0.5);

    const desc = this.add.text(0, 158, hero.description, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      align: 'center',
      wordWrap: { width: width - 46 },
      lineSpacing: 6,
      color: colorToCss(0xd7dcff)
    }).setOrigin(0.5);

    const stats = this.add.text(0, 240, `HP ${hero.maxHp}   DMG ${hero.damage}   RNG ${hero.range}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);

    const badge = this.add.text(0, height / 2 - 32, isSelected() ? 'ВЫБРАН' : 'Нажмите, чтобы выбрать', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      fontStyle: 'bold',
      color: colorToCss(isSelected() ? COLORS.gold : COLORS.muted)
    }).setOrigin(0.5);

    const refresh = () => {
      const selected = isSelected();
      bg.setStrokeStyle(selected ? 4 : 2, selected ? COLORS.gold : visual.color, selected ? 1 : 0.58);
      badge.setText(selected ? 'ВЫБРАН' : 'Нажмите, чтобы выбрать');
      badge.setColor(colorToCss(selected ? COLORS.gold : COLORS.muted));
    };

    bg.on('pointerdown', () => {
      haptic('light');
      this.selectedId = hero.id;
      this.children.each((child) => {
        const dataRefresh = child.getData?.('refreshCard') as (() => void) | undefined;
        dataRefresh?.();
        return true;
      });
    });

    container.setData('refreshCard', refresh);
    container.add([bg, glow, avatar, title, subtitle, role, desc, stats, badge]);
  }
}

class ResultScene extends Phaser.Scene {
  constructor() {
    super('ResultScene');
  }

  create() {
    drawShonenBackground(this);
    const result = sharedState.lastResult;

    const victory = result?.victory ?? false;
    const header = victory ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    const accent = victory ? COLORS.gold : COLORS.red;

    this.add.text(GAME_WIDTH / 2, 120, header, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '78px',
      color: colorToCss(COLORS.white),
      stroke: colorToCss(accent),
      strokeThickness: 9,
      shadow: { offsetX: 0, offsetY: 0, color: colorToCss(accent), blur: 22, fill: true }
    }).setOrigin(0.5);

    const panel = this.add.rectangle(GAME_WIDTH / 2, 344, 760, 288, COLORS.panel, 0.93)
      .setStrokeStyle(3, accent, 0.82);

    if (result?.heroId) {
      createPortraitFrame(this, panel.x - 255, panel.y - 14, `portrait_${result.heroId}`, 190, 220, accent, 10);
    }

    const lines = result
      ? [
        result.tutorial ? 'Режим: обучение' : 'Режим: 3v3 bot arena',
        `Герой: ${result.heroName}`,
        `Время: ${fmtTime(result.durationSec)}`,
        `K/D: ${result.kills}/${result.deaths}`,
        `Уровень: ${result.level}`,
        result.tutorial ? 'Награда: 120 искр за первое прохождение' : `Золото: ${result.gold}`
      ]
      : ['Нет данных матча'];

    this.add.text(panel.x + 118, panel.y - 28, lines.join('\n'), {
      fontFamily: 'Arial, sans-serif',
      fontSize: '25px',
      align: 'center',
      lineSpacing: 10,
      color: colorToCss(0xe5e8ff)
    }).setOrigin(0.5);

    this.add.text(panel.x + 118, panel.y + 104, `${apiStatusLine()} · ${profileLine()}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: colorToCss(sharedState.apiOnline ? COLORS.green : COLORS.muted),
      align: 'center',
      wordWrap: { width: 510 }
    }).setOrigin(0.5);

    const syncText = this.add.text(panel.x + 118, panel.y + 137, sharedState.resultSyncMessage ?? '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(sharedState.resultSyncStatus === 'rejected' ? COLORS.red : sharedState.resultSyncStatus === 'saved' ? COLORS.green : COLORS.gold),
      align: 'center',
      wordWrap: { width: 510 }
    }).setOrigin(0.5);
    this.time.delayedCall(650, () => {
      if (!syncText.active) return;
      syncText.setText(sharedState.resultSyncMessage ?? '');
      syncText.setColor(colorToCss(sharedState.resultSyncStatus === 'rejected' ? COLORS.red : sharedState.resultSyncStatus === 'saved' ? COLORS.green : COLORS.gold));
    });

    createTextButton(this, GAME_WIDTH / 2 - 170, 572, 260, 60, 'Выбор героя', () => {
      this.scene.start('HeroSelectScene');
    }, COLORS.blue);
    createTextButton(this, GAME_WIDTH / 2 + 170, 572, 260, 60, result?.tutorial ? 'Повторить tutorial' : 'Реванш', async () => {
      const tutorial = Boolean(result?.tutorial);
      if (!tutorial) await prepareServerMatch(sharedState.selectedHeroId);
      else {
        sharedState.currentMatchId = null;
        sharedState.currentMatchSeed = null;
        sharedState.currentMatchValidationToken = null;
      }
      this.scene.start('SharedSimScene', { heroId: sharedState.selectedHeroId, tutorial });
    }, COLORS.gold);
  }
}


class SharedSimScene extends Phaser.Scene {
  private simState: unknown;
  private snapshot?: RenderCombatSnapshot;
  private selectedHero!: HeroConfig;
  private tutorialMode = false;
  private tutorialStep = 0;
  private tutorialCompleted = false;
  private tutorialActions: Record<TutorialAction, boolean> = { move: false, attack: false, primary: false, secondary: false, ultimate: false, tower: false, core: false };
  private tutorialLayer?: Phaser.GameObjects.Container;
  private tutorialMarker?: Phaser.GameObjects.Arc;
  private tutorialProgressText?: Phaser.GameObjects.Text;
  private tutorialInstructionText?: Phaser.GameObjects.Text;
  private actorViews = new Map<string, SharedSimActorView>();
  private projectileViews = new Map<string, Phaser.GameObjects.Arc>();
  private zoneViews = new Map<string, Phaser.GameObjects.Arc>();
  private actionStreamActions: SharedAction[] = [];
  private queuedActions: SharedAction[] = [];
  private actionSeq = 0;
  private accumulatorMs = 0;
  private lastMoveActionAt = -999999;
  private lastInput = { dx: 0, dy: 0 };
  private lastAttackActionAt = -999999;
  private lastCastActionAt: Record<AbilitySlot, number> = { primary: -999999, secondary: -999999, ultimate: -999999 };
  private processedEventSeq = -1;
  private sharedButtons: AbilityButton[] = [];
  private matchOver = false;
  private matchStartedAtClientMs = 0;
  private controls!: Record<string, Phaser.Input.Keyboard.Key>;
  private joystickActive = false;
  private joystickPointerId = -1;
  private joystickOrigin = new Phaser.Math.Vector2(0, 0);
  private joystickVector = new Phaser.Math.Vector2(0, 0);
  private joystickBase!: Phaser.GameObjects.Arc;
  private joystickKnob!: Phaser.GameObjects.Arc;
  private hudText!: Phaser.GameObjects.Text;
  private hashText!: Phaser.GameObjects.Text;
  private tipText!: Phaser.GameObjects.Text;
  private killFeedText!: Phaser.GameObjects.Text;
  private objectiveBannerText!: Phaser.GameObjects.Text;

  constructor() {
    super('SharedSimScene');
  }

  create(data: { heroId?: string; tutorial?: boolean }) {
    this.selectedHero = heroById(data.heroId ?? sharedState.selectedHeroId);
    sharedState.selectedHeroId = this.selectedHero.id;
    this.tutorialMode = Boolean(data.tutorial);
    this.tutorialStep = 0;
    this.tutorialCompleted = false;
    this.tutorialActions = { move: false, attack: false, primary: false, secondary: false, ultimate: false, tower: false, core: false };
    this.matchOver = false;
    this.accumulatorMs = 0;
    this.lastMoveActionAt = -999999;
    this.lastInput = { dx: 0, dy: 0 };
    this.lastAttackActionAt = -999999;
    this.lastCastActionAt = { primary: -999999, secondary: -999999, ultimate: -999999 };
    this.processedEventSeq = -1;
    this.sharedButtons = [];
    this.actionSeq = 0;
    this.actionStreamActions = [];
    this.queuedActions = [];
    this.matchStartedAtClientMs = Date.now();
    sharedState.resultSyncStatus = undefined;
    sharedState.resultSyncMessage = undefined;
    if (this.tutorialMode) {
      sharedState.currentMatchId = null;
      sharedState.currentMatchSeed = null;
      sharedState.currentMatchValidationToken = null;
    }

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.simState = createInitialCombatState({
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed ?? (this.tutorialMode ? 777 : 1),
      tutorial: this.tutorialMode
    });
    this.snapshot = renderCombatSnapshot(this.simState);

    this.drawSharedArena();
    this.createSharedInput();
    this.createSharedHud();
    this.enqueueAction('match_start', {
      x: this.snapshot.actors.find((actor) => actor.id === this.snapshot?.playerId)?.x ?? 320,
      y: this.snapshot.actors.find((actor) => actor.id === this.snapshot?.playerId)?.y ?? 570,
      data: {
        matchId: sharedState.currentMatchId,
        seed: sharedState.currentMatchSeed,
        heroId: this.selectedHero.id,
        mode: this.tutorialMode ? 'shared-sim-tutorial' : 'shared-sim-client'
      }
    });

    if (this.tutorialMode) this.createSharedTutorialOverlay();

    this.renderSharedSnapshot(this.snapshot);
    this.updateSharedHud(this.snapshot);
    this.updateSharedControlButtons(this.snapshot);
    if (this.tutorialMode) this.setSharedTutorialStep(0);
    const playerView = this.actorViews.get(this.snapshot.playerId ?? '');
    if (playerView) this.cameras.main.startFollow(playerView.container, true, 0.14, 0.14);
    this.cameras.main.setZoom(1);
  }

  update(_time: number, delta: number) {
    if (this.matchOver || !this.snapshot) return;
    this.collectContinuousInput();

    this.accumulatorMs += delta;
    while (this.accumulatorMs >= 100 && !this.matchOver) {
      const actions = this.queuedActions.splice(0);
      this.snapshot = stepCombatState(this.simState, actions);
      this.renderSharedSnapshot(this.snapshot);
      this.consumeSharedEvents(this.snapshot);
      this.updateSharedHud(this.snapshot);
      this.updateSharedControlButtons(this.snapshot);
      if (this.tutorialMode) this.updateSharedTutorial(this.snapshot);
      this.accumulatorMs -= 100;

      if (this.snapshot.winner || (!this.tutorialMode && this.snapshot.timeMs >= 10 * 60 * 1000)) {
        this.finishSharedSimMatch(this.snapshot.winner ?? this.snapshot.result.winner);
      }
    }
  }

  private drawSharedArena() {
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x071021, 0x160824, 0x0b1b2d, 0x231145, 1);
    g.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    g.lineStyle(54, 0x171b36, 0.72);
    g.beginPath();
    g.moveTo(BLUE_PATH[0].x, BLUE_PATH[0].y);
    for (const point of BLUE_PATH.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    g.lineStyle(5, COLORS.gold, 0.28);
    g.beginPath();
    g.moveTo(BLUE_PATH[0].x, BLUE_PATH[0].y);
    for (const point of BLUE_PATH.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    g.fillStyle(COLORS.blue, 0.16);
    g.fillCircle(190, 600, 170);
    g.fillStyle(COLORS.red, 0.16);
    g.fillCircle(2010, 600, 170);

    for (const point of BLUE_PATH) {
      g.lineStyle(2, COLORS.white, 0.15);
      g.strokeCircle(point.x, point.y, 28);
      g.fillStyle(COLORS.purple, 0.1);
      g.fillCircle(point.x, point.y, 18);
    }
  }

  private createSharedInput() {
    if (this.input.keyboard) {
      this.controls = this.input.keyboard.addKeys({
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
        UP: Phaser.Input.Keyboard.KeyCodes.UP,
        LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
        DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
        RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        J: Phaser.Input.Keyboard.KeyCodes.J,
        K: Phaser.Input.Keyboard.KeyCodes.K,
        L: Phaser.Input.Keyboard.KeyCodes.L,
        SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
      }) as Record<string, Phaser.Input.Keyboard.Key>;
    }

    this.joystickBase = this.add.circle(112, GAME_HEIGHT - 112, 68, 0x000000, 0.26)
      .setStrokeStyle(3, COLORS.blue, 0.52)
      .setScrollFactor(0)
      .setDepth(1800)
      .setInteractive(new Phaser.Geom.Circle(0, 0, 86), Phaser.Geom.Circle.Contains);
    this.joystickKnob = this.add.circle(112, GAME_HEIGHT - 112, 28, COLORS.blue, 0.55)
      .setStrokeStyle(3, COLORS.white, 0.45)
      .setScrollFactor(0)
      .setDepth(1801);

    const startJoystick = (pointer: Phaser.Input.Pointer) => {
      if (pointer.x > GAME_WIDTH * 0.45) return;
      this.joystickActive = true;
      this.joystickPointerId = pointer.id;
      this.joystickOrigin.set(pointer.x, pointer.y);
      this.joystickBase.setPosition(pointer.x, pointer.y);
      this.joystickKnob.setPosition(pointer.x, pointer.y);
    };
    const moveJoystick = (pointer: Phaser.Input.Pointer) => {
      if (!this.joystickActive || pointer.id !== this.joystickPointerId) return;
      const dx = pointer.x - this.joystickOrigin.x;
      const dy = pointer.y - this.joystickOrigin.y;
      const len = Math.min(62, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      this.joystickVector.set(Math.cos(angle) * (len / 62), Math.sin(angle) * (len / 62));
      this.joystickKnob.setPosition(this.joystickOrigin.x + Math.cos(angle) * len, this.joystickOrigin.y + Math.sin(angle) * len);
    };
    const stopJoystick = (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId) return;
      this.joystickActive = false;
      this.joystickPointerId = -1;
      this.joystickVector.set(0, 0);
      this.joystickBase.setPosition(112, GAME_HEIGHT - 112);
      this.joystickKnob.setPosition(112, GAME_HEIGHT - 112);
    };

    this.input.on('pointerdown', startJoystick);
    this.input.on('pointermove', moveJoystick);
    this.input.on('pointerup', stopJoystick);
    this.input.on('pointerupoutside', stopJoystick);

    this.createSharedControlButton(GAME_WIDTH - 96, GAME_HEIGHT - 116, 60, 'attack', 'АТК', 'J', COLORS.gold, () => this.enqueueCombatAction('attack'));
    this.createSharedControlButton(GAME_WIDTH - 250, GAME_HEIGHT - 96, 52, 'primary', this.selectedHero.abilities.primary.label, 'K', COLORS.blue, () => this.enqueueCombatAction('cast', 'primary'));
    this.createSharedControlButton(GAME_WIDTH - 402, GAME_HEIGHT - 84, 52, 'secondary', this.selectedHero.abilities.secondary.label, 'L', COLORS.purple, () => this.enqueueCombatAction('cast', 'secondary'));
    this.createSharedControlButton(GAME_WIDTH - 250, GAME_HEIGHT - 204, 64, 'ultimate', 'ULT', 'Space', COLORS.red, () => this.enqueueCombatAction('cast', 'ultimate'));
  }

  private createSharedControlButton(
    x: number,
    y: number,
    radius: number,
    slot: AbilitySlot | 'attack',
    labelText: string,
    hotkey: string,
    color: number,
    action: () => void
  ) {
    const container = this.add.container(x, y).setScrollFactor(0).setDepth(1800);
    const outer = this.add.circle(0, 0, radius + 10, 0x000000, 0.44).setStrokeStyle(2, color, 0.56);
    const diamond = this.add.polygon(0, 0, [0, -radius, radius, 0, 0, radius, -radius, 0], color, 0.1)
      .setStrokeStyle(1, color, 0.32)
      .setRotation(0.78);
    const ring = this.add.circle(0, 0, radius, color, 0.33).setStrokeStyle(3, COLORS.white, 0.45)
      .setInteractive(new Phaser.Geom.Circle(0, 0, radius + 12), Phaser.Geom.Circle.Contains);
    const glyph = this.add.text(0, slot === 'ultimate' ? -20 : -17, slot === 'attack' ? '✦' : slot === 'primary' ? 'I' : slot === 'secondary' ? 'II' : 'ULT', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: slot === 'ultimate' ? '16px' : '20px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setAlpha(0.82);
    const label = this.add.text(0, slot === 'attack' ? 10 : 11, labelText, {
      fontFamily: 'Arial, sans-serif',
      fontSize: slot === 'attack' ? '18px' : '13px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white),
      align: 'center',
      wordWrap: { width: radius * 1.55 }
    }).setOrigin(0.5);
    const key = this.add.text(0, radius - 13, hotkey, {
      fontFamily: 'Arial, sans-serif',
      fontSize: slot === 'ultimate' ? '11px' : '12px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);
    const cdText = this.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${Math.max(22, Math.round(radius * 0.42))}px`,
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    ring.on('pointerdown', () => {
      this.tweens.add({ targets: container, scale: 0.92, duration: 55, yoyo: true });
      action();
    });

    container.add([outer, diamond, ring, glyph, label, key, cdText]);
    this.sharedButtons.push({ slot, container, ring, cdText, label, readyColor: color });
  }


  private createSharedHud() {
    const topPanel = createGlassPanel(this, GAME_WIDTH / 2, 44, 760, 64, COLORS.purple, 0.72).setDepth(1700).setScrollFactor(0);
    this.add.text(topPanel.x - 315, topPanel.y, this.tutorialMode ? 'SHARED TUTORIAL' : 'SHARED SIM MODE', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '17px',
      color: colorToCss(COLORS.purple),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1701);
    this.hudText = this.add.text(topPanel.x - 80, topPanel.y, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '20px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1701);
    this.hashText = this.add.text(topPanel.x + 230, topPanel.y, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: colorToCss(COLORS.gold)
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1701);
    this.tipText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 24, this.tutorialMode ? 'Tutorial: левый палец — движение · правый — атаки/скиллы · разрушьте учебное ядро' : 'Shared Sim: левый палец — движение · правый — атаки/скиллы · сервер сверит stateHash', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      color: colorToCss(0xd7dcff),
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1701);
    this.killFeedText = this.add.text(GAME_WIDTH / 2, 92, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1900);
    this.objectiveBannerText = this.add.text(GAME_WIDTH / 2, 148, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '32px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 7,
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2200).setAlpha(0);
    createTextButton(this, 90, 44, 140, 42, 'В меню', () => { this.scene.start('MenuScene'); }, COLORS.muted).setDepth(1800);
  }

  private collectContinuousInput() {
    const input = new Phaser.Math.Vector2(this.joystickVector.x, this.joystickVector.y);
    if (this.controls) {
      const left = this.controls.A?.isDown || this.controls.LEFT?.isDown;
      const right = this.controls.D?.isDown || this.controls.RIGHT?.isDown;
      const up = this.controls.W?.isDown || this.controls.UP?.isDown;
      const down = this.controls.S?.isDown || this.controls.DOWN?.isDown;
      input.x += (right ? 1 : 0) - (left ? 1 : 0);
      input.y += (down ? 1 : 0) - (up ? 1 : 0);

      if (Phaser.Input.Keyboard.JustDown(this.controls.J)) this.enqueueCombatAction('attack');
      if (Phaser.Input.Keyboard.JustDown(this.controls.K)) this.enqueueCombatAction('cast', 'primary');
      if (Phaser.Input.Keyboard.JustDown(this.controls.L)) this.enqueueCombatAction('cast', 'secondary');
      if (Phaser.Input.Keyboard.JustDown(this.controls.SPACE)) this.enqueueCombatAction('cast', 'ultimate');
    }

    if (input.lengthSq() > 0.0001) input.normalize();
    const dx = Number(input.x.toFixed(3));
    const dy = Number(input.y.toFixed(3));
    const changed = Math.abs(dx - this.lastInput.dx) > 0.08 || Math.abs(dy - this.lastInput.dy) > 0.08;
    const periodic = (this.snapshot?.timeMs ?? 0) - this.lastMoveActionAt >= 500;
    if (changed || (periodic && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01))) {
      const player = this.playerSnapshot();
      this.enqueueAction('move', {
        x: player?.x,
        y: player?.y,
        dx,
        dy,
        data: { stop: Math.abs(dx) <= 0.01 && Math.abs(dy) <= 0.01 }
      });
      this.lastInput = { dx, dy };
      this.lastMoveActionAt = this.snapshot?.timeMs ?? 0;
    }
  }

  private enqueueCombatAction(type: 'attack' | 'cast', slot?: AbilitySlot) {
    const player = this.playerSnapshot();
    if (!player) return;

    const actionTickMs = (this.snapshot?.timeMs ?? 0) + SIMULATION_RULES.tickMs;
    if (type === 'attack') {
      const target = this.nearestEnemySnapshot(this.selectedHero.range + 90);
      if (!target) {
        showUiToast(this, GAME_WIDTH / 2, 116, 'Нет цели для атаки', COLORS.muted);
        return;
      }
      if (actionTickMs < this.lastAttackActionAt + this.selectedHero.attackCooldown) {
        showUiToast(this, GAME_WIDTH / 2, 116, 'Атака перезаряжается', COLORS.muted);
        return;
      }
      this.lastAttackActionAt = actionTickMs;
      this.enqueueAction('attack', {
        x: player.x,
        y: player.y,
        target: this.sharedActorToClientActor(target),
        targetX: target.x,
        targetY: target.y
      });
      if (this.tutorialMode) this.markSharedTutorialAction('attack');
      haptic('light');
      return;
    }

    if (!slot) return;
    const ability = this.selectedHero.abilities[slot];
    if (actionTickMs < this.lastCastActionAt[slot] + ability.cooldown) {
      showUiToast(this, GAME_WIDTH / 2, 116, `${ability.label}: перезарядка`, COLORS.muted);
      return;
    }
    this.lastCastActionAt[slot] = actionTickMs;
    const target = this.nearestEnemySnapshot(slot === 'ultimate' ? 620 : 520);
    this.enqueueAction('cast', {
      slot,
      x: player.x,
      y: player.y,
      target: target ? this.sharedActorToClientActor(target) : undefined,
      targetX: target?.x,
      targetY: target?.y
    });
    if (this.tutorialMode) this.markSharedTutorialAction(slot);
    haptic(slot === 'ultimate' ? 'heavy' : 'light');
  }

  private enqueueAction(type: string, payload: Partial<SharedAction> = {}) {
    const currentTickMs = this.snapshot?.timeMs ?? 0;
    const action: SharedAction = {
      ...payload,
      seq: this.actionSeq++,
      t: Math.min(SIMULATION_RULES.maxDurationSec * 1000, currentTickMs + SIMULATION_RULES.tickMs),
      type
    };
    this.actionStreamActions.push(action);
    this.queuedActions.push(action);
  }

  private renderSharedSnapshot(snapshot: RenderCombatSnapshot) {
    const activeActorIds = new Set(snapshot.actors.map((actor) => actor.id));
    for (const [id, view] of this.actorViews) {
      if (!activeActorIds.has(id)) {
        view.container.destroy();
        this.actorViews.delete(id);
      }
    }

    for (const actor of snapshot.actors) {
      let view = this.actorViews.get(actor.id);
      if (!view) {
        view = this.createSharedActorView(actor);
        this.actorViews.set(actor.id, view);
      }
      view.container.setPosition(actor.x, actor.y).setDepth(actor.y + (actor.kind === 'projectile' ? 20 : 0)).setVisible(!actor.dead || actor.kind === 'hero');
      const pct = Phaser.Math.Clamp(actor.hp / Math.max(1, actor.maxHp), 0, 1);
      view.hpFill.scaleX = pct;
      view.hpFill.setFillStyle(pct > 0.5 ? COLORS.green : pct > 0.25 ? COLORS.gold : COLORS.red, 0.95);
      view.body.setAlpha(actor.dead ? 0.22 : 0.95);
      view.shadow.setAlpha(actor.dead ? 0.08 : 0.32);
      const pulse = 1 + Math.sin((snapshot.timeMs + actor.id.length * 137) / 260) * 0.045;
      view.aura.setVisible(actor.kind === 'hero' || actor.kind === 'core');
      view.aura.setAlpha(actor.dead ? 0.03 : actor.controller === 'player' ? 0.22 : 0.11);
      view.aura.setScale(actor.controller === 'player' ? pulse : 1);
      if (view.weapon) view.weapon.setRotation(-0.45 + Math.sin((snapshot.timeMs + actor.id.length * 41) / 180) * 0.08);
      if (actor.hp < view.lastHp && actor.controller === 'player') {
        this.cameras.main.shake(70, 0.0035);
      }
      view.lastHp = actor.hp;
      if (view.label) view.label.setText(this.actorLabel(actor));
    }

    this.renderProjectiles(snapshot);
    this.renderZones(snapshot);
  }

  private createSharedActorView(actor: RenderActorSnapshot): SharedSimActorView {
    const color = actor.team === 'blue' ? COLORS.blue : COLORS.red;
    const container = this.add.container(actor.x, actor.y).setDepth(actor.y);
    const shadowWidth = actor.kind === 'core' ? 132 : actor.kind === 'tower' ? 78 : actor.kind === 'minion' ? 34 : 66;
    const shadowHeight = actor.kind === 'core' ? 34 : actor.kind === 'tower' ? 24 : actor.kind === 'minion' ? 12 : 20;
    const shadowY = actor.kind === 'tower' ? 46 : actor.kind === 'core' ? 58 : 26;
    const shadow = this.add.ellipse(0, shadowY, shadowWidth, shadowHeight, 0x000000, 0.32);
    const auraRadius = actor.kind === 'core' ? 82 : actor.kind === 'tower' ? 50 : actor.kind === 'minion' ? 22 : actor.controller === 'player' ? 46 : 38;
    const aura = this.add.circle(0, 0, auraRadius, color, actor.controller === 'player' ? 0.18 : 0.08)
      .setStrokeStyle(actor.controller === 'player' ? 3 : 2, actor.controller === 'player' ? COLORS.gold : color, actor.controller === 'player' ? 0.62 : 0.25);
    let body: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle;
    let weapon: Phaser.GameObjects.Rectangle | undefined;

    if (actor.kind === 'tower') {
      body = this.add.rectangle(0, 0, 58, 82, color, 0.9).setStrokeStyle(4, COLORS.white, 0.32);
    } else if (actor.kind === 'core') {
      body = this.add.circle(0, 0, 70, color, 0.88).setStrokeStyle(6, COLORS.white, 0.34);
    } else if (actor.kind === 'minion') {
      body = this.add.circle(0, 0, 16, color, 0.92).setStrokeStyle(2, COLORS.white, 0.28);
    } else {
      const visual = actor.heroId ? heroVisual(heroById(actor.heroId), actor.controller === 'player') : { color, accent: COLORS.white };
      body = this.add.circle(0, 0, actor.controller === 'player' ? 34 : 28, visual.color, 0.94)
        .setStrokeStyle(4, actor.controller === 'player' ? COLORS.gold : COLORS.white, actor.controller === 'player' ? 0.85 : 0.36);
      weapon = this.add.rectangle(28, -6, actor.heroId === 'teo' ? 36 : 54, 6, visual.accent, 0.82).setRotation(-0.45);
    }

    const hpBg = this.add.rectangle(-42, -48, 84, 7, 0x000000, 0.55).setOrigin(0, 0.5);
    const hpFill = this.add.rectangle(-42, -48, 84, 7, COLORS.green, 0.95).setOrigin(0, 0.5);
    const label = actor.kind === 'hero' || actor.kind === 'tower' || actor.kind === 'core'
      ? this.add.text(0, actor.kind === 'core' ? -92 : -66, this.actorLabel(actor), {
        fontFamily: 'Arial, sans-serif',
        fontSize: actor.controller === 'player' ? '15px' : '12px',
        color: colorToCss(actor.team === 'blue' ? COLORS.blue : COLORS.red),
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5)
      : undefined;

    container.add([shadow, aura, body, ...(weapon ? [weapon] : []), hpBg, hpFill, ...(label ? [label] : [])]);
    return { container, body, hpFill, label, shadow, aura, weapon, lastHp: actor.hp };
  }

  private renderProjectiles(snapshot: RenderCombatSnapshot) {
    const activeIds = new Set(snapshot.projectiles.map((projectile) => projectile.id));
    for (const [id, view] of this.projectileViews) {
      if (!activeIds.has(id)) {
        view.destroy();
        this.projectileViews.delete(id);
      }
    }
    for (const projectile of snapshot.projectiles) {
      let view = this.projectileViews.get(projectile.id);
      if (!view) {
        view = this.add.circle(projectile.x, projectile.y, projectile.radius, projectile.team === 'blue' ? COLORS.blue : COLORS.red, 0.96)
          .setStrokeStyle(2, COLORS.white, 0.46)
          .setDepth(projectile.y + 20);
        this.projectileViews.set(projectile.id, view);
      }
      view.setPosition(projectile.x, projectile.y).setDepth(projectile.y + 20);
    }
  }

  private renderZones(snapshot: RenderCombatSnapshot) {
    const activeIds = new Set(snapshot.zones.map((zone) => zone.id));
    for (const [id, view] of this.zoneViews) {
      if (!activeIds.has(id)) {
        view.destroy();
        this.zoneViews.delete(id);
      }
    }
    for (const zone of snapshot.zones) {
      let view = this.zoneViews.get(zone.id);
      if (!view) {
        view = this.add.circle(zone.x, zone.y, zone.radius, zone.team === 'blue' ? COLORS.blue : COLORS.red, 0.12)
          .setStrokeStyle(4, zone.team === 'blue' ? COLORS.blue : COLORS.red, 0.52)
          .setDepth(zone.y - 4);
        this.zoneViews.set(zone.id, view);
      }
      view.setPosition(zone.x, zone.y).setDepth(zone.y - 4);
    }
  }

  private consumeSharedEvents(snapshot: RenderCombatSnapshot) {
    const freshEvents = snapshot.events
      .filter((event) => Number(event.seq) > this.processedEventSeq)
      .sort((a, b) => Number(a.seq) - Number(b.seq));

    for (const event of freshEvents) {
      this.processedEventSeq = Math.max(this.processedEventSeq, Number(event.seq));
      this.renderSharedEvent(event);
    }
  }

  private renderSharedEvent(event: RenderCombatEvent) {
    const color = event.actor?.team === 'blue' ? COLORS.blue : event.actor?.team === 'red' ? COLORS.red : COLORS.gold;
    const sourceX = Number.isFinite(Number(event.x)) ? Number(event.x) : this.playerSnapshot()?.x ?? GAME_WIDTH / 2;
    const sourceY = Number.isFinite(Number(event.y)) ? Number(event.y) : this.playerSnapshot()?.y ?? GAME_HEIGHT / 2;
    const targetX = Number.isFinite(Number(event.targetX)) ? Number(event.targetX) : sourceX;
    const targetY = Number.isFinite(Number(event.targetY)) ? Number(event.targetY) : sourceY;
    const playerInvolved = event.actor?.controller === 'player' || event.target?.controller === 'player';

    if (event.type === 'match_start') {
      this.showSharedObjectiveBanner('FIGHT! SHARED SIM', COLORS.gold);
      return;
    }

    if (event.type === 'attack' && playerInvolved) {
      this.spawnSharedLineEffect(sourceX, sourceY, targetX, targetY, color, 8);
      this.spawnSharedHitBurst(targetX, targetY, color);
      return;
    }

    if (event.type === 'cast' && event.actor?.controller === 'player') {
      const slot = event.slot === 'ultimate' ? 'ULTIMATE' : event.slot === 'secondary' ? this.selectedHero.abilities.secondary.label : this.selectedHero.abilities.primary.label;
      this.spawnSharedRing(sourceX, sourceY, event.slot === 'ultimate' ? 125 : 82, color, 0.42);
      if (Number.isFinite(Number(event.targetX)) && Number.isFinite(Number(event.targetY))) this.spawnSharedRing(targetX, targetY, 58, color, 0.28);
      this.spawnSharedFloatingText(sourceX, sourceY - 58, slot, color, event.slot === 'ultimate' ? 24 : 18);
      return;
    }

    if (event.type === 'damage') {
      const amount = Math.round(Number(event.amount ?? 0));
      if (!playerInvolved && amount < 90) return;
      this.spawnSharedHitBurst(targetX, targetY, event.target?.team === 'blue' ? COLORS.blue : COLORS.red);
      if (amount > 0) this.spawnSharedFloatingText(targetX + Phaser.Math.Between(-8, 8), targetY - 20, `-${amount}`, event.target?.team === 'blue' ? COLORS.blue : COLORS.red, playerInvolved ? 20 : 15);
      return;
    }

    if (event.type === 'kill') {
      const targetLabel = event.target?.controller === 'player'
        ? 'Вы нокаутированы'
        : event.actor?.controller === 'player'
          ? 'Вы сделали KO!'
          : `${event.actor?.team === 'blue' ? 'Blue' : 'Red'} KO`;
      this.killFeedText.setText(targetLabel);
      this.killFeedText.setColor(colorToCss(event.actor?.team === 'blue' ? COLORS.blue : COLORS.red));
      this.tweens.killTweensOf(this.killFeedText);
      this.killFeedText.setAlpha(1).setScale(1.08);
      this.tweens.add({ targets: this.killFeedText, scale: 1, duration: 160, ease: 'Back.easeOut' });
      this.time.delayedCall(1900, () => {
        if (this.killFeedText.active && this.killFeedText.text === targetLabel) this.killFeedText.setText('');
      });
      this.spawnSharedFloatingText(targetX, targetY - 64, 'KO!', color, 28);
      this.spawnSharedRing(targetX, targetY, 96, color, 0.5);
      return;
    }

    if (event.type === 'objective') {
      if (this.tutorialMode && (event.target?.tag === 'tower' || event.objective === 'tower')) this.markSharedTutorialAction('tower');
      if (this.tutorialMode && (event.target?.tag === 'core' || event.objective === 'core')) this.markSharedTutorialAction('core');
      const objective = event.objective === 'core' || event.target?.kind === 'core' ? 'CORE' : 'TOWER';
      const team = event.target?.team === 'blue' ? 'BLUE' : 'RED';
      this.showSharedObjectiveBanner(`${team} ${objective} DOWN`, objective === 'CORE' ? COLORS.gold : color);
      this.spawnSharedRing(targetX, targetY, objective === 'CORE' ? 170 : 120, color, 0.58);
      return;
    }

    if (event.type === 'reward' && event.actor?.controller === 'player') {
      const gain = Number((event.data as { goldGain?: unknown } | undefined)?.goldGain ?? 0);
      this.spawnSharedFloatingText(sourceX, sourceY - 86, gain > 0 ? `+${gain} gold` : 'reward', COLORS.gold, 18);
      return;
    }

    if (event.type === 'level_up' && event.actor?.controller === 'player') {
      this.showSharedObjectiveBanner(`LEVEL ${event.levelAfter ?? ''}!`, COLORS.gold);
      this.spawnSharedRing(sourceX, sourceY, 118, COLORS.gold, 0.48);
    }
  }

  private updateSharedControlButtons(snapshot: RenderCombatSnapshot) {
    const timeMs = snapshot.timeMs;
    for (const btn of this.sharedButtons) {
      let remaining = 0;
      if (btn.slot === 'attack') {
        remaining = Math.max(0, this.lastAttackActionAt + this.selectedHero.attackCooldown - timeMs);
      } else {
        remaining = Math.max(0, this.lastCastActionAt[btn.slot] + this.selectedHero.abilities[btn.slot].cooldown - timeMs);
      }
      const ready = remaining <= 0;
      btn.cdText.setText(ready ? '' : `${Math.ceil(remaining / 1000)}`);
      btn.ring.setFillStyle(btn.readyColor, ready ? 0.33 : 0.1);
      btn.ring.setStrokeStyle(ready ? 3 : 2, ready ? COLORS.white : COLORS.muted, ready ? 0.52 : 0.35);
      btn.label.setAlpha(ready ? 1 : 0.42);
      btn.container.setAlpha(ready ? 1 : 0.68);
    }
  }

  private showSharedObjectiveBanner(message: string, color: number) {
    if (!this.objectiveBannerText) return;
    this.tweens.killTweensOf(this.objectiveBannerText);
    this.objectiveBannerText.setText(message).setColor(colorToCss(color)).setAlpha(1).setScale(0.92);
    this.tweens.add({ targets: this.objectiveBannerText, scale: 1.06, duration: 150, ease: 'Back.easeOut', yoyo: true });
    this.tweens.add({ targets: this.objectiveBannerText, alpha: 0, delay: 1650, duration: 420, ease: 'Cubic.easeIn' });
  }

  private spawnSharedLineEffect(x1: number, y1: number, x2: number, y2: number, color: number, width: number) {
    const g = this.add.graphics().setDepth(Math.max(y1, y2) + 60);
    g.lineStyle(width, color, 0.85);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    g.lineStyle(Math.max(2, width / 3), COLORS.white, 0.72);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 230, onComplete: () => g.destroy() });
  }

  private spawnSharedRing(x: number, y: number, radius: number, color: number, alpha: number) {
    const ring = this.add.circle(x, y, Math.max(8, radius * 0.42), color, alpha).setStrokeStyle(5, color, 0.82).setDepth(y + 45);
    this.tweens.add({ targets: ring, scale: radius / Math.max(8, radius * 0.42), alpha: 0, duration: 460, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  private spawnSharedHitBurst(x: number, y: number, color: number) {
    const burst = this.add.circle(x, y, 10, color, 0.52).setDepth(y + 55);
    this.tweens.add({ targets: burst, scale: 2.6, alpha: 0, duration: 190, ease: 'Cubic.easeOut', onComplete: () => burst.destroy() });
  }

  private spawnSharedFloatingText(x: number, y: number, text: string, color: number, size: number) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${size}px`,
      color: colorToCss(color),
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center'
    }).setOrigin(0.5).setDepth(y + 120);

    this.tweens.add({
      targets: label,
      y: y - 48,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy()
    });
  }


  private createSharedTutorialOverlay() {
    this.tutorialLayer?.destroy();
    const layer = this.add.container(0, 0).setDepth(5000).setScrollFactor(0);
    this.tutorialLayer = layer;

    const panel = this.add.rectangle(GAME_WIDTH / 2, 108, 865, 124, 0x070512, 0.84)
      .setStrokeStyle(2, COLORS.gold, 0.72)
      .setScrollFactor(0);
    const portraitKey = `portrait_${this.selectedHero.id}`;
    const miniPortrait = createPortraitFrame(this, GAME_WIDTH / 2 - 382, 108, portraitKey, 78, 78, heroVisual(this.selectedHero, true).accent, 5001)
      .setScrollFactor(0);
    this.tutorialProgressText = this.add.text(GAME_WIDTH / 2 - 315, 72, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '19px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0, 0.5).setScrollFactor(0);
    this.tutorialInstructionText = this.add.text(GAME_WIDTH / 2 - 315, 114, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(0xe5e8ff),
      wordWrap: { width: 675 },
      lineSpacing: 5
    }).setOrigin(0, 0.5).setScrollFactor(0);

    const skip = createTextButton(this, GAME_WIDTH - 118, 190, 180, 42, 'В меню', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted).setScrollFactor(0).setDepth(5002);

    layer.add([panel, miniPortrait, this.tutorialProgressText, this.tutorialInstructionText, skip]);
  }

  private sharedTutorialActor(tag: string): RenderActorSnapshot | undefined {
    return this.snapshot?.actors.find((actor) => actor.tag === tag && !actor.dead);
  }

  private getSharedTutorialInfo(step = this.tutorialStep) {
    const dummy = this.sharedTutorialActor('dummy');
    const tower = this.sharedTutorialActor('tower') ?? this.snapshot?.actors.find((actor) => actor.tag === 'tower');
    const core = this.sharedTutorialActor('core') ?? this.snapshot?.actors.find((actor) => actor.tag === 'core');
    const trainingTarget = dummy ?? tower ?? core;
    const infos = [
      {
        title: 'Шаг 1/7 · Движение',
        text: 'Двигайтесь к светящемуся маркеру. На телефоне используйте левый джойстик, на ПК — WASD или стрелки.',
        x: 500,
        y: 570,
        color: COLORS.blue
      },
      {
        title: 'Шаг 2/7 · Базовая атака',
        text: 'Подойдите к манекену и нажмите АТК или клавишу J. Shared simulation сама выберет ближайшую цель.',
        x: trainingTarget?.x ?? 650,
        y: trainingTarget?.y ?? 570,
        color: COLORS.gold
      },
      {
        title: 'Шаг 3/7 · Первый навык',
        text: `Используйте первый навык: ${this.selectedHero.abilities.primary.label} или клавиша K. Навык попадёт в тот же deterministic action stream.`,
        x: trainingTarget?.x ?? 650,
        y: trainingTarget?.y ?? 570,
        color: heroVisual(this.selectedHero, true).color
      },
      {
        title: 'Шаг 4/7 · Второй навык',
        text: `Теперь используйте второй навык: ${this.selectedHero.abilities.secondary.label} или клавиша L. Следите за cooldown overlay.`,
        x: trainingTarget?.x ?? 650,
        y: trainingTarget?.y ?? 570,
        color: heroVisual(this.selectedHero, true).accent
      },
      {
        title: 'Шаг 5/7 · Ультимейт',
        text: 'Нажмите ULT или Space. Ультимейт даёт сильный shonen-момент и тоже записывается как shared action.',
        x: trainingTarget?.x ?? 650,
        y: trainingTarget?.y ?? 570,
        color: COLORS.purple
      },
      {
        title: 'Шаг 6/7 · Башня',
        text: 'Двигайтесь к учебной башне и разрушьте её. В обычном матче башни опасны, но здесь они безопасны для тренировки.',
        x: tower?.x ?? 1120,
        y: tower?.y ?? 642,
        color: COLORS.red
      },
      {
        title: 'Шаг 7/7 · Ядро врага',
        text: 'Башня уничтожена — атакуйте красное ядро. Разрушение ядра завершит shared tutorial и выдаст награду.',
        x: core?.x ?? 1540,
        y: core?.y ?? 600,
        color: COLORS.gold
      }
    ];
    return infos[Math.min(step, infos.length - 1)];
  }

  private setSharedTutorialStep(step: number) {
    this.tutorialStep = Phaser.Math.Clamp(step, 0, 6);
    const info = this.getSharedTutorialInfo(this.tutorialStep);
    this.tutorialProgressText?.setText(info.title);
    this.tutorialInstructionText?.setText(info.text);
    this.placeSharedTutorialMarker(info.x, info.y, info.color);

    if (this.tutorialStep >= 5) {
      this.cameras.main.stopFollow();
      this.cameras.main.pan(info.x, info.y, 520, 'Sine.easeInOut', true, (_camera, progress) => {
        if (progress >= 1) {
          const playerView = this.actorViews.get(this.snapshot?.playerId ?? '');
          if (playerView) this.cameras.main.startFollow(playerView.container, true, 0.12, 0.12);
        }
      });
    }
  }

  private placeSharedTutorialMarker(x: number, y: number, color: number) {
    const oldInner = this.tutorialMarker?.getData('inner') as Phaser.GameObjects.Arc | undefined;
    oldInner?.destroy();
    this.tutorialMarker?.destroy();
    const marker = this.add.circle(x, y, 58, color, 0.12).setStrokeStyle(5, color, 0.88).setDepth(y + 40);
    const inner = this.add.circle(x, y, 18, COLORS.white, 0.22).setStrokeStyle(2, COLORS.white, 0.6).setDepth(y + 41);
    this.tweens.add({ targets: [marker, inner], scale: 1.32, alpha: 0.18, yoyo: true, repeat: -1, duration: 820 });
    this.tutorialMarker = marker;
    marker.setData('inner', inner);
  }

  private markSharedTutorialAction(action: TutorialAction) {
    this.tutorialActions[action] = true;
  }

  private updateSharedTutorial(snapshot: RenderCombatSnapshot) {
    if (this.tutorialCompleted) return;

    const info = this.getSharedTutorialInfo(this.tutorialStep);
    if (this.tutorialMarker?.active) {
      this.tutorialMarker.setPosition(info.x, info.y).setDepth(info.y + 40);
      const inner = this.tutorialMarker.getData('inner') as Phaser.GameObjects.Arc | undefined;
      inner?.setPosition(info.x, info.y).setDepth(info.y + 41);
    }

    const player = this.playerSnapshot();
    let shouldAdvance = false;
    if (this.tutorialStep === 0 && player) {
      const dist = Phaser.Math.Distance.Between(player.x, player.y, info.x, info.y);
      shouldAdvance = dist < 82;
      if (shouldAdvance) this.markSharedTutorialAction('move');
    }
    if (this.tutorialStep === 1) shouldAdvance = this.tutorialActions.attack;
    if (this.tutorialStep === 2) shouldAdvance = this.tutorialActions.primary;
    if (this.tutorialStep === 3) shouldAdvance = this.tutorialActions.secondary;
    if (this.tutorialStep === 4) shouldAdvance = this.tutorialActions.ultimate;
    if (this.tutorialStep === 5) shouldAdvance = this.tutorialActions.tower || Boolean(snapshot.actors.find((actor) => actor.tag === 'tower')?.dead);
    if (this.tutorialStep === 6) shouldAdvance = this.tutorialActions.core || snapshot.winner === 'blue';

    if (shouldAdvance) {
      this.spawnSharedRing(info.x, info.y, 86, info.color, 0.32);
      this.spawnSharedFloatingText(info.x, info.y - 74, 'Готово!', COLORS.green, 22);
      if (this.tutorialStep < 6) this.setSharedTutorialStep(this.tutorialStep + 1);
    }
  }

  private completeSharedTutorialReward() {
    if (this.tutorialCompleted) return;
    this.tutorialCompleted = true;
    localStorage.setItem('shonen-rift-tutorial-completed', 'true');

    if (sharedState.session) {
      apiCompleteTutorial(sharedState.session.token).then((result) => {
        if (result?.user) sharedState.profile = result.user;
        sharedState.resultSyncStatus = result ? 'saved' : 'rejected';
        sharedState.resultSyncMessage = result?.message ?? 'Не удалось подтвердить tutorial reward';
      });
    } else {
      sharedState.resultSyncStatus = 'local';
      sharedState.resultSyncMessage = 'Tutorial завершён локально. Для награды нужен API.';
    }
  }


  private updateSharedHud(snapshot: RenderCombatSnapshot) {
    const player = this.playerSnapshot();
    this.hudText.setText(`${snapshot.kills.blue} : ${snapshot.kills.red} · ${fmtTime(Math.floor(snapshot.timeMs / 1000))} · ${player?.heroId ?? this.selectedHero.id} Lv.${player?.level ?? 1} · Gold ${player?.gold ?? 0}`);
    this.hashText.setText(`stateHash ${snapshot.stateHash}`);
  }

  private actorLabel(actor: RenderActorSnapshot): string {
    if (actor.tag === 'dummy') return 'Манекен';
    if (actor.tag === 'tower') return 'Учебная башня';
    if (actor.tag === 'core') return 'Учебное ядро';
    if (actor.kind === 'hero') return `${actor.controller === 'player' ? 'Вы · ' : ''}${actor.heroId ?? 'hero'} Lv.${actor.level}`;
    if (actor.kind === 'tower') return actor.team === 'blue' ? 'Blue Tower' : 'Red Tower';
    if (actor.kind === 'core') return actor.team === 'blue' ? 'Blue Core' : 'Red Core';
    return actor.kind;
  }

  private playerSnapshot(): RenderActorSnapshot | undefined {
    return this.snapshot?.actors.find((actor) => actor.id === this.snapshot?.playerId);
  }

  private nearestEnemySnapshot(range: number): RenderActorSnapshot | undefined {
    const player = this.playerSnapshot();
    if (!player || !this.snapshot) return undefined;
    return this.snapshot.actors
      .filter((actor) => !actor.dead && actor.team !== player.team)
      .map((actor) => ({ actor, dist: Phaser.Math.Distance.Between(player.x, player.y, actor.x, actor.y) }))
      .filter((item) => item.dist <= range)
      .sort((a, b) => a.dist - b.dist)[0]?.actor;
  }

  private finishSharedSimMatch(winner: Team) {
    if (this.matchOver || !this.snapshot) return;
    this.matchOver = true;

    const durationSec = Math.max(12, Math.floor(this.snapshot.timeMs / 1000));
    const eventLog = this.tutorialMode ? undefined : this.buildSharedEventLog(durationSec, winner);
    const actionStream = this.tutorialMode ? undefined : this.buildSharedActionStream(durationSec, winner);
    sharedState.lastResult = {
      victory: winner === 'blue',
      winner,
      durationSec,
      heroName: this.selectedHero.name,
      heroId: this.selectedHero.id,
      kills: this.snapshot.result.kills,
      deaths: this.snapshot.result.deaths,
      gold: this.snapshot.result.gold,
      level: this.snapshot.result.level,
      tutorial: this.tutorialMode,
      eventLog,
      actionStream
    };

    const stored = JSON.parse(localStorage.getItem('shonen-rift-results') ?? '[]') as MatchResult[];
    stored.unshift(sharedState.lastResult);
    localStorage.setItem('shonen-rift-results', JSON.stringify(stored.slice(0, 20)));

    if (this.tutorialMode) {
      sharedState.resultSyncStatus = 'pending';
      sharedState.resultSyncMessage = winner === 'blue' ? 'Отправляем tutorial reward...' : 'Tutorial завершён без победы';
      if (winner === 'blue') this.completeSharedTutorialReward();
    } else if (sharedState.session) {
      sharedState.resultSyncStatus = 'pending';
      sharedState.resultSyncMessage = 'Shared simulation replay отправлен на сервер...';
      apiSubmitMatchResult(sharedState.session.token, sharedState.currentMatchId, sharedState.lastResult)
        .then((response) => {
          if (response?.user) sharedState.profile = response.user;
          if (response?.ok) {
            sharedState.resultSyncStatus = 'saved';
            sharedState.resultSyncMessage = response.validation?.clientSimulationMatched
              ? 'Shared sim подтверждён: client/server stateHash совпал'
              : 'Shared sim сохранён, проверьте replay warnings';
          } else {
            const firstError = response?.validation?.errors?.[0]?.message;
            sharedState.resultSyncStatus = 'rejected';
            sharedState.resultSyncMessage = firstError ? `Shared sim отклонён: ${firstError}` : 'Shared sim отклонён сервером';
          }
        });
    } else {
      sharedState.resultSyncStatus = 'local';
      sharedState.resultSyncMessage = 'API недоступен: shared simulation result сохранён локально';
    }

    const label = this.tutorialMode && winner === 'blue' ? 'Tutorial complete!' : winner === 'blue' ? 'Shared Sim: blue victory' : 'Shared Sim: red victory';
    this.add.text(this.cameras.main.midPoint.x, this.cameras.main.midPoint.y - 40, label, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '34px',
      color: colorToCss(winner === 'blue' ? COLORS.gold : COLORS.red),
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(3000);
    this.time.delayedCall(1150, () => this.scene.start('ResultScene'));
  }

  private buildSharedEventLog(durationSec: number, winner: Team): ClientEventLog {
    const events = (this.snapshot?.events ?? []) as ClientEventLogEntry[];
    const player = this.playerSnapshot();
    const coreDestroyed = Boolean(events.some((event) => event.type === 'objective' && event.objective === 'core' && event.target?.team === 'red' && event.actor?.team === 'blue'));
    const finalEvents = [...events, {
      t: durationSec * 1000,
      type: 'match_end',
      actor: player ? this.sharedActorToClientActor(player) : undefined,
      winner,
      x: player?.x,
      y: player?.y,
      goldAfter: this.snapshot?.result.gold ?? 0,
      levelAfter: this.snapshot?.result.level ?? 1,
      data: {
        durationSec,
        kills: this.snapshot?.result.kills ?? 0,
        deaths: this.snapshot?.result.deaths ?? 0,
        towersDestroyed: events.filter((event) => event.type === 'objective' && event.objective === 'tower' && event.target?.team === 'red').length,
        coreDestroyed,
        sharedSim: true
      }
    } as ClientEventLogEntry];

    return {
      version: 'client-event-log-v1',
      matchId: sharedState.currentMatchId,
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed,
      startedAtClientMs: this.matchStartedAtClientMs,
      events: finalEvents,
      summary: {
        victory: winner === 'blue',
        winner,
        durationSec,
        kills: this.snapshot?.result.kills ?? 0,
        deaths: this.snapshot?.result.deaths ?? 0,
        gold: this.snapshot?.result.gold ?? 0,
        level: this.snapshot?.result.level ?? 1,
        towersDestroyed: events.filter((event) => event.type === 'objective' && event.objective === 'tower' && event.target?.team === 'red').length,
        coreDestroyed
      }
    };
  }

  private buildSharedActionStream(durationSec: number, winner: Team): ClientActionStream {
    const player = this.playerSnapshot();
    const matchEndAction: SharedAction = {
      seq: this.actionStreamActions.length,
      t: this.snapshot?.timeMs ?? durationSec * 1000,
      type: 'match_end',
      x: player?.x,
      y: player?.y,
      data: {
        winner,
        victory: winner === 'blue',
        durationSec,
        kills: this.snapshot?.result.kills ?? 0,
        deaths: this.snapshot?.result.deaths ?? 0,
        gold: this.snapshot?.result.gold ?? 0,
        level: this.snapshot?.result.level ?? 1,
        sharedSim: true
      }
    };
    const actions = [...this.actionStreamActions, matchEndAction].map((action, index) => ({ ...action, seq: index }));
    const clientSimulationReport = simulateCombat({
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed ?? 1,
      actions,
      durationSec
    });
    const castCounts = { primary: 0, secondary: 0, ultimate: 0 };
    let moveSamples = 0;
    let attackCount = 0;
    for (const action of actions) {
      if (action.type === 'move') moveSamples += 1;
      if (action.type === 'attack') attackCount += 1;
      if (action.type === 'cast' && (action.slot === 'primary' || action.slot === 'secondary' || action.slot === 'ultimate')) {
        castCounts[action.slot] += 1;
      }
    }

    const unsigned = {
      version: ACTION_STREAM_VERSION,
      matchId: sharedState.currentMatchId,
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed,
      validationToken: sharedState.currentMatchValidationToken,
      tickRate: 10,
      startedAtClientMs: this.matchStartedAtClientMs,
      actions,
      summary: {
        durationSec,
        lastX: Math.round(player?.x ?? 0),
        lastY: Math.round(player?.y ?? 0),
        moveSamples,
        attackCount,
        castCounts,
        truncated: false
      },
      clientSimulation: {
        source: clientSimulationReport.source,
        stateHash: clientSimulationReport.stateHash,
        result: {
          terminal: clientSimulationReport.result.terminal,
          victory: clientSimulationReport.result.victory,
          winner: clientSimulationReport.result.winner,
          durationSec: clientSimulationReport.result.durationSec,
          heroName: clientSimulationReport.result.heroName,
          heroId: clientSimulationReport.result.heroId,
          kills: clientSimulationReport.result.kills,
          deaths: clientSimulationReport.result.deaths,
          gold: clientSimulationReport.result.gold,
          level: clientSimulationReport.result.level
        }
      }
    };

    return {
      ...unsigned,
      integrityHash: stableHash(canonicalStringify(unsigned))
    };
  }

  private sharedActorToClientActor(actor: RenderActorSnapshot): ClientEventActor {
    return {
      id: actor.id,
      team: actor.team,
      kind: actor.kind,
      controller: actor.controller,
      heroId: actor.heroId
    };
  }
}

class MatchScene extends Phaser.Scene {
  private actors: Actor[] = [];
  private projectiles: Projectile[] = [];
  private zones: Zone[] = [];
  private player!: Actor;
  private selectedHero!: HeroConfig;
  private matchOver = false;
  private matchStartedAt = 0;
  private lastWaveAt = -999999;
  private actorSeq = 0;
  private projectileSeq = 0;
  private zoneSeq = 0;
  private kills: Record<Team, number> = { blue: 0, red: 0 };
  private joystickActive = false;
  private joystickPointerId = -1;
  private joystickOrigin = new Phaser.Math.Vector2(0, 0);
  private joystickVector = new Phaser.Math.Vector2(0, 0);
  private joystickBase!: Phaser.GameObjects.Arc;
  private joystickKnob!: Phaser.GameObjects.Arc;
  private controls!: Record<string, Phaser.Input.Keyboard.Key>;
  private abilityButtons: AbilityButton[] = [];
  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private playerInfoText!: Phaser.GameObjects.Text;
  private playerHpFill!: Phaser.GameObjects.Rectangle;
  private minimap!: Phaser.GameObjects.Graphics;
  private lastMinimapAt = 0;
  private ambient!: Phaser.GameObjects.Graphics;
  private tutorialMode = false;
  private tutorialStep = 0;
  private tutorialCompleted = false;
  private tutorialLayer?: Phaser.GameObjects.Container;
  private tutorialMarker?: Phaser.GameObjects.Arc;
  private tutorialProgressText?: Phaser.GameObjects.Text;
  private tutorialInstructionText?: Phaser.GameObjects.Text;
  private tutorialTargetDummy?: Actor;
  private tutorialTower?: Actor;
  private tutorialCore?: Actor;
  private tutorialMoveDistance = 0;
  private tutorialActions: Record<TutorialAction, boolean> = {
    move: false,
    attack: false,
    primary: false,
    secondary: false,
    ultimate: false,
    tower: false,
    core: false
  };
  private eventLogEvents: ClientEventLogEntry[] = [];
  private eventLogStartedAtClientMs = 0;
  private nextMoveEventAt = 0;
  private towersDestroyedByBlue = 0;
  private redCoreDestroyed = false;
  private eventLogTruncated = false;
  private actionStreamActions: ClientActionStreamEntry[] = [];
  private actionStreamStartedAtClientMs = 0;
  private actionSeq = 0;
  private nextActionMoveAt = 0;
  private lastActionMoving = false;
  private actionStreamTruncated = false;

  constructor() {
    super('MatchScene');
  }

  create(data: { heroId?: string; tutorial?: boolean }) {
    this.selectedHero = heroById(data.heroId ?? sharedState.selectedHeroId);
    sharedState.selectedHeroId = this.selectedHero.id;
    this.tutorialMode = Boolean(data.tutorial);
    this.tutorialStep = 0;
    this.tutorialCompleted = false;
    this.tutorialMoveDistance = 0;
    this.tutorialActions = { move: false, attack: false, primary: false, secondary: false, ultimate: false, tower: false, core: false };
    this.eventLogEvents = [];
    this.eventLogStartedAtClientMs = Date.now();
    this.nextMoveEventAt = 0;
    this.towersDestroyedByBlue = 0;
    this.redCoreDestroyed = false;
    this.eventLogTruncated = false;
    this.actionStreamActions = [];
    this.actionStreamStartedAtClientMs = this.eventLogStartedAtClientMs;
    this.actionSeq = 0;
    this.nextActionMoveAt = 0;
    this.lastActionMoving = false;
    this.actionStreamTruncated = false;
    this.matchOver = false;
    this.matchStartedAt = this.time.now;
    this.lastWaveAt = -999999;
    this.actors = [];
    this.projectiles = [];
    this.zones = [];
    this.kills = { blue: 0, red: 0 };

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    this.drawArena();
    this.createStructures();
    this.createTeams();
    if (!this.tutorialMode) this.spawnWave();
    this.createInput();
    this.createHud();
    this.recordEvent('match_start', {
      actor: this.actorSnapshot(this.player),
      x: Math.round(this.player.view.x),
      y: Math.round(this.player.view.y),
      data: {
        matchId: sharedState.currentMatchId,
        seed: sharedState.currentMatchSeed,
        heroId: this.selectedHero.id
      }
    });
    this.recordAction('match_start', {
      x: Math.round(this.player.view.x),
      y: Math.round(this.player.view.y),
      data: {
        matchId: sharedState.currentMatchId,
        seed: sharedState.currentMatchSeed,
        heroId: this.selectedHero.id
      }
    });
    if (this.tutorialMode) this.startTutorial();

    this.cameras.main.startFollow(this.player.view, true, 0.12, 0.12);
    this.cameras.main.setZoom(1);

    this.spawnFloatingText(this.player.view.x, this.player.view.y - 86, 'Матч начался!', COLORS.gold, 28);
    const activeSkin = equippedSkinForHero(this.selectedHero.id);
    if (activeSkin) {
      this.time.delayedCall(420, () => {
        this.spawnFloatingText(this.player.view.x, this.player.view.y - 112, `Скин: ${activeSkin.name}`, activeSkin.accent, 22);
      });
    }
  }

  update(time: number, delta: number) {
    if (this.matchOver) return;

    const dt = delta / 1000;
    this.updateAmbient(time);

    if (!this.tutorialMode && time - this.lastWaveAt > 18000) {
      this.spawnWave();
      this.lastWaveAt = time;
    }

    this.updateRespawns(time);
    this.updatePlayer(time, dt);

    for (const actor of this.actors) {
      if (actor.dead) continue;
      if (actor.controller === 'bot') this.updateBotHero(actor, time, dt);
      if (actor.controller === 'minion') this.updateMinion(actor, time, dt);
      if (actor.controller === 'tower') this.updateTower(actor, time);
      this.updateActorVisual(actor, time);
    }

    this.updateProjectiles(time, dt);
    this.updateZones(time);
    this.cleanupDeadObjects();
    this.updateHud(time);
    if (this.tutorialMode) this.updateTutorial(time);
  }

  private recordEvent(type: string, payload: Partial<ClientEventLogEntry> = {}) {
    if (this.tutorialMode) return;

    const maxEvents = 900;
    const reserveForMatchEnd = 1;
    if (type !== 'match_end' && this.eventLogEvents.length >= maxEvents - reserveForMatchEnd) {
      if (!this.eventLogTruncated) {
        this.eventLogTruncated = true;
        this.eventLogEvents.push({
          t: Math.max(0, Math.floor(this.time.now - this.matchStartedAt)),
          type: 'event_log_truncated',
          data: { maxEvents }
        });
      }
      return;
    }

    if (type === 'match_end' && this.eventLogEvents.length >= maxEvents) {
      this.eventLogEvents = this.eventLogEvents.slice(0, maxEvents - 1);
    }

    const event: ClientEventLogEntry = {
      ...payload,
      type,
      t: Math.max(0, Math.floor(this.time.now - this.matchStartedAt))
    };

    if (typeof event.x === 'number') event.x = Math.round(event.x);
    if (typeof event.y === 'number') event.y = Math.round(event.y);
    if (typeof event.targetX === 'number') event.targetX = Math.round(event.targetX);
    if (typeof event.targetY === 'number') event.targetY = Math.round(event.targetY);
    if (typeof event.amount === 'number') event.amount = Math.round(event.amount);
    if (typeof event.hpAfter === 'number') event.hpAfter = Math.round(event.hpAfter);
    if (typeof event.goldAfter === 'number') event.goldAfter = Math.round(event.goldAfter);
    if (typeof event.levelAfter === 'number') event.levelAfter = Math.round(event.levelAfter);

    this.eventLogEvents.push(event);
  }

  private recordAction(type: string, payload: Partial<ClientActionStreamEntry> = {}) {
    if (this.tutorialMode) return;

    const maxActions = 2600;
    const reserveForMatchEnd = 1;
    const t = Math.max(0, Math.floor(this.time.now - this.matchStartedAt));

    if (type !== 'match_end' && this.actionStreamActions.length >= maxActions - reserveForMatchEnd) {
      if (!this.actionStreamTruncated) {
        this.actionStreamTruncated = true;
        this.actionStreamActions.push({
          seq: this.actionSeq++,
          t,
          type: 'action_stream_truncated',
          data: { maxActions }
        });
      }
      return;
    }

    if (type === 'match_end' && this.actionStreamActions.length >= maxActions) {
      this.actionStreamActions = this.actionStreamActions.slice(0, maxActions - 1);
    }

    const action: ClientActionStreamEntry = {
      ...payload,
      seq: this.actionSeq++,
      type,
      t
    };

    if (typeof action.x === 'number') action.x = Math.round(action.x);
    if (typeof action.y === 'number') action.y = Math.round(action.y);
    if (typeof action.targetX === 'number') action.targetX = Math.round(action.targetX);
    if (typeof action.targetY === 'number') action.targetY = Math.round(action.targetY);
    if (typeof action.dx === 'number') action.dx = Number(action.dx.toFixed(3));
    if (typeof action.dy === 'number') action.dy = Number(action.dy.toFixed(3));

    this.actionStreamActions.push(action);
  }

  private actorSnapshot(actor: Actor): ClientEventActor {
    return {
      id: actor.id,
      team: actor.team,
      kind: actor.kind,
      controller: actor.controller,
      heroId: actor.heroId,
      tag: actor.tutorialTag
    };
  }

  private buildEventLog(durationSec: number, winner: Team): ClientEventLog {
    const coreDestroyed = this.redCoreDestroyed || winner === 'blue';
    this.recordEvent('match_end', {
      actor: this.actorSnapshot(this.player),
      winner,
      x: this.player.view.x,
      y: this.player.view.y,
      goldAfter: this.player.gold,
      levelAfter: this.player.level,
      data: {
        durationSec,
        kills: this.player.kills,
        deaths: this.player.deaths,
        towersDestroyed: this.towersDestroyedByBlue,
        coreDestroyed,
        truncated: this.eventLogTruncated
      }
    });

    return {
      version: 'client-event-log-v1',
      matchId: sharedState.currentMatchId,
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed,
      startedAtClientMs: this.eventLogStartedAtClientMs,
      events: this.eventLogEvents.slice(),
      summary: {
        victory: winner === 'blue',
        winner,
        durationSec,
        kills: this.player.kills,
        deaths: this.player.deaths,
        gold: this.player.gold,
        level: this.player.level,
        towersDestroyed: this.towersDestroyedByBlue,
        coreDestroyed
      }
    };
  }

  private buildActionStream(durationSec: number, winner: Team): ClientActionStream {
    this.recordAction('match_end', {
      x: this.player.view.x,
      y: this.player.view.y,
      data: {
        winner,
        victory: winner === 'blue',
        durationSec,
        kills: this.player.kills,
        deaths: this.player.deaths,
        gold: this.player.gold,
        level: this.player.level,
        truncated: this.actionStreamTruncated
      }
    });

    const actions = this.actionStreamActions.slice();
    const castCounts = { primary: 0, secondary: 0, ultimate: 0 };
    let moveSamples = 0;
    let attackCount = 0;

    for (const action of actions) {
      if (action.type === 'move') moveSamples += 1;
      if (action.type === 'attack') attackCount += 1;
      if (action.type === 'cast' && (action.slot === 'primary' || action.slot === 'secondary' || action.slot === 'ultimate')) {
        castCounts[action.slot] += 1;
      }
    }

    const clientSimulationReport = simulateCombat({
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed ?? 1,
      actions,
      durationSec
    });

    const unsigned = {
      version: ACTION_STREAM_VERSION,
      matchId: sharedState.currentMatchId,
      heroId: this.selectedHero.id,
      seed: sharedState.currentMatchSeed,
      validationToken: sharedState.currentMatchValidationToken,
      tickRate: 2,
      startedAtClientMs: this.actionStreamStartedAtClientMs,
      actions,
      summary: {
        durationSec,
        lastX: Math.round(this.player.view.x),
        lastY: Math.round(this.player.view.y),
        moveSamples,
        attackCount,
        castCounts,
        truncated: this.actionStreamTruncated
      },
      clientSimulation: {
        source: clientSimulationReport.source,
        stateHash: clientSimulationReport.stateHash,
        result: {
          terminal: clientSimulationReport.result.terminal,
          victory: clientSimulationReport.result.victory,
          winner: clientSimulationReport.result.winner,
          durationSec: clientSimulationReport.result.durationSec,
          heroName: clientSimulationReport.result.heroName,
          heroId: clientSimulationReport.result.heroId,
          kills: clientSimulationReport.result.kills,
          deaths: clientSimulationReport.result.deaths,
          gold: clientSimulationReport.result.gold,
          level: clientSimulationReport.result.level
        }
      }
    };

    return {
      ...unsigned,
      integrityHash: stableHash(canonicalStringify(unsigned))
    };
  }

  private startTutorial() {
    this.player.level = 3;
    this.player.maxHp += 520;
    this.player.hp = this.player.maxHp;
    this.player.damage += 36;
    this.player.levelText?.setText(`Вы · ${this.player.name} · Lv.${this.player.level}`);
    this.cameras.main.setZoom(1.04);
    this.createTutorialOverlay();
    this.setTutorialStep(0);
    this.spawnFloatingText(this.player.view.x, this.player.view.y - 96, 'Тренировка началась', COLORS.green, 24);
  }

  private createTutorialOverlay() {
    this.tutorialLayer?.destroy();
    const layer = this.add.container(0, 0).setDepth(5000).setScrollFactor(0);
    this.tutorialLayer = layer;

    const panel = this.add.rectangle(GAME_WIDTH / 2, 106, 830, 118, 0x070512, 0.82)
      .setStrokeStyle(2, COLORS.gold, 0.72)
      .setScrollFactor(0);
    const portraitKey = `portrait_${this.selectedHero.id}`;
    const miniPortrait = createPortraitFrame(this, GAME_WIDTH / 2 - 365, 106, portraitKey, 78, 78, heroVisual(this.selectedHero, true).accent, 5001)
      .setScrollFactor(0);
    this.tutorialProgressText = this.add.text(GAME_WIDTH / 2 - 300, 72, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '19px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0, 0.5).setScrollFactor(0);
    this.tutorialInstructionText = this.add.text(GAME_WIDTH / 2 - 300, 112, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: colorToCss(0xe5e8ff),
      wordWrap: { width: 650 },
      lineSpacing: 5
    }).setOrigin(0, 0.5).setScrollFactor(0);

    const skip = createTextButton(this, GAME_WIDTH - 118, 190, 180, 42, 'В меню', () => {
      this.scene.start('MenuScene');
    }, COLORS.muted).setScrollFactor(0).setDepth(5002);

    layer.add([panel, miniPortrait, this.tutorialProgressText, this.tutorialInstructionText, skip]);
  }

  private getTutorialInfo(step = this.tutorialStep) {
    const dummy = this.tutorialTargetDummy;
    const tower = this.tutorialTower;
    const core = this.tutorialCore;
    const infos = [
      {
        title: 'Шаг 1/7 · Движение',
        text: 'Двигайтесь к светящемуся маркеру. На телефоне используйте левый джойстик, на ПК — WASD или стрелки.',
        x: 500,
        y: 570,
        color: COLORS.blue
      },
      {
        title: 'Шаг 2/7 · Базовая атака',
        text: 'Подойдите к манекену и нажмите АТК или клавишу J. Атака автоматически выбирает ближайшую цель.',
        x: dummy?.view.x ?? 650,
        y: dummy?.view.y ?? 570,
        color: COLORS.gold
      },
      {
        title: 'Шаг 3/7 · Первый навык',
        text: `Используйте первый навык: кнопка ${this.selectedHero.abilities.primary.label} или клавиша K. Навыки сильнее обычной атаки.`,
        x: dummy?.view.x ?? 650,
        y: dummy?.view.y ?? 570,
        color: heroVisual(this.selectedHero, true).color
      },
      {
        title: 'Шаг 4/7 · Второй навык',
        text: `Теперь используйте второй навык: ${this.selectedHero.abilities.secondary.label} или клавиша L. Комбинируйте навыки с движением.`,
        x: dummy?.view.x ?? 650,
        y: dummy?.view.y ?? 570,
        color: heroVisual(this.selectedHero, true).accent
      },
      {
        title: 'Шаг 5/7 · Ультимейт',
        text: `Нажмите ULT или Space. Ультимейт — самый сильный инструмент героя, используйте его в важных драках.`,
        x: dummy?.view.x ?? 650,
        y: dummy?.view.y ?? 570,
        color: COLORS.purple
      },
      {
        title: 'Шаг 6/7 · Башня',
        text: 'Двигайтесь к учебной башне и разрушьте её. В обычном матче лучше подходить к башне вместе с миньонами.',
        x: tower?.view.x ?? 1350,
        y: tower?.view.y ?? 642,
        color: COLORS.red
      },
      {
        title: 'Шаг 7/7 · Ядро врага',
        text: 'Башня уничтожена — атакуйте красное ядро. Разрушение ядра завершает матч победой.',
        x: core?.view.x ?? 2010,
        y: core?.view.y ?? 600,
        color: COLORS.gold
      }
    ];
    return infos[Math.min(step, infos.length - 1)];
  }

  private setTutorialStep(step: number) {
    this.tutorialStep = Phaser.Math.Clamp(step, 0, 6);
    const info = this.getTutorialInfo(this.tutorialStep);
    this.tutorialProgressText?.setText(info.title);
    this.tutorialInstructionText?.setText(info.text);
    this.placeTutorialMarker(info.x, info.y, info.color);

    if (this.tutorialStep >= 5) {
      this.cameras.main.stopFollow();
      this.cameras.main.pan(info.x, info.y, 520, 'Sine.easeInOut', true, (_camera, progress) => {
        if (progress >= 1) this.cameras.main.startFollow(this.player.view, true, 0.12, 0.12);
      });
    }
  }

  private placeTutorialMarker(x: number, y: number, color: number) {
    const oldInner = this.tutorialMarker?.getData('inner') as Phaser.GameObjects.Arc | undefined;
    oldInner?.destroy();
    this.tutorialMarker?.destroy();
    const marker = this.add.circle(x, y, 58, color, 0.12).setStrokeStyle(5, color, 0.88).setDepth(y + 40);
    const inner = this.add.circle(x, y, 18, COLORS.white, 0.22).setStrokeStyle(2, COLORS.white, 0.6).setDepth(y + 41);
    this.tweens.add({ targets: [marker, inner], scale: 1.32, alpha: 0.18, yoyo: true, repeat: -1, duration: 820 });
    this.tutorialMarker = marker;
    marker.setData('inner', inner);
  }

  private markTutorialAction(action: TutorialAction) {
    this.tutorialActions[action] = true;
  }

  private updateTutorial(_time: number) {
    if (this.tutorialCompleted) return;

    const info = this.getTutorialInfo(this.tutorialStep);
    if (this.tutorialMarker?.active) {
      this.tutorialMarker.setPosition(info.x, info.y).setDepth(info.y + 40);
      const inner = this.tutorialMarker.getData('inner') as Phaser.GameObjects.Arc | undefined;
      inner?.setPosition(info.x, info.y).setDepth(info.y + 41);
    }

    let shouldAdvance = false;
    if (this.tutorialStep === 0) {
      const dist = Phaser.Math.Distance.Between(this.player.view.x, this.player.view.y, info.x, info.y);
      shouldAdvance = dist < 78 || this.tutorialMoveDistance > 180;
      if (shouldAdvance) this.markTutorialAction('move');
    }
    if (this.tutorialStep === 1) shouldAdvance = this.tutorialActions.attack;
    if (this.tutorialStep === 2) shouldAdvance = this.tutorialActions.primary;
    if (this.tutorialStep === 3) shouldAdvance = this.tutorialActions.secondary;
    if (this.tutorialStep === 4) shouldAdvance = this.tutorialActions.ultimate;
    if (this.tutorialStep === 5) shouldAdvance = Boolean(this.tutorialTower?.dead || (this.tutorialTower && this.tutorialTower.hp <= 0));

    if (shouldAdvance) {
      this.spawnRing(info.x, info.y, 86, info.color, 0.28);
      this.spawnFloatingText(info.x, info.y - 74, 'Готово!', COLORS.green, 22);
      if (this.tutorialStep < 6) {
        this.setTutorialStep(this.tutorialStep + 1);
      }
    }
  }

  private completeTutorialReward() {
    if (this.tutorialCompleted) return;
    this.tutorialCompleted = true;
    localStorage.setItem('shonen-rift-tutorial-completed', 'true');

    if (sharedState.session) {
      apiCompleteTutorial(sharedState.session.token).then((result) => {
        if (result?.user) sharedState.profile = result.user;
        sharedState.resultSyncStatus = result ? 'saved' : 'rejected';
        sharedState.resultSyncMessage = result?.message ?? 'Не удалось подтвердить tutorial reward';
      });
    } else {
      sharedState.resultSyncStatus = 'local';
      sharedState.resultSyncMessage = 'Tutorial завершён локально. Для награды нужен API.';
    }
  }

  private drawArena() {
    const g = this.add.graphics().setDepth(-50);
    g.fillGradientStyle(0x0b0820, 0x0d0b25, 0x171238, 0x0a0920, 1);
    g.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Jungle/side zones.
    g.fillStyle(0x152642, 0.5);
    g.fillRoundedRect(265, 130, 620, 250, 42);
    g.fillRoundedRect(1320, 820, 620, 250, 42);
    g.fillStyle(0x2a1645, 0.42);
    g.fillRoundedRect(1240, 130, 620, 250, 42);
    g.fillRoundedRect(340, 820, 620, 250, 42);

    const crystalSpots = [
      [410, 210, COLORS.blue], [740, 300, COLORS.purple], [1470, 250, COLORS.red], [1740, 320, COLORS.gold],
      [500, 925, COLORS.gold], [820, 1010, COLORS.blue], [1430, 925, COLORS.purple], [1760, 1010, COLORS.red]
    ] as const;
    for (const [cx, cy, color] of crystalSpots) {
      g.fillStyle(color, 0.3);
      g.fillTriangle(cx, cy - 34, cx + 24, cy + 20, cx - 24, cy + 20);
      g.lineStyle(2, color, 0.55);
      g.strokeTriangle(cx, cy - 34, cx + 24, cy + 20, cx - 24, cy + 20);
      g.fillStyle(0xffffff, 0.12);
      g.fillCircle(cx, cy, 46);
    }

    // Main lane.
    g.lineStyle(92, 0x2a244f, 0.85);
    g.beginPath();
    g.moveTo(BLUE_PATH[0].x, BLUE_PATH[0].y);
    for (const point of BLUE_PATH.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    g.lineStyle(64, 0x46336c, 0.45);
    g.beginPath();
    g.moveTo(BLUE_PATH[0].x, BLUE_PATH[0].y);
    for (const point of BLUE_PATH.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    g.lineStyle(6, COLORS.gold, 0.22);
    g.beginPath();
    g.moveTo(BLUE_PATH[0].x, BLUE_PATH[0].y);
    for (const point of BLUE_PATH.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    for (const [index, point] of BLUE_PATH.entries()) {
      const color = index < 3 ? COLORS.blue : index > 3 ? COLORS.red : COLORS.gold;
      g.fillStyle(color, index === 3 ? 0.2 : 0.13);
      g.fillCircle(point.x, point.y, index === 3 ? 74 : 38);
      g.lineStyle(2, color, index === 3 ? 0.42 : 0.24);
      g.strokeCircle(point.x, point.y, index === 3 ? 74 : 38);
    }

    // Bases.
    g.fillStyle(COLORS.blueDark, 0.18);
    g.fillCircle(190, 600, 220);
    g.lineStyle(5, COLORS.blue, 0.38);
    g.strokeCircle(190, 600, 220);

    g.fillStyle(COLORS.redDark, 0.18);
    g.fillCircle(2010, 600, 220);
    g.lineStyle(5, COLORS.red, 0.38);
    g.strokeCircle(2010, 600, 220);

    // Map grid accents.
    g.lineStyle(1, 0xffffff, 0.035);
    for (let x = 0; x <= MAP_WIDTH; x += 100) g.lineBetween(x, 0, x, MAP_HEIGHT);
    for (let y = 0; y <= MAP_HEIGHT; y += 100) g.lineBetween(0, y, MAP_WIDTH, y);

    // Decorative energy rings.
    g.lineStyle(3, COLORS.purple, 0.2);
    g.strokeCircle(1100, 600, 180);
    g.strokeCircle(1100, 600, 250);

    this.ambient = this.add.graphics().setDepth(-20);
  }

  private updateAmbient(time: number) {
    this.ambient.clear();
    const pulse = 0.5 + Math.sin(time / 680) * 0.5;
    this.ambient.lineStyle(3, COLORS.gold, 0.14 + pulse * 0.12);
    this.ambient.strokeCircle(1100, 600, 170 + pulse * 10);
    this.ambient.lineStyle(2, COLORS.blue, 0.08 + pulse * 0.08);
    this.ambient.strokeCircle(190, 600, 205 + pulse * 8);
    this.ambient.lineStyle(2, COLORS.red, 0.08 + pulse * 0.08);
    this.ambient.strokeCircle(2010, 600, 205 + pulse * 8);
  }

  private createStructures() {
    if (this.tutorialMode) {
      this.createStructure('blue', 'core', 'Синее ядро', 190, 600, 70, 3300, 0, 0, 0, 0);
      this.tutorialCore = this.createStructure('red', 'core', 'Учебное красное ядро', 2010, 600, 70, 520, 0, 0, 0, 0);
      this.tutorialCore.tutorialTag = 'core';
      this.createStructure('blue', 'tower', 'Союзная башня', 560, 610, 43, 1350, 0, 0, 0, 1180);
      this.tutorialTower = this.createStructure('red', 'tower', 'Учебная башня', 1350, 642, 43, 440, 0, 0, 0, 1180);
      this.tutorialTower.tutorialTag = 'tower';
      return;
    }

    this.createStructure('blue', 'core', 'Синее ядро', 190, 600, 70, 3300, 0, 0, 0, 0);
    this.createStructure('red', 'core', 'Красное ядро', 2010, 600, 70, 3300, 0, 0, 0, 0);

    this.createStructure('blue', 'tower', 'Башня B1', 560, 610, 43, 1350, 92, 340, 0, 1180);
    this.createStructure('blue', 'tower', 'Башня B2', 850, 558, 43, 1350, 92, 340, 0, 1180);
    this.createStructure('red', 'tower', 'Башня R1', 1640, 610, 43, 1350, 92, 340, 0, 1180);
    this.createStructure('red', 'tower', 'Башня R2', 1350, 642, 43, 1350, 92, 340, 0, 1180);
  }

  private createTeams() {
    this.player = this.createHero(this.selectedHero, 'blue', this.tutorialMode ? 310 : 320, this.tutorialMode ? 570 : 570, 'player');

    if (this.tutorialMode) {
      this.tutorialTargetDummy = this.createHero(HEROES[1], 'red', 650, 570, 'bot');
      this.tutorialTargetDummy.controller = 'structure';
      this.tutorialTargetDummy.name = 'Манекен';
      this.tutorialTargetDummy.tutorialTag = 'dummy';
      this.tutorialTargetDummy.maxHp = 1100;
      this.tutorialTargetDummy.hp = 1100;
      this.tutorialTargetDummy.damage = 0;
      this.tutorialTargetDummy.speed = 0;
      this.tutorialTargetDummy.range = 0;
      this.tutorialTargetDummy.levelText?.setText('Манекен');
      return;
    }

    const allyPool = HEROES.filter((hero) => hero.id !== this.selectedHero.id);
    this.createHero(allyPool[0] ?? HEROES[1], 'blue', 270, 660, 'bot');
    this.createHero(allyPool[1] ?? HEROES[2], 'blue', 300, 500, 'bot');

    this.createHero(HEROES[0], 'red', 1880, 570, 'bot');
    this.createHero(HEROES[1], 'red', 1930, 660, 'bot');
    this.createHero(HEROES[2], 'red', 1900, 500, 'bot');
  }

  private createInput() {
    if (this.input.keyboard) {
      this.controls = this.input.keyboard.addKeys({
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
        UP: Phaser.Input.Keyboard.KeyCodes.UP,
        LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
        DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
        RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        J: Phaser.Input.Keyboard.KeyCodes.J,
        K: Phaser.Input.Keyboard.KeyCodes.K,
        L: Phaser.Input.Keyboard.KeyCodes.L,
        SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
      }) as Record<string, Phaser.Input.Keyboard.Key>;
    }

    this.input.addPointer(2);

    this.joystickBase = this.add.circle(132, GAME_HEIGHT - 122, 72, 0xffffff, 0.07)
      .setStrokeStyle(3, COLORS.blue, 0.28)
      .setScrollFactor(0)
      .setDepth(1000);
    this.joystickKnob = this.add.circle(132, GAME_HEIGHT - 122, 32, COLORS.blue, 0.35)
      .setStrokeStyle(3, COLORS.white, 0.45)
      .setScrollFactor(0)
      .setDepth(1001);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < GAME_WIDTH * 0.46 && pointer.y > 120) {
        this.joystickActive = true;
        this.joystickPointerId = pointer.id;
        this.joystickOrigin.set(pointer.x, pointer.y);
        this.joystickBase.setPosition(pointer.x, pointer.y).setAlpha(1);
        this.joystickKnob.setPosition(pointer.x, pointer.y).setAlpha(1);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.joystickActive || pointer.id !== this.joystickPointerId) return;
      const dx = pointer.x - this.joystickOrigin.x;
      const dy = pointer.y - this.joystickOrigin.y;
      const vector = new Phaser.Math.Vector2(dx, dy);
      if (vector.length() > 72) vector.setLength(72);
      this.joystickVector.set(vector.x / 72, vector.y / 72);
      this.joystickKnob.setPosition(this.joystickOrigin.x + vector.x, this.joystickOrigin.y + vector.y);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId) return;
      this.resetJoystick();
    });
  }

  private resetJoystick() {
    this.joystickActive = false;
    this.joystickPointerId = -1;
    this.joystickVector.set(0, 0);
    this.joystickBase.setPosition(132, GAME_HEIGHT - 122).setAlpha(0.75);
    this.joystickKnob.setPosition(132, GAME_HEIGHT - 122).setAlpha(0.75);
  }

  private createHud() {
    const hudVisual = heroVisual(this.selectedHero, true);
    const topPanel = this.add.rectangle(GAME_WIDTH / 2, 34, 500, 56, 0x070512, 0.78)
      .setStrokeStyle(2, COLORS.blue, 0.42)
      .setScrollFactor(0)
      .setDepth(1000);

    this.add.text(topPanel.x - 195, topPanel.y, 'BLUE', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '16px',
      color: colorToCss(COLORS.blue)
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    this.scoreText = this.add.text(topPanel.x - 70, topPanel.y, '0  :  0', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '28px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    this.add.text(topPanel.x + 50, topPanel.y, 'RED', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '16px',
      color: colorToCss(COLORS.red)
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    this.timerText = this.add.text(topPanel.x + 178, topPanel.y, '00:00', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    const infoBg = this.add.rectangle(292, 43, 500, 66, 0x070512, 0.76)
      .setStrokeStyle(2, hudVisual.accent, 0.55)
      .setScrollFactor(0)
      .setDepth(1000);
    createPortraitFrame(this, 58, 43, `portrait_${this.selectedHero.id}`, 58, 58, hudVisual.accent, 1002).setScrollFactor(0);
    this.playerHpFill = this.add.rectangle(infoBg.x - 172, infoBg.y + 23, 350, 9, COLORS.green, 0.95)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.playerInfoText = this.add.text(infoBg.x - 174, infoBg.y - 9, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '17px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);

    this.createAbilityButton(GAME_WIDTH - 104, GAME_HEIGHT - 122, 54, 'attack', 'J', 'АТК', COLORS.gold, () => this.playerAttack());
    this.createAbilityButton(GAME_WIDTH - 230, GAME_HEIGHT - 116, 44, 'primary', 'K', this.selectedHero.abilities.primary.label, hudVisual.color, () => this.castAbility(this.player, 'primary', true));
    this.createAbilityButton(GAME_WIDTH - 330, GAME_HEIGHT - 92, 44, 'secondary', 'L', this.selectedHero.abilities.secondary.label, hudVisual.accent, () => this.castAbility(this.player, 'secondary', true));
    this.createAbilityButton(GAME_WIDTH - 212, GAME_HEIGHT - 220, 52, 'ultimate', 'SP', this.selectedHero.abilities.ultimate.label, COLORS.purple, () => this.castAbility(this.player, 'ultimate', true));

    const miniBg = this.add.rectangle(GAME_WIDTH - 118, 96, 184, 112, 0x070512, 0.68)
      .setStrokeStyle(1, COLORS.white, 0.2)
      .setScrollFactor(0)
      .setDepth(1000);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(1001);
    this.add.text(miniBg.x, miniBg.y - 72, 'MINI MAP', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    const tip = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 28, 'Уничтожьте красное ядро. Не стойте под башнями без миньонов.', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: colorToCss(0xcfd5ff)
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    this.tweens.add({ targets: tip, alpha: 0.45, yoyo: true, repeat: -1, duration: 1200 });
  }

  private createAbilityButton(
    x: number,
    y: number,
    radius: number,
    slot: AbilitySlot | 'attack',
    hotkey: string,
    labelText: string,
    color: number,
    action: () => void
  ) {
    const container = this.add.container(x, y).setScrollFactor(0).setDepth(1002);
    const outer = this.add.circle(0, 0, radius + 10, 0x000000, 0.42).setStrokeStyle(2, color, 0.5);
    const diamond = this.add.polygon(0, 0, [0, -radius, radius, 0, 0, radius, -radius, 0], color, 0.1)
      .setStrokeStyle(1, color, 0.32)
      .setRotation(0.78);
    const ring = this.add.circle(0, 0, radius, color, 0.32).setStrokeStyle(3, COLORS.white, 0.45)
      .setInteractive(new Phaser.Geom.Circle(0, 0, radius + 8), Phaser.Geom.Circle.Contains);
    const glyph = this.add.text(0, -18, slot === 'attack' ? '✦' : slot === 'primary' ? 'I' : slot === 'secondary' ? 'II' : 'ULT', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: slot === 'ultimate' ? '16px' : '20px',
      color: colorToCss(COLORS.white),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setAlpha(0.78);
    const label = this.add.text(0, slot === 'attack' ? 9 : 10, labelText, {
      fontFamily: 'Arial, sans-serif',
      fontSize: slot === 'attack' ? '17px' : '13px',
      fontStyle: 'bold',
      color: colorToCss(COLORS.white),
      align: 'center'
    }).setOrigin(0.5);
    const key = this.add.text(0, radius - 14, hotkey, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: colorToCss(COLORS.muted)
    }).setOrigin(0.5);
    const cdText = this.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '24px',
      color: colorToCss(COLORS.gold),
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    ring.on('pointerdown', () => {
      haptic(slot === 'ultimate' ? 'heavy' : 'light');
      this.tweens.add({ targets: container, scale: 0.92, duration: 55, yoyo: true });
      action();
    });

    container.add([outer, diamond, ring, glyph, label, key, cdText]);
    this.abilityButtons.push({ slot, container, ring, cdText, label, readyColor: color });
  }

  private createStructure(
    team: Team,
    kind: 'tower' | 'core',
    name: string,
    x: number,
    y: number,
    radius: number,
    hp: number,
    damage: number,
    range: number,
    speed: number,
    attackCooldown: number
  ) {
    const view = this.add.container(x, y).setDepth(y);
    const baseColor = teamColor(team);
    const platform = this.add.circle(0, 0, radius + 18, baseColor, 0.12).setStrokeStyle(3, baseColor, 0.45);
    const body = kind === 'core'
      ? this.add.circle(0, 0, radius, baseColor, 0.92).setStrokeStyle(6, COLORS.white, 0.36)
      : this.add.rectangle(0, 0, radius * 1.35, radius * 1.9, baseColor, 0.92).setStrokeStyle(4, COLORS.white, 0.36);

    if (kind === 'tower') {
      const crystal = this.add.triangle(0, -42, 0, -26, 28, 26, -28, 26, team === 'blue' ? COLORS.blue : COLORS.red, 0.9);
      view.add([platform, body, crystal]);
    } else {
      const coreGlow = this.add.circle(0, 0, radius - 20, 0xffffff, 0.18);
      view.add([platform, body, coreGlow]);
    }

    const hpBg = this.add.rectangle(-50, -radius - 26, 100, 9, 0x000000, 0.55).setOrigin(0, 0.5);
    const hpFill = this.add.rectangle(-50, -radius - 26, 100, 9, COLORS.green, 0.95).setOrigin(0, 0.5);
    view.add([hpBg, hpFill]);

    const actor: Actor = {
      id: `${kind}-${team}-${this.actorSeq++}`,
      team,
      kind,
      controller: kind === 'tower' ? 'tower' : 'structure',
      name,
      view,
      body,
      hpFill,
      hpBg,
      radius,
      maxHp: hp,
      hp,
      damage,
      range,
      speed,
      attackCooldown,
      lastAttack: -9999,
      dead: false,
      level: 1,
      xp: 0,
      gold: 0,
      kills: 0,
      deaths: 0,
      spawn: new Phaser.Math.Vector2(x, y)
    };

    this.actors.push(actor);
    return actor;
  }

  private createHero(config: HeroConfig, team: Team, x: number, y: number, controller: 'player' | 'bot'): Actor {
    const visual = heroVisual(config, controller === 'player');
    const view = this.add.container(x, y).setDepth(y);
    const shadow = this.add.ellipse(0, 24, 58, 19, 0x000000, 0.34);
    const teamRing = this.add.circle(0, 0, 36, teamColor(team), 0.1).setStrokeStyle(3, teamColor(team), 0.78);
    const aura = this.add.circle(0, 0, 34, visual.color, 0.18).setStrokeStyle(2, visual.accent, 0.78);
    const cloak = this.add.triangle(0, 12, -24, 36, 24, 36, 0, -20, visual.color, 0.36)
      .setStrokeStyle(2, visual.accent, 0.36);
    const legs = this.add.rectangle(0, 18, 26, 30, visual.color, 0.8).setStrokeStyle(2, 0xffffff, 0.22);
    const body = this.add.ellipse(0, -1, 34, 46, visual.color, 0.98).setStrokeStyle(4, COLORS.white, controller === 'player' ? 0.95 : 0.42);
    const chest = this.add.rectangle(0, -2, 24, 8, visual.accent, 0.7).setRotation(-0.1);
    const face = this.add.circle(0, -30, 13, 0xffd9bf, 0.98).setStrokeStyle(2, visual.accent, 0.72);
    const hair = this.add.triangle(0, -44, -18, -31, 0, -58, 18, -31, visual.color, 0.98);
    const scarf = this.add.rectangle(-25, -19, 34, 6, visual.accent, 0.86).setRotation(0.25);
    const weapon = this.add.rectangle(30, -8, config.id === 'teo' ? 34 : 54, 6, visual.accent, 0.95).setRotation(config.id === 'teo' ? 0.2 : -0.48);
    const hpBg = this.add.rectangle(-38, -58, 76, 8, 0x000000, 0.56).setOrigin(0, 0.5);
    const hpFill = this.add.rectangle(-38, -58, 76, 8, COLORS.green, 0.96).setOrigin(0, 0.5);
    const levelText = this.add.text(0, -75, controller === 'player' ? `Вы · ${config.name}` : config.name, {
      fontFamily: 'Arial, sans-serif',
      fontSize: controller === 'player' ? '15px' : '12px',
      fontStyle: controller === 'player' ? 'bold' : 'normal',
      color: colorToCss(team === 'blue' ? COLORS.blue : COLORS.red),
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    view.add([shadow, teamRing, aura, cloak, legs, body, chest, face, hair, scarf, weapon, hpBg, hpFill, levelText]);

    const actor: Actor = {
      id: `hero-${team}-${config.id}-${this.actorSeq++}`,
      team,
      kind: 'hero',
      controller,
      name: config.name,
      heroId: config.id,
      role: config.role,
      view,
      body,
      hpFill,
      hpBg,
      levelText,
      radius: 28,
      maxHp: config.maxHp,
      hp: config.maxHp,
      damage: config.damage,
      range: config.range,
      speed: config.speed,
      attackCooldown: config.attackCooldown,
      lastAttack: -9999,
      abilityReadyAt: { primary: 0, secondary: 0, ultimate: 0 },
      dead: false,
      level: 1,
      xp: 0,
      gold: 0,
      kills: 0,
      deaths: 0,
      spawn: new Phaser.Math.Vector2(x, y),
      nextThinkAt: 0
    };

    this.actors.push(actor);
    this.tweens.add({ targets: aura, scale: 1.18, alpha: 0.36, yoyo: true, repeat: -1, duration: 920 + Phaser.Math.Between(0, 260) });
    return actor;
  }

  private createMinion(team: Team, x: number, y: number, waveOffset: number): Actor {
    const view = this.add.container(x, y + waveOffset).setDepth(y);
    const color = teamColor(team);
    const body = this.add.circle(0, 0, 15, color, 0.95).setStrokeStyle(3, COLORS.white, 0.28);
    const blade = this.add.rectangle(15, -3, 22, 4, COLORS.gold, 0.85).setRotation(-0.2);
    const hpBg = this.add.rectangle(-22, -28, 44, 6, 0x000000, 0.55).setOrigin(0, 0.5);
    const hpFill = this.add.rectangle(-22, -28, 44, 6, COLORS.green, 0.95).setOrigin(0, 0.5);
    view.add([body, blade, hpBg, hpFill]);

    const actor: Actor = {
      id: `minion-${team}-${this.actorSeq++}`,
      team,
      kind: 'minion',
      controller: 'minion',
      name: `${team === 'blue' ? 'Синий' : 'Красный'} миньон`,
      view,
      body,
      hpFill,
      hpBg,
      radius: 17,
      maxHp: 235,
      hp: 235,
      damage: 24,
      range: 70,
      speed: 118,
      attackCooldown: 930,
      lastAttack: -9999,
      dead: false,
      level: 1,
      xp: 0,
      gold: 0,
      kills: 0,
      deaths: 0,
      spawn: new Phaser.Math.Vector2(x, y + waveOffset),
      pathIndex: 1
    };

    this.actors.push(actor);
    return actor;
  }

  private spawnWave() {
    for (let i = 0; i < 4; i += 1) {
      this.createMinion('blue', 260 - i * 22, 610, (i - 1.5) * 20);
      this.createMinion('red', 1940 + i * 22, 600, (i - 1.5) * 20);
    }

    if (this.matchStartedAt > 0 && this.time.now - this.matchStartedAt > 1000) {
      this.spawnFloatingText(1100, 515, 'Новая волна миньонов', COLORS.gold, 22);
    }
  }

  private updatePlayer(time: number, dt: number) {
    if (this.player.dead) return;

    const vector = new Phaser.Math.Vector2(this.joystickVector.x, this.joystickVector.y);
    if (this.controls) {
      const left = this.controls.A?.isDown || this.controls.LEFT?.isDown;
      const right = this.controls.D?.isDown || this.controls.RIGHT?.isDown;
      const up = this.controls.W?.isDown || this.controls.UP?.isDown;
      const down = this.controls.S?.isDown || this.controls.DOWN?.isDown;
      vector.x += (right ? 1 : 0) - (left ? 1 : 0);
      vector.y += (down ? 1 : 0) - (up ? 1 : 0);

      if (Phaser.Input.Keyboard.JustDown(this.controls.J)) this.playerAttack();
      if (Phaser.Input.Keyboard.JustDown(this.controls.K)) this.castAbility(this.player, 'primary', true);
      if (Phaser.Input.Keyboard.JustDown(this.controls.L)) this.castAbility(this.player, 'secondary', true);
      if (Phaser.Input.Keyboard.JustDown(this.controls.SPACE)) this.castAbility(this.player, 'ultimate', true);
    }

    if (vector.lengthSq() > 0.0001) {
      vector.normalize();
      if (this.tutorialMode) this.tutorialMoveDistance += this.player.speed * dt;
      this.moveActor(this.player, vector, dt);
      if (!this.tutorialMode && time >= this.nextMoveEventAt) {
        this.recordEvent('move', {
          actor: this.actorSnapshot(this.player),
          x: this.player.view.x,
          y: this.player.view.y,
          data: { hp: Math.round(this.player.hp) }
        });
        this.nextMoveEventAt = time + 750;
      }
      if (!this.tutorialMode && time >= this.nextActionMoveAt) {
        this.recordAction('move', {
          x: this.player.view.x,
          y: this.player.view.y,
          dx: vector.x,
          dy: vector.y,
          data: { hp: Math.round(this.player.hp) }
        });
        this.nextActionMoveAt = time + 500;
        this.lastActionMoving = true;
      }
      this.player.view.setRotation(vector.angle() * 0.05);
    } else {
      if (!this.tutorialMode && this.lastActionMoving) {
        this.recordAction('move', {
          x: this.player.view.x,
          y: this.player.view.y,
          dx: 0,
          dy: 0,
          data: { hp: Math.round(this.player.hp), stop: true }
        });
        this.nextActionMoveAt = time + 500;
        this.lastActionMoving = false;
      }
      this.player.view.setRotation(0);
    }
  }

  private updateBotHero(actor: Actor, time: number, dt: number) {
    if (actor.stunnedUntil && actor.stunnedUntil > time) return;

    const lowHp = actor.hp / actor.maxHp < 0.28;
    const nearestDanger = this.getNearestEnemy(actor, 520, true);

    if (lowHp && nearestDanger) {
      const retreatPoint = actor.team === 'blue' ? BLUE_PATH[0] : RED_PATH[0];
      this.moveToward(actor, retreatPoint.x, retreatPoint.y, dt);
      if (this.distanceTo(actor, nearestDanger) < actor.range) this.basicAttack(actor, nearestDanger);
      return;
    }

    const target = this.chooseBestTarget(actor, 520);
    if (target) {
      const dist = this.distanceTo(actor, target);
      if (dist > actor.range * 0.82) {
        this.moveToward(actor, target.view.x, target.view.y, dt);
      } else {
        this.basicAttack(actor, target);
      }

      if (!actor.nextThinkAt || actor.nextThinkAt < time) {
        this.tryBotCast(actor, target, time);
        actor.nextThinkAt = time + Phaser.Math.Between(520, 980);
      }
      return;
    }

    const point = actor.team === 'blue' ? new Phaser.Math.Vector2(1900, 600) : new Phaser.Math.Vector2(300, 600);
    this.moveToward(actor, point.x, point.y + Phaser.Math.Between(-30, 30), dt);
  }

  private tryBotCast(actor: Actor, target: Actor, time: number) {
    const dist = this.distanceTo(actor, target);
    const hpPct = target.hp / target.maxHp;

    if (actor.abilityReadyAt?.ultimate !== undefined && actor.abilityReadyAt.ultimate <= time) {
      if (hpPct < 0.48 || this.countEnemiesNear(actor.team, actor.view.x, actor.view.y, 270) >= 2) {
        this.castAbility(actor, 'ultimate', false);
        return;
      }
    }
    if (actor.abilityReadyAt?.secondary !== undefined && actor.abilityReadyAt.secondary <= time && dist < 330) {
      this.castAbility(actor, 'secondary', false);
      return;
    }
    if (actor.abilityReadyAt?.primary !== undefined && actor.abilityReadyAt.primary <= time && dist < 360) {
      this.castAbility(actor, 'primary', false);
    }
  }

  private updateMinion(actor: Actor, time: number, dt: number) {
    const target = this.chooseBestTarget(actor, 260);
    if (target) {
      const dist = this.distanceTo(actor, target);
      if (dist > actor.range * 0.88) this.moveToward(actor, target.view.x, target.view.y, dt);
      else this.basicAttack(actor, target);
      return;
    }

    const path = actor.team === 'blue' ? BLUE_PATH : RED_PATH;
    const idx = Math.min(actor.pathIndex ?? 1, path.length - 1);
    const waypoint = path[idx];
    this.moveToward(actor, waypoint.x, waypoint.y, dt);
    if (Phaser.Math.Distance.Between(actor.view.x, actor.view.y, waypoint.x, waypoint.y) < 36) {
      actor.pathIndex = Math.min(idx + 1, path.length - 1);
    }

    // Minions chip the core if they reach the end.
    const enemyCore = this.actors.find((a) => a.kind === 'core' && a.team !== actor.team && !a.dead);
    if (enemyCore && this.distanceTo(actor, enemyCore) < actor.range + enemyCore.radius) {
      this.basicAttack(actor, enemyCore);
    }
  }

  private updateTower(actor: Actor, time: number) {
    const target = this.chooseBestTarget(actor, actor.range);
    if (!target) return;
    if (time < actor.lastAttack + actor.attackCooldown) return;
    actor.lastAttack = time;
    this.spawnProjectile(actor, target.view.x, target.view.y, actor.damage, 560, 9, actor.team === 'blue' ? COLORS.blue : COLORS.red, 1300);
    this.flash(actor.body, COLORS.white);
  }

  private playerAttack() {
    if (this.player.dead) return;
    const target = this.chooseBestTarget(this.player, this.player.range + 60);
    if (!target) {
      this.spawnFloatingText(this.player.view.x, this.player.view.y - 80, 'Нет цели', COLORS.muted, 18);
      return;
    }
    if (this.tutorialMode) this.markTutorialAction('attack');
    this.basicAttack(this.player, target);
  }

  private basicAttack(source: Actor, target: Actor) {
    const time = this.time.now;
    if (source.dead || target.dead) return;
    if (time < source.lastAttack + source.attackCooldown) return;
    if (this.distanceTo(source, target) > source.range + source.radius + target.radius + 12) return;

    source.lastAttack = time;
    if (source.controller === 'player') {
      const actionPayload = {
        target: this.actorSnapshot(target),
        x: source.view.x,
        y: source.view.y,
        targetX: target.view.x,
        targetY: target.view.y
      };
      this.recordEvent('attack', {
        actor: this.actorSnapshot(source),
        ...actionPayload
      });
      this.recordAction('attack', actionPayload);
    }
    const auraBonus = source.auraUntil && source.auraUntil > time ? 1.35 : 1;
    const levelBonus = 1 + (source.level - 1) * 0.06;
    const damage = Math.round(source.damage * auraBonus * levelBonus);

    if (source.range > 150 || source.kind === 'tower') {
      this.spawnProjectile(source, target.view.x, target.view.y, damage, source.kind === 'tower' ? 560 : 470, 8, source.heroId === 'teo' ? COLORS.blue : teamColor(source.team));
    } else {
      this.spawnSlash(source, target, source.heroId === 'reyna' ? 0xd8f3ff : source.heroId === 'kairo' ? 0xffa23a : COLORS.white);
      this.dealDamage(source, target, damage);
    }

    this.flash(source.body, COLORS.white);
  }

  private castAbility(actor: Actor, slot: AbilitySlot, manual: boolean) {
    if (actor.dead || actor.kind !== 'hero' || !actor.heroId || !actor.abilityReadyAt) return;
    const time = this.time.now;
    if (actor.abilityReadyAt[slot] > time) {
      if (manual) this.spawnFloatingText(actor.view.x, actor.view.y - 84, 'Перезарядка', COLORS.muted, 18);
      return;
    }

    const config = heroById(actor.heroId);
    actor.abilityReadyAt[slot] = time + config.abilities[slot].cooldown;
    if (this.tutorialMode && actor.controller === 'player' && manual) this.markTutorialAction(slot);
    if (actor.controller === 'player') {
      const target = this.getNearestEnemy(actor, 520, true);
      const actionPayload = {
        target: target ? this.actorSnapshot(target) : undefined,
        slot,
        x: actor.view.x,
        y: actor.view.y,
        targetX: target?.view.x,
        targetY: target?.view.y
      };
      this.recordEvent('cast', {
        actor: this.actorSnapshot(actor),
        ...actionPayload
      });
      this.recordAction('cast', actionPayload);
    }
    haptic(slot === 'ultimate' && actor.controller === 'player' ? 'heavy' : 'light');

    if (config.id === 'kairo') this.castKairo(actor, slot);
    if (config.id === 'reyna') this.castReyna(actor, slot);
    if (config.id === 'teo') this.castTeo(actor, slot);
  }

  private castKairo(actor: Actor, slot: AbilitySlot) {
    if (slot === 'primary') {
      const dir = this.directionForAbility(actor, 320);
      const start = new Phaser.Math.Vector2(actor.view.x, actor.view.y);
      const end = start.clone().add(dir.scale(210));
      this.placeActor(actor, end.x, end.y);
      this.spawnLineEffect(start.x, start.y, actor.view.x, actor.view.y, 0xff8a2f, 16);
      this.damageEnemiesInLine(actor, start, new Phaser.Math.Vector2(actor.view.x, actor.view.y), 62 + actor.damage * 0.75, 62);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Пламенный рывок', 0xffd166, 18);
    }

    if (slot === 'secondary') {
      this.spawnRing(actor.view.x, actor.view.y, 122, 0xff7a22, 0.32);
      this.damageEnemiesInRadius(actor, actor.view.x, actor.view.y, 122, 96 + actor.damage * 0.9);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Комбо искр', 0xffd166, 18);
    }

    if (slot === 'ultimate') {
      actor.auraUntil = this.time.now + 6000;
      this.spawnRing(actor.view.x, actor.view.y, 170, 0xffb238, 0.36);
      this.spawnFloatingText(actor.view.x, actor.view.y - 94, 'Сердце сверхновой!', 0xffd166, 24);
    }
  }

  private castReyna(actor: Actor, slot: AbilitySlot) {
    if (slot === 'primary') {
      const dir = this.directionForAbility(actor, 260);
      const origin = new Phaser.Math.Vector2(actor.view.x, actor.view.y);
      const end = origin.clone().add(dir.clone().scale(150));
      this.spawnLineEffect(actor.view.x - dir.y * 42, actor.view.y + dir.x * 42, end.x + dir.y * 42, end.y - dir.x * 42, 0xd8f3ff, 10);
      this.damageEnemiesInLine(actor, origin, end, 92 + actor.damage * 0.72, 74);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Лунный срез', 0xd8f3ff, 18);
    }

    if (slot === 'secondary') {
      const target = this.getNearestEnemy(actor, 280, true);
      const start = new Phaser.Math.Vector2(actor.view.x, actor.view.y);
      if (target) {
        const dir = new Phaser.Math.Vector2(target.view.x - actor.view.x, target.view.y - actor.view.y).normalize();
        this.placeActor(actor, target.view.x - dir.x * 46, target.view.y - dir.y * 46);
        this.dealDamage(actor, target, 62 + actor.damage * 0.58);
      } else {
        const dir = this.directionForAbility(actor, 260);
        this.placeActor(actor, actor.view.x + dir.x * 190, actor.view.y + dir.y * 190);
      }
      this.spawnLineEffect(start.x, start.y, actor.view.x, actor.view.y, 0x7fd7ff, 12);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Теневая позиция', 0xd8f3ff, 18);
    }

    if (slot === 'ultimate') {
      const enemies = this.getEnemiesInRadius(actor.team, actor.view.x, actor.view.y, 295)
        .filter((enemy) => enemy.kind !== 'core')
        .slice(0, 5);
      this.spawnRing(actor.view.x, actor.view.y, 292, 0xd8f3ff, 0.28);
      enemies.forEach((enemy, index) => {
        this.time.delayedCall(index * 120, () => {
          if (actor.dead || enemy.dead) return;
          this.spawnLineEffect(actor.view.x, actor.view.y, enemy.view.x, enemy.view.y, 0xd8f3ff, 12);
          this.dealDamage(actor, enemy, 106 + actor.damage * 0.5);
        });
      });
      this.spawnFloatingText(actor.view.x, actor.view.y - 94, 'Полночный танец!', 0xd8f3ff, 24);
    }
  }

  private castTeo(actor: Actor, slot: AbilitySlot) {
    if (slot === 'primary') {
      const target = this.getNearestEnemy(actor, 420, true);
      const dir = target
        ? new Phaser.Math.Vector2(target.view.x - actor.view.x, target.view.y - actor.view.y).normalize()
        : this.directionForAbility(actor, 320);
      const targetX = actor.view.x + dir.x * 420;
      const targetY = actor.view.y + dir.y * 420;
      this.spawnProjectile(actor, targetX, targetY, 118 + actor.damage * 0.55, 620, 12, 0x62f2ff, 1050);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Искровой заряд', 0x62f2ff, 18);
    }

    if (slot === 'secondary') {
      const target = this.getNearestEnemy(actor, 380, true);
      const x = target ? target.view.x : actor.view.x + this.directionForAbility(actor, 300).x * 250;
      const y = target ? target.view.y : actor.view.y + this.directionForAbility(actor, 300).y * 250;
      this.createZone(actor, x, y, 125, 38 + actor.damage * 0.18, 4700, 650, 0x62f2ff, true);
      this.spawnFloatingText(actor.view.x, actor.view.y - 78, 'Грозовая печать', 0x62f2ff, 18);
    }

    if (slot === 'ultimate') {
      const target = this.getNearestEnemy(actor, 520, true);
      const x = target ? target.view.x : actor.view.x + this.directionForAbility(actor, 420).x * 320;
      const y = target ? target.view.y : actor.view.y + this.directionForAbility(actor, 420).y * 320;
      const warning = this.add.circle(x, y, 170, 0x62f2ff, 0.08).setStrokeStyle(5, 0x62f2ff, 0.68).setDepth(y + 5);
      this.tweens.add({ targets: warning, scale: 1.18, alpha: 0.2, duration: 720, yoyo: true });
      this.time.delayedCall(780, () => {
        warning.destroy();
        this.spawnRing(x, y, 186, 0x62f2ff, 0.38);
        this.damageEnemiesInRadius(actor, x, y, 186, 176 + actor.damage * 0.96);
        this.cameras.main.shake(160, 0.004);
      });
      this.spawnFloatingText(actor.view.x, actor.view.y - 94, 'Небесный разряд!', 0x62f2ff, 24);
    }
  }

  private directionForAbility(actor: Actor, searchRange: number): Phaser.Math.Vector2 {
    const target = this.getNearestEnemy(actor, searchRange, true);
    if (target) {
      return new Phaser.Math.Vector2(target.view.x - actor.view.x, target.view.y - actor.view.y).normalize();
    }

    if (actor.controller === 'player' && this.joystickVector.lengthSq() > 0.01) {
      return this.joystickVector.clone().normalize();
    }

    return new Phaser.Math.Vector2(actor.team === 'blue' ? 1 : -1, 0);
  }

  private moveActor(actor: Actor, direction: Phaser.Math.Vector2, dt: number) {
    if (actor.stunnedUntil && actor.stunnedUntil > this.time.now) return;
    const slow = actor.slowUntil && actor.slowUntil > this.time.now ? 0.62 : 1;
    const speed = actor.speed * slow;
    this.placeActor(actor, actor.view.x + direction.x * speed * dt, actor.view.y + direction.y * speed * dt);
  }

  private moveToward(actor: Actor, x: number, y: number, dt: number) {
    const direction = new Phaser.Math.Vector2(x - actor.view.x, y - actor.view.y);
    if (direction.lengthSq() < 2) return;
    direction.normalize();
    this.moveActor(actor, direction, dt);
  }

  private placeActor(actor: Actor, x: number, y: number) {
    actor.view.setPosition(
      Phaser.Math.Clamp(x, actor.radius, MAP_WIDTH - actor.radius),
      Phaser.Math.Clamp(y, actor.radius, MAP_HEIGHT - actor.radius)
    );
    actor.view.setDepth(actor.view.y);
  }

  private chooseBestTarget(actor: Actor, range: number): Actor | undefined {
    const enemies = this.actors.filter((candidate) => {
      if (candidate.dead || candidate.team === actor.team) return false;
      if (candidate.kind === 'core') {
        const enemyTowersAlive = this.actors.some((a) => a.team === candidate.team && a.kind === 'tower' && !a.dead);
        if (enemyTowersAlive) return false;
      }
      return this.distanceTo(actor, candidate) <= range + candidate.radius;
    });

    if (enemies.length === 0) return undefined;

    const priority = (target: Actor) => {
      let value = 0;
      if (target.kind === 'hero') value += 1200;
      if (target.kind === 'minion') value += 700;
      if (target.kind === 'tower') value += 420;
      if (target.kind === 'core') value += 300;
      value += (1 - target.hp / target.maxHp) * 350;
      value -= this.distanceTo(actor, target) * 0.5;
      return value;
    };

    return enemies.sort((a, b) => priority(b) - priority(a))[0];
  }

  private getNearestEnemy(actor: Actor, range: number, includeStructures = false): Actor | undefined {
    let best: Actor | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of this.actors) {
      if (candidate.dead || candidate.team === actor.team) continue;
      if (!includeStructures && candidate.kind !== 'hero' && candidate.kind !== 'minion') continue;
      const dist = this.distanceTo(actor, candidate);
      if (dist <= range && dist < bestDistance) {
        best = candidate;
        bestDistance = dist;
      }
    }
    return best;
  }

  private countEnemiesNear(team: Team, x: number, y: number, radius: number): number {
    return this.actors.filter((candidate) =>
      !candidate.dead &&
      candidate.team !== team &&
      candidate.kind !== 'core' &&
      Phaser.Math.Distance.Between(x, y, candidate.view.x, candidate.view.y) <= radius
    ).length;
  }

  private getEnemiesInRadius(team: Team, x: number, y: number, radius: number): Actor[] {
    return this.actors.filter((candidate) =>
      !candidate.dead &&
      candidate.team !== team &&
      Phaser.Math.Distance.Between(x, y, candidate.view.x, candidate.view.y) <= radius + candidate.radius
    );
  }

  private damageEnemiesInRadius(source: Actor, x: number, y: number, radius: number, damage: number) {
    for (const enemy of this.getEnemiesInRadius(source.team, x, y, radius)) {
      this.dealDamage(source, enemy, damage);
    }
  }

  private damageEnemiesInLine(source: Actor, start: Phaser.Math.Vector2, end: Phaser.Math.Vector2, damage: number, width: number) {
    const line = new Phaser.Geom.Line(start.x, start.y, end.x, end.y);
    for (const enemy of this.actors) {
      if (enemy.dead || enemy.team === source.team) continue;
      const dist = Phaser.Geom.Line.GetShortestDistance(line, new Phaser.Geom.Point(enemy.view.x, enemy.view.y));
      if (typeof dist === 'number' && dist <= width + enemy.radius) this.dealDamage(source, enemy, damage);
    }
  }

  private distanceTo(a: Actor, b: Actor): number {
    return Phaser.Math.Distance.Between(a.view.x, a.view.y, b.view.x, b.view.y);
  }

  private dealDamage(source: Actor, target: Actor, rawAmount: number) {
    if (target.dead) return;
    let amount = Math.max(1, Math.round(rawAmount));

    if (target.shield && target.shield > 0) {
      const blocked = Math.min(target.shield, amount);
      target.shield -= blocked;
      amount -= blocked;
    }

    if (amount <= 0) return;

    target.hp = Math.max(0, target.hp - amount);
    if (this.tutorialMode && source.controller === 'player') {
      if (target.tutorialTag === 'tower') this.markTutorialAction('tower');
      if (target.tutorialTag === 'core') this.markTutorialAction('core');
    }
    if (source.controller === 'player' || target.controller === 'player') {
      this.recordEvent('damage', {
        actor: this.actorSnapshot(source),
        target: this.actorSnapshot(target),
        amount,
        hpAfter: target.hp,
        x: source.view.x,
        y: source.view.y,
        targetX: target.view.x,
        targetY: target.view.y
      });
    }
    this.updateActorVisual(target, this.time.now);
    this.spawnDamageText(target.view.x, target.view.y - target.radius - 22, amount, source.team);
    this.spawnHitBurst(target.view.x, target.view.y, source.team === 'blue' ? COLORS.blue : COLORS.red);

    if (target.hp <= 0) {
      this.killActor(target, source);
    }
  }

  private killActor(target: Actor, source: Actor) {
    if (target.dead) return;

    const targetX = target.view.x;
    const targetY = target.view.y;
    target.dead = true;
    target.hp = 0;
    target.target = undefined;
    target.view.setVisible(false);

    if (source.controller === 'player' || target.controller === 'player') {
      this.recordEvent('kill', {
        actor: this.actorSnapshot(source),
        target: this.actorSnapshot(target),
        x: source.view.x,
        y: source.view.y,
        targetX,
        targetY,
        defeatedKind: target.kind
      });
    }

    if ((target.kind === 'tower' || target.kind === 'core') && target.team === 'red') {
      if (target.kind === 'tower' && source.team === 'blue') this.towersDestroyedByBlue += 1;
      if (target.kind === 'core' && source.team === 'blue') this.redCoreDestroyed = true;
      this.recordEvent('objective', {
        actor: this.actorSnapshot(source),
        target: this.actorSnapshot(target),
        objective: target.kind,
        winner: target.kind === 'core' ? source.team : undefined,
        x: source.view.x,
        y: source.view.y,
        targetX,
        targetY
      });
    }

    if (target.kind === 'hero') {
      target.deaths += 1;
      target.respawnAt = this.time.now + 8000;
      this.kills[source.team] += 1;
      if (source.kind === 'hero') {
        source.kills += 1;
        this.grantReward(source, target.kind);
      }
      this.spawnFloatingText(target.view.x, target.view.y - 70, `${source.name} победил ${target.name}`, source.team === 'blue' ? COLORS.blue : COLORS.red, 20);
    } else {
      if (source.kind === 'hero') this.grantReward(source, target.kind);
      target.view.destroy();
      if (target.kind === 'tower') {
        this.cameras.main.shake(210, 0.004);
        this.spawnFloatingText(target.view.x, target.view.y - 88, 'Башня разрушена!', COLORS.gold, 24);
      }
      if (target.kind === 'core') {
        this.endMatch(source.team);
      }
    }
  }

  private grantReward(actor: Actor, defeatedKind: ActorKind) {
    const goldGain = defeatedKind === 'hero' ? 160 : defeatedKind === 'tower' ? 260 : defeatedKind === 'core' ? 500 : 34;
    const xpGain = defeatedKind === 'hero' ? 110 : defeatedKind === 'tower' ? 150 : defeatedKind === 'core' ? 250 : 28;
    actor.gold += goldGain;
    actor.xp += xpGain;

    if (actor.controller === 'player') {
      this.recordEvent('reward', {
        actor: this.actorSnapshot(actor),
        defeatedKind,
        goldAfter: actor.gold,
        levelAfter: actor.level,
        data: { goldGain, xpGain }
      });
    }

    const nextLevelXp = actor.level * 150;
    if (actor.xp >= nextLevelXp && actor.level < 8) {
      actor.xp -= nextLevelXp;
      actor.level += 1;
      actor.maxHp += 76;
      actor.hp = Math.min(actor.maxHp, actor.hp + 150);
      actor.damage += 7;
      this.spawnFloatingText(actor.view.x, actor.view.y - 94, `LEVEL ${actor.level}`, COLORS.gold, 24);
      actor.levelText?.setText(`${actor.controller === 'player' ? 'Вы · ' : ''}${actor.name} · Lv.${actor.level}`);
      if (actor.controller === 'player') {
        this.recordEvent('level_up', {
          actor: this.actorSnapshot(actor),
          goldAfter: actor.gold,
          levelAfter: actor.level,
          x: actor.view.x,
          y: actor.view.y
        });
      }
    }
  }

  private updateRespawns(time: number) {
    for (const actor of this.actors) {
      if (actor.kind !== 'hero' || !actor.dead || !actor.respawnAt || actor.respawnAt > time) continue;
      actor.dead = false;
      actor.hp = actor.maxHp;
      actor.view.setVisible(true);
      actor.respawnAt = undefined;
      this.placeActor(actor, actor.spawn.x, actor.spawn.y);
      this.spawnRing(actor.view.x, actor.view.y, 90, teamColor(actor.team), 0.26);
      if (actor.controller === 'player') this.spawnFloatingText(actor.view.x, actor.view.y - 80, 'Вы возродились', COLORS.green, 22);
    }
  }

  private spawnProjectile(source: Actor, targetX: number, targetY: number, damage: number, speed: number, radius: number, color: number, lifeMs = 1600) {
    const dx = targetX - source.view.x;
    const dy = targetY - source.view.y;
    const dir = new Phaser.Math.Vector2(dx, dy);
    if (dir.lengthSq() < 0.01) dir.set(source.team === 'blue' ? 1 : -1, 0);
    dir.normalize();

    const view = this.add.circle(source.view.x, source.view.y, radius, color, 0.95)
      .setStrokeStyle(2, COLORS.white, 0.56)
      .setDepth(source.view.y + 20);

    this.projectiles.push({
      id: `projectile-${this.projectileSeq++}`,
      team: source.team,
      owner: source,
      view,
      vx: dir.x * speed,
      vy: dir.y * speed,
      damage,
      radius,
      expiresAt: this.time.now + lifeMs,
      hit: new Set<string>()
    });
  }

  private updateProjectiles(time: number, dt: number) {
    for (const projectile of this.projectiles) {
      projectile.view.x += projectile.vx * dt;
      projectile.view.y += projectile.vy * dt;
      projectile.view.setDepth(projectile.view.y + 20);

      for (const enemy of this.actors) {
        if (enemy.dead || enemy.team === projectile.team || projectile.hit.has(enemy.id)) continue;
        const dist = Phaser.Math.Distance.Between(projectile.view.x, projectile.view.y, enemy.view.x, enemy.view.y);
        if (dist <= enemy.radius + projectile.radius) {
          projectile.hit.add(enemy.id);
          this.dealDamage(projectile.owner, enemy, projectile.damage);
          projectile.expiresAt = Math.min(projectile.expiresAt, time + 24);
          break;
        }
      }
    }

    this.projectiles = this.projectiles.filter((projectile) => {
      const alive = projectile.expiresAt > time && projectile.view.x > -50 && projectile.view.x < MAP_WIDTH + 50 && projectile.view.y > -50 && projectile.view.y < MAP_HEIGHT + 50;
      if (!alive) projectile.view.destroy();
      return alive;
    });
  }

  private createZone(owner: Actor, x: number, y: number, radius: number, damage: number, durationMs: number, tickMs: number, color: number, slow: boolean) {
    const view = this.add.circle(x, y, radius, color, 0.12).setStrokeStyle(4, color, 0.58).setDepth(y - 4);
    this.tweens.add({ targets: view, scale: 1.06, alpha: 0.2, duration: 720, yoyo: true, repeat: -1 });
    this.zones.push({
      id: `zone-${this.zoneSeq++}`,
      team: owner.team,
      owner,
      view,
      x,
      y,
      radius,
      damage,
      tickMs,
      nextTickAt: this.time.now + 160,
      expiresAt: this.time.now + durationMs,
      slow
    });
  }

  private updateZones(time: number) {
    for (const zone of this.zones) {
      if (time < zone.nextTickAt) continue;
      zone.nextTickAt = time + zone.tickMs;
      for (const enemy of this.getEnemiesInRadius(zone.team, zone.x, zone.y, zone.radius)) {
        this.dealDamage(zone.owner, enemy, zone.damage);
        if (zone.slow) enemy.slowUntil = time + zone.tickMs + 200;
      }
    }

    this.zones = this.zones.filter((zone) => {
      const alive = zone.expiresAt > time;
      if (!alive) zone.view.destroy();
      return alive;
    });
  }

  private updateActorVisual(actor: Actor, time: number) {
    const pct = Phaser.Math.Clamp(actor.hp / actor.maxHp, 0, 1);
    actor.hpFill.scaleX = pct;
    actor.hpFill.setFillStyle(pct > 0.5 ? COLORS.green : pct > 0.25 ? COLORS.gold : COLORS.red, 0.95);
    actor.view.setDepth(actor.view.y);

    if (actor.auraUntil && actor.auraUntil > time) {
      const pulse = 1 + Math.sin(time / 80) * 0.07;
      actor.view.setScale(pulse);
    } else {
      actor.view.setScale(1);
    }

    if (actor.slowUntil && actor.slowUntil > time) {
      actor.body.setAlpha(0.72);
    } else {
      actor.body.setAlpha(1);
    }
  }

  private cleanupDeadObjects() {
    this.actors = this.actors.filter((actor) => actor.kind === 'hero' || !actor.dead);
  }

  private updateHud(time: number) {
    const elapsed = Math.floor((time - this.matchStartedAt) / 1000);
    this.scoreText.setText(`${this.kills.blue}  :  ${this.kills.red}`);
    this.timerText.setText(fmtTime(elapsed));

    const hpPct = Phaser.Math.Clamp(this.player.hp / this.player.maxHp, 0, 1);
    this.playerHpFill.scaleX = hpPct;
    this.playerHpFill.setFillStyle(hpPct > 0.5 ? COLORS.green : hpPct > 0.25 ? COLORS.gold : COLORS.red, 0.95);

    const respawn = this.player.dead && this.player.respawnAt ? ` · Возрождение ${Math.ceil((this.player.respawnAt - time) / 1000)}с` : '';
    const skinName = equippedSkinForHero(this.selectedHero.id)?.name;
    this.playerInfoText.setText(`${this.player.name}${skinName ? ` · ${skinName}` : ''} Lv.${this.player.level} · HP ${Math.ceil(this.player.hp)}/${this.player.maxHp} · Gold ${this.player.gold}${respawn}`);

    for (const btn of this.abilityButtons) {
      if (btn.slot === 'attack') {
        const ready = Math.max(0, this.player.lastAttack + this.player.attackCooldown - time);
        btn.cdText.setText(ready > 0 ? `${Math.ceil(ready / 1000)}` : '');
        btn.ring.setFillStyle(btn.readyColor, ready > 0 ? 0.12 : 0.32);
      } else {
        const readyAt = this.player.abilityReadyAt?.[btn.slot] ?? 0;
        const left = Math.max(0, readyAt - time);
        btn.cdText.setText(left > 0 ? `${Math.ceil(left / 1000)}` : '');
        btn.ring.setFillStyle(btn.readyColor, left > 0 ? 0.1 : 0.33);
        btn.label.setAlpha(left > 0 ? 0.45 : 1);
      }
    }

    if (time - this.lastMinimapAt > 120) {
      this.updateMinimap();
      this.lastMinimapAt = time;
    }
  }

  private updateMinimap() {
    const x = GAME_WIDTH - 210;
    const y = 54;
    const w = 184;
    const h = 112;
    this.minimap.clear();
    this.minimap.fillStyle(0x090719, 0.45);
    this.minimap.fillRect(x, y, w, h);
    this.minimap.lineStyle(2, COLORS.gold, 0.26);
    this.minimap.lineBetween(x + 18, y + h * 0.53, x + w - 18, y + h * 0.53);

    for (const actor of this.actors) {
      if (actor.dead) continue;
      const px = x + (actor.view.x / MAP_WIDTH) * w;
      const py = y + (actor.view.y / MAP_HEIGHT) * h;
      const color = actor.team === 'blue' ? COLORS.blue : COLORS.red;
      const size = actor.kind === 'hero' ? 4 : actor.kind === 'tower' ? 3 : actor.kind === 'core' ? 5 : 2;
      this.minimap.fillStyle(color, actor.kind === 'minion' ? 0.65 : 0.95);
      this.minimap.fillCircle(px, py, size);
    }

    this.minimap.lineStyle(2, COLORS.white, 0.92);
    this.minimap.strokeCircle(x + (this.player.view.x / MAP_WIDTH) * w, y + (this.player.view.y / MAP_HEIGHT) * h, 7);
  }

  private spawnSlash(source: Actor, target: Actor, color: number) {
    const midX = (source.view.x + target.view.x) / 2;
    const midY = (source.view.y + target.view.y) / 2;
    this.spawnLineEffect(source.view.x, source.view.y, target.view.x, target.view.y, color, 10);
    const burst = this.add.circle(midX, midY, 20, color, 0.42).setDepth(midY + 30);
    this.tweens.add({ targets: burst, scale: 1.9, alpha: 0, duration: 220, onComplete: () => burst.destroy() });
  }

  private spawnLineEffect(x1: number, y1: number, x2: number, y2: number, color: number, width: number) {
    const g = this.add.graphics().setDepth(Math.max(y1, y2) + 30);
    g.lineStyle(width, color, 0.8);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    g.lineStyle(Math.max(2, width / 3), COLORS.white, 0.75);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 230, onComplete: () => g.destroy() });
  }

  private spawnRing(x: number, y: number, radius: number, color: number, alpha: number) {
    const ring = this.add.circle(x, y, radius * 0.45, color, alpha).setStrokeStyle(5, color, 0.8).setDepth(y + 15);
    this.tweens.add({ targets: ring, scale: radius / (radius * 0.45), alpha: 0, duration: 420, onComplete: () => ring.destroy() });
  }

  private spawnHitBurst(x: number, y: number, color: number) {
    const burst = this.add.circle(x, y, 10, color, 0.48).setDepth(y + 25);
    this.tweens.add({ targets: burst, scale: 2.4, alpha: 0, duration: 180, onComplete: () => burst.destroy() });
  }

  private spawnDamageText(x: number, y: number, amount: number, team: Team) {
    const color = team === 'blue' ? COLORS.blue : COLORS.red;
    this.spawnFloatingText(x + Phaser.Math.Between(-8, 8), y, `-${amount}`, color, 16);
  }

  private spawnFloatingText(x: number, y: number, text: string, color: number, size: number) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: `${size}px`,
      color: colorToCss(color),
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center'
    }).setOrigin(0.5).setDepth(y + 100);

    this.tweens.add({
      targets: label,
      y: y - 46,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy()
    });
  }

  private flash(target: Phaser.GameObjects.Arc | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse, color: number) {
    const original = target.fillColor;
    target.setFillStyle(color, 1);
    this.time.delayedCall(70, () => {
      if (!target.scene) return;
      target.setFillStyle(original, 1);
    });
  }

  private endMatch(winner: Team) {
    if (this.matchOver) return;
    this.matchOver = true;

    const durationSec = Math.floor((this.time.now - this.matchStartedAt) / 1000);
    const eventLog = this.tutorialMode ? undefined : this.buildEventLog(durationSec, winner);
    const actionStream = this.tutorialMode ? undefined : this.buildActionStream(durationSec, winner);
    sharedState.lastResult = {
      victory: winner === 'blue',
      winner,
      durationSec,
      heroName: this.player.name,
      heroId: this.selectedHero.id,
      kills: this.player.kills,
      deaths: this.player.deaths,
      gold: this.player.gold,
      level: this.player.level,
      tutorial: this.tutorialMode,
      eventLog,
      actionStream
    };

    const stored = JSON.parse(localStorage.getItem('shonen-rift-results') ?? '[]') as MatchResult[];
    stored.unshift(sharedState.lastResult);
    localStorage.setItem('shonen-rift-results', JSON.stringify(stored.slice(0, 20)));

    if (this.tutorialMode && winner === 'blue') {
      sharedState.resultSyncStatus = 'pending';
      sharedState.resultSyncMessage = 'Отправляем tutorial reward...';
      this.completeTutorialReward();
    } else if (sharedState.session) {
      sharedState.resultSyncStatus = 'pending';
      sharedState.resultSyncMessage = 'Проверка результата сервером...';
      apiSubmitMatchResult(sharedState.session.token, sharedState.currentMatchId, sharedState.lastResult)
        .then((response) => {
          if (response?.user) sharedState.profile = response.user;
          if (response?.ok) {
            if (response.result && sharedState.lastResult) {
              sharedState.lastResult = {
                ...sharedState.lastResult,
                victory: Boolean(response.result.victory),
                winner: response.result.winner === 'red' ? 'red' : 'blue',
                durationSec: Number(response.result.durationSec ?? sharedState.lastResult.durationSec),
                heroName: String(response.result.heroName ?? sharedState.lastResult.heroName),
                heroId: String(response.result.heroId ?? sharedState.lastResult.heroId),
                kills: Number(response.result.kills ?? sharedState.lastResult.kills),
                deaths: Number(response.result.deaths ?? sharedState.lastResult.deaths),
                gold: Number(response.result.gold ?? sharedState.lastResult.gold),
                level: Number(response.result.level ?? sharedState.lastResult.level)
              };
            }
            sharedState.resultSyncStatus = 'saved';
            sharedState.resultSyncMessage = response.validation?.authoritativeReplay
              ? response.validation.clientSimulationMatched === false
                ? 'Результат подтверждён, но client/server sim hash различается'
                : 'Результат подтверждён: client/server simulation совпала'
              : response.validation?.serverCalculated
                ? 'Результат пересчитан и подтверждён сервером'
                : 'Результат подтверждён сервером';
          } else {
            const firstError = response?.validation?.errors?.[0]?.message;
            sharedState.resultSyncStatus = 'rejected';
            sharedState.resultSyncMessage = firstError ? `Сервер отклонил результат: ${firstError}` : 'Сервер отклонил результат';
          }
        });
    } else {
      sharedState.resultSyncStatus = 'local';
      sharedState.resultSyncMessage = 'API недоступен: результат сохранён локально';
    }

    const message = this.tutorialMode && winner === 'blue'
      ? 'Обучение завершено!'
      : winner === 'blue' ? 'Синяя команда победила!' : 'Красная команда победила!';
    this.spawnFloatingText(this.cameras.main.midPoint.x, this.cameras.main.midPoint.y - 60, message, winner === 'blue' ? COLORS.gold : COLORS.red, 36);
    this.cameras.main.shake(420, 0.006);

    this.time.delayedCall(1150, () => this.scene.start('ResultScene'));
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#090719',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [PreloadScene, PreviewScene, MenuScene, TutorialIntroScene, ProfileScene, ShopScene, HeroSelectScene, MatchScene, SharedSimScene, ResultScene]
};

new Phaser.Game(config);
