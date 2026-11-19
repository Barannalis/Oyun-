import Phaser from 'phaser';
import {
  GENERATOR_REQUIRED_PROGRESS,
  MATCH_TICKS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_PLAYERS,
  TICK_MS,
  TICK_RATE,
  TILE_WALL,
  isNight,
  litTiles,
  step,
  type GameWorld,
  type Player,
} from '@ttl/game-core';
import { describeEvent, pushLog } from '../format';

export const TILE = 28;
export const HUD_H = 40;
export const CANVAS_W = MAP_WIDTH * TILE;
export const CANVAS_H = HUD_H + MAP_HEIGHT * TILE;

const MAX_ACC_MS = TICK_MS * 5;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const COLOR = {
  floor: 0x0d1219,
  floorAlt: 0x101720,
  wall: 0x27303d,
  wallEdge: 0x3a4658,
  generator: 0xf5c542,
  generatorDone: 0x3ddc84,
  killer: 0xff4d4d,
  survivor: 0x4fc3f7,
  caught: 0x5f6672,
  protect: 0x9be7a5,
} as const;

export interface Session {
  world: GameWorld;
  log: string[];
}

interface Flash {
  x: number;
  y: number;
  life: number;
  max: number;
  color: number;
}

export class GameScene extends Phaser.Scene {
  private acc = 0;
  private builtFor: GameWorld | null = null;
  private staticLayer!: Phaser.GameObjects.Graphics;
  private genLayer!: Phaser.GameObjects.Graphics;
  private fogLayer!: Phaser.GameObjects.Graphics;
  private actorLayer!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private flashes: Flash[] = [];

  constructor(private readonly session: Session) {
    super('game');
  }

