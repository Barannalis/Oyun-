import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Üç ayrı giriş: yayıncı paneli (index.html) ve OBS/LIVE Studio için görüntüleme sayfası (overlay.html).
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay.html', import.meta.url)),
      },
    },
  },
});
