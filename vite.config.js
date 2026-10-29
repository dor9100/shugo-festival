import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./client'),
  base: './', // relative so the build works on GitHub Pages sub-paths
  publicDir: r('./client/public'),
  resolve: { alias: { '@shared': r('./shared') } },
  server: { port: 47821, fs: { allow: [r('.')] } }, // standalone `npx vite` (the game itself runs on 47820)
  build: { outDir: r('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