  create(): void {
    this.staticLayer = this.add.graphics();
    this.genLayer = this.add.graphics();
    this.fogLayer = this.add.graphics();
    this.actorLayer = this.add.graphics();

    this.hud = this.add
      .text(12, 10, '', { fontFamily: FONT, fontSize: '15px', color: '#d8dee9' })
      .setDepth(20);

    this.banner = this.add
      .text(CANVAS_W / 2, HUD_H + (MAP_HEIGHT * TILE) / 2, '', {
        fontFamily: FONT,
        fontSize: '24px',
        color: '#ffffff',
        align: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 18, y: 14 },
      })
      .setOrigin(0.5)
      .setDepth(30);
  }

  update(_time: number, deltaMs: number): void {
    this.acc = Math.min(this.acc + deltaMs, MAX_ACC_MS);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const world = this.session.world;
      step(world);
      this.consumeEvents(world);
    }
    this.render(deltaMs);
  }

  private consumeEvents(world: GameWorld): void {
    for (const e of world.events) {
      pushLog(this.session.log, describeEvent(world, e));
      if (e.type === 'caught') this.flashAt(world.players[e.victim], COLOR.killer);
      if (e.type === 'rescued') this.flashAt(world.players[e.victim], COLOR.protect);
      if (e.type === 'generator-done') {
        const g = world.generators[e.generatorId];
        if (g) this.flashAt({ x: g.x, y: g.y }, COLOR.generatorDone);
      }
    }
  }

  private flashAt(at: { x: number; y: number } | undefined, color: number): void {
    if (!at || at.x < 0) return;
    this.flashes.push({ x: at.x, y: at.y, life: 450, max: 450, color });
  }

  private render(deltaMs: number): void {
    const world = this.session.world;
    if (this.builtFor !== world) this.buildStatic(world);

    this.drawGenerators(world);
    this.drawFog(world);
    this.drawActors(world, deltaMs);
    this.drawHud(world);
    this.drawBanner(world);
  }

  private buildStatic(world: GameWorld): void {
    this.builtFor = world;
    const g = this.staticLayer.clear();
    const { width, height, tiles } = world.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x * TILE;
        const py = HUD_H + y * TILE;
        if (tiles[y * width + x] === TILE_WALL) {
          g.fillStyle(COLOR.wall, 1).fillRect(px, py, TILE, TILE);
          g.fillStyle(COLOR.wallEdge, 1).fillRect(px, py, TILE, 2);
        } else {
          g.fillStyle((x + y) % 2 === 0 ? COLOR.floor : COLOR.floorAlt, 1).fillRect(px, py, TILE, TILE);
        }
      }
    }
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
  }

  private drawGenerators(world: GameWorld): void {
    const g = this.genLayer.clear();
    for (const gen of world.generators) {
      const px = gen.x * TILE;
      const py = HUD_H + gen.y * TILE;
      const ratio = gen.progress / GENERATOR_REQUIRED_PROGRESS;
      g.fillStyle(gen.done ? COLOR.generatorDone : COLOR.generator, 0.92).fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      g.fillStyle(0x000000, 0.6).fillRect(px + 4, py + TILE - 8, TILE - 8, 4);
      g.fillStyle(0xffffff, 1).fillRect(px + 4, py + TILE - 8, (TILE - 8) * ratio, 4);
    }
  }

  private drawFog(world: GameWorld): void {
    const f = this.fogLayer.clear();
    if (world.phase !== 'playing' || !isNight(world.tick)) return;
    const lit = litTiles(world);
    const { width, height } = world.map;
    f.fillStyle(0x000000, 0.86);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!lit[y * width + x]) f.fillRect(x * TILE, HUD_H + y * TILE, TILE, TILE);
      }
    }
  }

  private drawActors(world: GameWorld, deltaMs: number): void {
    const a = this.actorLayer.clear();
    const seen = new Set<string>();

    for (const p of Object.values(world.players)) {
      if (p.x < 0) continue;
      seen.add(p.key);
      const cx = p.x * TILE + TILE / 2;
      const cy = HUD_H + p.y * TILE + TILE / 2;
      const body = p.caught ? COLOR.caught : p.role === 'killer' ? COLOR.killer : COLOR.survivor;

      if (p.immunity > 0) a.lineStyle(2, COLOR.protect, 0.9).strokeCircle(cx, cy, TILE * 0.5);
      a.fillStyle(body, 1).fillCircle(cx, cy, TILE * 0.34);
      if (p.caught) {
        const r = TILE * 0.2;
        a.lineStyle(2, 0xffffff, 0.9).lineBetween(cx - r, cy - r, cx + r, cy + r).lineBetween(cx - r, cy + r, cx + r, cy - r);
      }
      this.updateLabel(p, cx, cy);
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.life -= deltaMs;
      if (fl.life <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - fl.life / fl.max;
      const cx = fl.x * TILE + TILE / 2;
      const cy = HUD_H + fl.y * TILE + TILE / 2;
      a.lineStyle(3, fl.color, 1 - t).strokeCircle(cx, cy, TILE * (0.5 + t * 1.6));
    }

    for (const [key, label] of this.labels) {
      if (!seen.has(key)) {
        label.destroy();
        this.labels.delete(key);
      }
    }
  }

  private updateLabel(p: Player, cx: number, cy: number): void {
    let label = this.labels.get(p.key);
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#e6f7ff' })
        .setOrigin(0.5, 1)
        .setDepth(25);
      this.labels.set(p.key, label);
    }
    const text = p.caught ? `${p.name} (yakalandı)` : p.name;
    if (label.text !== text) label.setText(text);
    const color = p.role === 'killer' ? '#ff9a9a' : '#e6f7ff';
    if (label.style.color !== color) label.setColor(color);
    label.setPosition(cx, cy - TILE * 0.42);
  }

  private drawHud(world: GameWorld): void {
    const remaining = Math.max(0, Math.ceil((MATCH_TICKS - world.tick) / TICK_RATE));
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    const done = world.generators.filter((g) => g.done).length;
    const phase =
      world.phase === 'lobby' ? 'LOBİ' : world.phase === 'ended' ? 'BİTTİ' : isNight(world.tick) ? 'GECE' : 'GÜNDÜZ';
    const players = Object.keys(world.players).length;
    const timer = world.phase === 'playing' ? `Kalan süre ${mm}:${ss}` : '';
    this.hud.setText(
      `${phase}   Oyuncu ${players}/${MAX_PLAYERS}   Jeneratör ${done}/${world.generators.length}   ${timer}`,
    );
  }

  private drawBanner(world: GameWorld): void {
    if (world.phase === 'lobby') {
      const names = Object.values(world.players).map((p) => p.name);
      const shown = names.slice(0, 12).join(', ') + (names.length > 12 ? ` ve ${names.length - 12} kişi daha` : '');
      this.banner.setText(
        names.length === 0
          ? 'Lobi boş. Yorum olarak GİR yazın.'
          : `Lobi: ${shown}\nBaşlatmak için paneli kullanın (en az 2 oyuncu).`,
      );
      this.banner.setVisible(true);
    } else if (world.phase === 'ended') {
      const winner = world.winner === 'survivors' ? 'HAYATTA KALANLAR' : 'KATİL';
      const reason = world.winReason === 'generators-done' ? 'Tüm jeneratörler çalıştırıldı'
        : world.winReason === 'all-caught' ? 'Tüm hayatta kalanlar yakalandı'
        : 'Süre doldu';
      this.banner.setText(`KAZANAN: ${winner}\n${reason}`);
      this.banner.setVisible(true);
    } else {
      this.banner.setVisible(false);
    }
  }
}
