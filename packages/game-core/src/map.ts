import { nextFloat, nextInt, type RngState } from './rng';
import type { MapData, Position } from './types';

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_GENERATOR = 2;

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function inBounds(map: MapData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: MapData, x: number, y: number): number {
  return inBounds(map, x, y) ? map.tiles[y * map.width + x] : TILE_WALL;
}

export function isWalkable(map: MapData, x: number, y: number): boolean {
  return tileAt(map, x, y) === TILE_FLOOR;
}

export function countWalkable(map: MapData): number {
  let n = 0;
  for (const t of map.tiles) if (t === TILE_FLOOR) n++;
  return n;
}

/** Yürünebilir karelerin indeksleri (y * width + x) kümesi. */
export function reachableFrom(map: MapData, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  if (!isWalkable(map, sx, sy)) return seen;
  const stack: Position[] = [{ x: sx, y: sy }];
  seen.add(sy * map.width + sx);
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const k = ny * map.width + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/**
 * Rastgele duvarlı bir harita üretir. Kenarlar duvar, ortadaki 5x5 alan
 * her zaman açıktır ve yalnızca merkezden ulaşılabilen alan bırakılır.
 */
export function generateMap(rng: RngState, width: number, height: number, wallChance = 0.08): MapData {
  const tiles = new Array<number>(width * height).fill(TILE_FLOOR);
  const map: MapData = { width, height, tiles };
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border || nextFloat(rng) < wallChance) tiles[y * width + x] = TILE_WALL;
    }
  }

  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) tiles[y * width + x] = TILE_FLOOR;
    }
  }

  const reach = reachableFrom(map, cx, cy);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE_FLOOR && !reach.has(i)) tiles[i] = TILE_WALL;
  }
  return map;
}

/**
 * Jeneratörleri yerleştirir. Her jeneratör yürünebilir olmayan bir kare olur,
 * en az iki komşusu açık olmalıdır ve harita bağlantısını bozmamalıdır.
 */
export function placeGenerators(map: MapData, rng: RngState, count: number): Position[] {
  const cx = Math.floor(map.width / 2);
  const cy = Math.floor(map.height / 2);
  const center = { x: cx, y: cy };
  const spots: Position[] = [];
  let attempts = 0;

  while (spots.length < count && attempts < 5000) {
    attempts++;
    const x = 1 + nextInt(rng, map.width - 2);
    const y = 1 + nextInt(rng, map.height - 2);
    if (tileAt(map, x, y) !== TILE_FLOOR) continue;
    const candidate = { x, y };
    if (manhattan(candidate, center) < 5) continue;
    if (spots.some((s) => manhattan(s, candidate) < 6)) continue;

    const openNeighbors = DIRS.filter(([dx, dy]) => isWalkable(map, x + dx, y + dy)).length;
    if (openNeighbors < 2) continue;

    const idx = y * map.width + x;
    map.tiles[idx] = TILE_GENERATOR;
    if (reachableFrom(map, cx, cy).size !== countWalkable(map)) {
      map.tiles[idx] = TILE_FLOOR;
      continue;
    }
    spots.push(candidate);
  }
  return spots;
}
