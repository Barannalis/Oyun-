import { describe, expect, it } from 'vitest';
import { GENERATOR_COUNT, MAP_HEIGHT, MAP_WIDTH } from '../src/config';
import {
  TILE_FLOOR,
  TILE_GENERATOR,
  TILE_WALL,
  countWalkable,
  generateMap,
  isWalkable,
  placeGenerators,
  reachableFrom,
} from '../src/map';
import { createWorld } from '../src/world';
import type { RngState } from '../src/rng';

describe('generateMap', () => {
  it.each(Array.from({ length: 30 }, (_, i) => i + 1))('tohum %i: kenarlar duvar, harita bağlantılı', (seed) => {
    const rng: RngState = { s: seed };
    const map = generateMap(rng, MAP_WIDTH, MAP_HEIGHT);

    for (let x = 0; x < map.width; x++) {
      expect(map.tiles[x]).toBe(TILE_WALL);
      expect(map.tiles[(map.height - 1) * map.width + x]).toBe(TILE_WALL);
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.tiles[y * map.width]).toBe(TILE_WALL);
      expect(map.tiles[y * map.width + map.width - 1]).toBe(TILE_WALL);
    }

    const cx = Math.floor(map.width / 2);
    const cy = Math.floor(map.height / 2);
    expect(isWalkable(map, cx, cy)).toBe(true);
    expect(reachableFrom(map, cx, cy).size).toBe(countWalkable(map));
  });

  it('aynı tohum aynı haritayı üretir', () => {
    const a = generateMap({ s: 7 }, MAP_WIDTH, MAP_HEIGHT);
    const b = generateMap({ s: 7 }, MAP_WIDTH, MAP_HEIGHT);
    expect(a.tiles).toEqual(b.tiles);
  });
});

describe('placeGenerators', () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 100))('tohum %i: jeneratörler geçerli yerde', (seed) => {
    const rng: RngState = { s: seed };
    const map = generateMap(rng, MAP_WIDTH, MAP_HEIGHT);
    const spots = placeGenerators(map, rng, GENERATOR_COUNT);

    expect(spots).toHaveLength(GENERATOR_COUNT);
    for (const s of spots) {
      expect(map.tiles[s.y * map.width + s.x]).toBe(TILE_GENERATOR);
      const open = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => isWalkable(map, s.x + dx, s.y + dy)).length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
    const cx = Math.floor(map.width / 2);
    const cy = Math.floor(map.height / 2);
    expect(reachableFrom(map, cx, cy).size).toBe(countWalkable(map));
  });
});

describe('createWorld', () => {
  it('tohumdan yapılandırılmış bir lobi üretir', () => {
    const w = createWorld(12345);
    expect(w.phase).toBe('lobby');
    expect(w.generators).toHaveLength(GENERATOR_COUNT);
    expect(Object.keys(w.players)).toHaveLength(0);
    expect(w.map.tiles.some((t) => t === TILE_FLOOR)).toBe(true);
  });
});
