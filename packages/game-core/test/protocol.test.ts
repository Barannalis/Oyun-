import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../src/config';
import { addPlayer, createWorld, removePlayer, setConnected, startMatch, userKey } from '../src/world';
import { applyPublicState, toPublicState, worldFromInit } from '../src/protocol';

describe('addPlayer', () => {
  it('oyuncuyu lobiye ekler ve bağlı işaretler', () => {
    const w = createWorld(1);
    const r = addPlayer(w, 'Ali');
    expect(r).toEqual({ ok: true, key: 'ali' });
    expect(w.players.ali.connected).toBe(true);
  });

  it('boş ad, aynı ad ve dolu lobi hatalarını döner', () => {
    const w = createWorld(2);
    expect(addPlayer(w, '  ')).toEqual({ ok: false, reason: 'invalid_name' });
    addPlayer(w, 'Ali');
    expect(addPlayer(w, '@ali')).toEqual({ ok: false, reason: 'name_taken' });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) addPlayer(w, `p${i}`);
    expect(addPlayer(w, 'fazla')).toEqual({ ok: false, reason: 'room_full' });
  });

  it('maç başladıktan sonra katılım reddedilir', () => {
    const w = createWorld(3);
    addPlayer(w, 'A');
    addPlayer(w, 'B');
    expect(startMatch(w).ok).toBe(true);
    expect(addPlayer(w, 'C')).toEqual({ ok: false, reason: 'match_in_progress' });
  });
});

describe('removePlayer ve setConnected', () => {
  it('lobide oyuncu silinebilir, maçta silinemez', () => {
    const w = createWorld(4);
    addPlayer(w, 'A');
    addPlayer(w, 'B');
    addPlayer(w, 'C');
    expect(removePlayer(w, 'a')).toBe(true);
    expect(w.players.a).toBeUndefined();
    expect(startMatch(w).ok).toBe(true);
    expect(removePlayer(w, 'b')).toBe(false);
    expect(w.players.b).toBeDefined();
  });

  it('bağlantı durumu güncellenir', () => {
    const w = createWorld(5);
    addPlayer(w, 'A');
    expect(setConnected(w, 'a', false)).toBe(true);
    expect(w.players.a.connected).toBe(false);
    expect(setConnected(w, 'yok', false)).toBe(false);
  });
});

describe('genel durum (protokol)', () => {
  it('public state istemci dünyasına doğru aktarılır ve kimlik korunur', () => {
    const server = createWorld(6);
    addPlayer(server, 'Ali');
    addPlayer(server, 'Ayşe');
    startMatch(server);

    const state = toPublicState(server);
    const client = worldFromInit({ map: server.map, state });
    expect(client.map).toBe(server.map);
    expect(client.players.ali.role).toBe(server.players.ali.role);

    const mapRef = client.map;
    server.tick += 5;
    server.players.ali.x = 3;
    applyPublicState(client, toPublicState(server));
    expect(client.map).toBe(mapRef);
    expect(client.tick).toBe(server.tick);
    expect(client.players.ali.x).toBe(3);
  });

  it('public state sunucu nesnesini paylaşmaz (kopya)', () => {
    const w = createWorld(7);
    addPlayer(w, 'A');
    const s = toPublicState(w);
    s.players.a.score = 999;
    expect(w.players.a.score).toBe(0);
  });

  it('userKey tr-TR kurallarına göre normalize eder', () => {
    expect(userKey('İlker')).toBe('ilker');
    expect(userKey('  @Ayşe ')).toBe('ayşe');
  });
});
