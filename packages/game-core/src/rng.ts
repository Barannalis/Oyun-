/**
 * Deterministik RNG (mulberry32 varyantı). Durum tek bir sayıdır, böylece
 * dünya durumuyla birlikte JSON olarak saklanıp geri yüklenebilir.
 */
export interface RngState {
  s: number;
}

export function nextFloat(st: RngState): number {
  st.s = (st.s + 0x6d2b79f5) | 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [0, maxExclusive) aralığında tam sayı. */
export function nextInt(st: RngState, maxExclusive: number): number {
  return Math.floor(nextFloat(st) * maxExclusive);
}
