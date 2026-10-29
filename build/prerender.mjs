import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const emptyRoot = /<div id="root">\s*<\/div>/;

// Run only at build time. The same App produces both the public HTML and live UI.
// Vite's middleware mode transforms JSX without listening on a port or using a browser.
export async function prerenderSite({ root = projectRoot, htmlPath = join(root, 'dist/index.html') } = {}) {
  const template = await readFile(htmlPath, 'utf8');
  if (!emptyRoot.test(template)) throw new Error('Prerender requires one empty #root; rebuild Vite output first.');
  const server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    const markup = renderToString(React.createElement(App, { initialMode: 'compress' }));
    if (!markup.includes('<main>') || !markup.includes('<h1')) throw new Error('Prerender produced no visible tool content.');
    const html = template.replace(emptyRoot, () => `<div id="root">${markup}</div>`);
    await writeFile(htmlPath, html, 'utf8');
    return { htmlPath, bytes: Buffer.byteLength(html), markupBytes: Buffer.byteLength(markup) };
  } finally { await server.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prerenderSite();
  console.log(`Prerendered compression UI: ${result.markupBytes} bytes of visible HTML`);
}
