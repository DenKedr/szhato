import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexPath = new URL('../index.html', import.meta.url);
const canonical = 'https://project.it-kedr.ru/compressed';

function verifyMetadata(html) {
  assert.match(html, /<html\s+lang="ru"/);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  assert.match(title, /сжатие/i);
  assert.match(title, /конвертер/i);
  assert.match(title, /ZIP\/RAR/);
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';
  assert.match(description, /PDF/);
  assert.match(description, /конверт/i);
  assert.match(description, /ZIP.*RAR/);
  assert.equal(html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1], canonical);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(script[1], /\bsrc=/, 'CSP must not need inline script permission');
    assert.equal(script[2].trim(), '');
  }
}

test('SEO metadata describes all tools and keeps one public canonical', async () => {
  verifyMetadata(await readFile(indexPath, 'utf8'));
});

test('initial compression UI renders on Node without a browser or global window', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    const html = renderToString(React.createElement(App, { initialMode: 'compress' }));
    assert.match(html, /Меньше размер/);
    assert.match(html, /Сжимайте PDF, фотографии и архивы/);
    assert.match(html, /Перетащите файлы сюда/);
    assert.match(html, /Конвертер/);
    assert.match(html, /Что происходит с ZIP и RAR/);
    assert.match(html, /Что умеет конвертер/);
    assert.match(html, /github\.com\/DenKedr\/szhato/);
    assert.match(html, /<option value="raster" selected="">/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.equal(typeof globalThis.window, 'undefined');
  } finally { await server.close(); }
});

test('prerender writes visible HTML and a JavaScript notice without inline scripts', async () => {
  const { prerenderSite } = await import('../build/prerender.mjs');
  const temporary = await mkdtemp(join(tmpdir(), 'szhato-seo-'));
  const htmlPath = join(temporary, 'index.html');
  try {
    await writeFile(htmlPath, await readFile(indexPath));
    await prerenderSite({ root, htmlPath });
    const html = await readFile(htmlPath, 'utf8');
    verifyMetadata(html);
    assert.match(html, /<div id="root"><header/);
    assert.match(html, /<main>/);
    assert.match(html, /Файлы обрабатываются на устройстве/);
    assert.match(html, /<noscript>.*JavaScript.*<\/noscript>/s);
    assert.equal((html.match(/id="root"/g) || []).length, 1);
    assert.ok(html.length > 18000, 'Server HTML contains the actual tool and FAQ, not only a loading placeholder');
    await assert.rejects(prerenderSite({ root, htmlPath }), /пуст|empty|root/i, 'Refuse a duplicate prerender rather than nesting a second app');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
