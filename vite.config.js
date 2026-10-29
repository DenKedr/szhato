import {defineConfig} from 'vite';
import {unrarCspPlugin} from './build/unrar-csp.js';

export default defineConfig(({command,isPreview})=>({
  base: command==='serve'&&!isPreview ? '/' : '/compressed/',
  plugins: [unrarCspPlugin()],
  optimizeDeps: {exclude:['node-unrar-js']},
  worker: {format:'es',plugins:()=>[unrarCspPlugin()]},
}));
