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
const projects = [
  { mode: 'compress', template: 'index.html', name: 'Сжато', path: '/compressed' },
  { mode: 'convert', template: 'converter/index.html', name: 'Конвертер', path: '/converter' },
];
function verifyMetadata(html, project) {
  assert.match(html, /<html\s+lang="ru"/);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';
  assert.match(title, new RegExp(project.name));
  assert.match(title, /PDF/);
  assert.match(description, /PDF/);
  if (project.mode === 'compress') {
    assert.match(title, /сжатие/i);
    assert.match(description, /ZIP.*RAR/);
    assert.doesNotMatch(title, /конвертер/i);
  } else {
    assert.match(title, /JPEG/);
    assert.match(description, /конверт/i);
    assert.doesNotMatch(title, /Сжато/);
    assert.match(html, /%BASE_URL%converter\.svg/);
  }
  const canonical = 'https://project.it-kedr.ru' + project.path;
  assert.equal(html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1], canonical);
  assert.equal(html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/)?.[1], canonical);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(script[1], /\bsrc=/, 'CSP must not need inline script permission');
    assert.equal(script[2].trim(), '');
  }
}
function verifySeparateUi(html, project) {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /github\.com\/DenKedr\/szhato/);
  assert.match(html, /ym-hide-content/);
  assert.doesNotMatch(html, /aria-label="Выбор инструмента"/);
  assert.doesNotMatch(html, /class="tool-switch"/);
  if (project.mode === 'compress') {
    assert.match(html, /Сжать файлы/);
    assert.doesNotMatch(html, /id="conversion-format"/);
    assert.doesNotMatch(html, /Конвертировать файлы/);
    assert.match(html, /<option value="raster" selected="">/);
    assert.match(html, /<select id="archive-mode"/);
    assert.match(html, /<option value="optimize" selected="">Сжать PDF и фотографии внутри<\/option>/);
    assert.match(html, /Только перепаковать без изменения файлов/);
    assert.match(html, /Поиск, выделение текста, ссылки, формы и подписи не сохранятся/);
  } else {
    assert.match(html, /Конвертировать файлы/);
    assert.match(html, /id="conversion-format"/);
    assert.doesNotMatch(html, />Сжать файлы</);
    assert.doesNotMatch(html, /id="archive-mode"/);
  }
}

test('standalone project templates have distinct metadata and canonicals', async () => {
  const templates = await Promise.all(projects.map(project => readFile(join(root, project.template), 'utf8')));
  for (const [index, html] of templates.entries()) verifyMetadata(html, projects[index]);
  assert.notEqual(templates[0].match(/<title>([^<]+)/)?.[1], templates[1].match(/<title>([^<]+)/)?.[1]);
});

test('both standalone project UIs render on Node without a browser or global window', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    for (const project of projects) {
      const html = renderToString(React.createElement(App, { initialMode: project.mode }));
      verifySeparateUi(html, project);
    }
    assert.equal(typeof globalThis.window, 'undefined');
  } finally { await server.close(); }
});

test('prerender writes both complete project pages without inline scripts or nested roots', async () => {
  const { prerenderSite } = await import('../build/prerender.mjs');
  const temporary = await mkdtemp(join(tmpdir(), 'szhato-seo-'));
  try {
    for (const project of projects) {
      const htmlPath = join(temporary, project.mode + '.html');
      await writeFile(htmlPath, await readFile(join(root, project.template)));
      const result = await prerenderSite({ root, htmlPath, mode: project.mode });
      assert.equal(result.mode, project.mode);
      const html = await readFile(htmlPath, 'utf8');
      verifyMetadata(html, project);
      verifySeparateUi(html, project);
      assert.match(html, /<div id="root"><header/);
      assert.match(html, /<main/);
      assert.match(html, /<noscript>.*JavaScript.*<\/noscript>/s);
      assert.equal((html.match(/id="root"/g) || []).length, 1);
      assert.ok(html.length > 15000, 'HTTP HTML contains the real tool and FAQ, not only a loading placeholder');
      await assert.rejects(prerenderSite({ root, htmlPath, mode: project.mode }), /пуст|empty|root/i);
    }
    await assert.rejects(prerenderSite({ mode: 'unknown' }), /Unsupported/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
