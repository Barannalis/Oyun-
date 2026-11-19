// Geliştirme ortamı: oyun sunucusu ve yayıncı paneli tek komutla başlar.
// Ctrl+C ikisini birlikte kapatır. Ek bağımlılık gerektirmez.
import { spawn } from 'node:child_process';

const children = [
  { name: 'sunucu', args: ['run', 'start', '-w', '@ttl/server'] },
  { name: 'panel ', args: ['run', 'dev', '-w', '@ttl/overlay'] },
].map(({ name, args }) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `[${name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}kapandı (kod ${code ?? 'sinyal'})\n`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
