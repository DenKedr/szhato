import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {unrarCspPlugin} from './build/unrar-csp.js';

export default defineConfig(({command,isPreview})=>({
  base: command==='serve'&&!isPreview ? '/' : '/compressed/',
  plugins: [unrarCspPlugin()],
  build: {rollupOptions: {input: {compressed: fileURLToPath(new URL('./index.html', import.meta.url)), converter: fileURLToPath(new URL('./converter/index.html', import.meta.url))}}},
  optimizeDeps: {exclude:['node-unrar-js']},
  worker: {format:'es',plugins:()=>[unrarCspPlugin()]},
}));
