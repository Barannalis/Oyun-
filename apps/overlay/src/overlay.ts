import Phaser from 'phaser';
import { CANVAS_H, CANVAS_W, GameScene } from './scenes/GameScene';
import { createSession } from './session';
import { RoomClient } from './net/RoomClient';

/**
 * Yayın ekranı (OBS / LIVE Studio tarayıcı kaynağı). Anahtar yoktur, yalnızca görüntüler.
 * Bağlantı, panelin ürettiği oda kimliğiyle kurulur. Oda değişince bağlantı geçersiz olur.
 */
const params = new URLSearchParams(window.location.search);
const SERVER_URL: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:3000';
const ROOM_ID = params.get('room');

const session = createSession();
new RoomClient(session, { url: SERVER_URL, roomId: ROOM_ID });

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#05070b',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [new GameScene(session)],
});

const notice = document.getElementById('notice');
setInterval(() => {
  if (!notice) return;
  let text = '';
  if (!ROOM_ID) text = 'Oda kimliği yok. Yayın bağlantısını yayıncı panelinden alın.';
  else if (session.stale) text = 'Bu yayın bağlantısı eski. Yayıncı panelinden yeni bağlantıyı alın.';
  else if (!session.connected) text = 'Sunucuya bağlanılıyor…';
  notice.textContent = text;
  notice.style.display = text ? 'block' : 'none';
}, 300);
