import React, { useEffect, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowDownToLine, ArrowRight, Check, ChevronDown, FileText, Files, Image as ImageIcon, LoaderCircle, LockKeyhole, Plus, ShieldCheck, SlidersHorizontal, Upload, X, Zap } from 'lucide-react';
import { createResultsZip } from './results-zip.js';
import { compressFile } from './compression.js';
import { convertFile, validateConversionFile } from './conversion.js';
import { validateFile, formatBytes, uniqueFilename, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './file-utils.js';

const FILE_TTL_MS = 15 * 60 * 1000;
const expiryMessage = 'Время хранения истекло. Файлы и результаты удалены из очереди. Скачанные копии остаются у вас.';
const timeRemaining = (expiresAt, now) => { const seconds = Math.max(0, Math.min(FILE_TTL_MS / 1000, Math.ceil((expiresAt - now) / 1000))); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const tabs = [{ id: 'all', name: 'Все файлы', icon: Files }, { id: 'pdf', name: 'PDF', icon: FileText }, { id: 'image', name: 'Изображения', icon: ImageIcon }, { id: 'archive', name: 'Архивы', icon: Archive }];
const levels = [{ id: 'gentle', title: 'Бережное', description: 'Выше качество, меньше сжатие', bars: 1 }, { id: 'balanced', title: 'Оптимальное', description: 'Баланс размера и качества', bars: 2 }, { id: 'strong', title: 'Максимальное', description: 'Меньше размер, заметнее потери', bars: 3 }];
const accept = { all: '.pdf,.jpg,.jpeg,.png,.webp,.zip,.rar', pdf: '.pdf', image: '.jpg,.jpeg,.png,.webp', archive: '.zip,.rar' };
const archiveLevels = { gentle: 1, balanced: 6, strong: 9 };
const conversionLevels = [{ id: 'gentle', title: 'Высокое качество', description: 'PDF: 216 dpi · чётче детали', bars: 1 }, { id: 'balanced', title: 'Оптимальное', description: 'PDF: 144 dpi · баланс размера', bars: 2 }, { id: 'strong', title: 'Компактный файл', description: 'PDF: 96 dpi · меньше размер', bars: 3 }];
const kindOf = file => /\.(zip|rar)$/i.test(file.name) ? 'archive' : /\.pdf$/i.test(file.name) ? 'pdf' : 'image';

function Brand({ small = false }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M7 5v7h7M25 27v-7h-7M7 12l7-7M25 20l-7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 20h7M18 12h7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>сжато<span className="brand-dot">.</span></span>;
}

function FileArtwork() {
  return <div className="file-art" aria-hidden="true"><div className="art-card art-image"><span className="art-corner" /><ImageIcon size={30} strokeWidth={1.6} /><span>JPG</span></div><div className="art-card art-pdf"><span className="art-corner" /><FileText size={33} strokeWidth={1.6} /><span>PDF</span></div><span className="art-bubble"><ArrowDown size={22} strokeWidth={2.3} /></span></div>;
}


export default function App({ initialMode } = {}) {
  const [mode, setMode] = useState(() => initialMode ?? (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tool') === 'convert' ? 'convert' : 'compress'));
  const [targetFormat, setTargetFormat] = useState('jpeg');
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState([]);
  const [level, setLevel] = useState('balanced');
  const [pdfMode, setPdfMode] = useState('raster');
  const [imageFormat, setImageFormat] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState({ percent: 0, message: '' });
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const rowsRef = useRef([]);
  // Blob/File objects live only here, never in React state or batch snapshots.
  const resources = useRef(new Map());
  const activeId = useRef(null);
  const zipJob = useRef(null);
  const downloadUrls = useRef(new Map());
  const input = useRef(null);
  const controller = useRef(null);
  const urls = useRef(new Set());
  const dragDepth = useRef(0);
  const noticeRef = useRef(null);

  useEffect(() => {
    const check = () => { const timestamp = Date.now(); setNow(timestamp); purgeExpired(timestamp); };
    const timer = setInterval(check, 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      controller.current?.abort();
      zipJob.current?.controller.abort();
      rowsRef.current = [];
      resources.current.clear();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
      for (const [url, entry] of downloadUrls.current) { clearTimeout(entry.timer); URL.revokeObjectURL(url); }
      downloadUrls.current.clear();
    };
  }, []);
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);

  const totalSize = rows.reduce((sum, row) => sum + row.file.size, 0);
  const completed = rows.filter(row => row.result);
  const outputSize = completed.reduce((sum, row) => sum + row.result.outputSize, 0);
  const inputSize = completed.reduce((sum, row) => sum + row.file.size, 0);
  const sizeDelta = inputSize - outputSize;
  const hasPdf = rows.length === 0 ? ['all', 'pdf'].includes(tab) : rows.some(row => row.kind === 'pdf');
  const hasImage = rows.length === 0 ? ['all', 'image'].includes(tab) : rows.some(row => row.kind === 'image');
  const hasArchive = rows.length === 0 ? ['all', 'archive'].includes(tab) : rows.some(row => row.kind === 'archive');
  const activeRow = rows.find(row => row.status === 'working');
  const converting = mode === 'convert';
  const visibleTabs = tabs.filter(item => !converting || item.id !== 'archive');
  const currentLevels = converting ? conversionLevels : levels;
  const pickerAccept = converting ? (targetFormat === 'pdf' ? accept.image : tab === 'all' ? '.pdf,.jpg,.jpeg,.png,.webp' : accept[tab]) : accept[tab];
  const conversionErrors = converting ? rows.map(row => ({ id: row.id, filename: row.file.name, error: validateConversionFile(resources.current.get(row.id)?.file || row.file, targetFormat) })).filter(row => row.error) : [];

  function changeMode(next) {
    if (busy || zipping) return;
    purgeExpired();
    setMode(next);
    if (next === 'convert' && (tab === 'archive' || (targetFormat === 'pdf' && tab === 'pdf'))) setTab('all');
    const url = new URL(window.location.href);
    if (next === 'convert') url.searchParams.set('tool', 'convert'); else url.searchParams.delete('tool');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function changeTarget(next) {
    if (busy || zipping) return;
    purgeExpired();
    setTargetFormat(next);
    if (next === 'pdf' && tab === 'pdf') setTab('image');
  }

  // The ref is authoritative even when a background tab delays React rendering.
  function replaceRows(next) { rowsRef.current = next; setRows(next); }

  function releaseDownloadUrl(url) {
    const entry = downloadUrls.current.get(url);
    if (entry) clearTimeout(entry.timer);
    URL.revokeObjectURL(url);
    downloadUrls.current.delete(url);
  }

  function releaseRow(row) {
    resources.current.delete(row.id);
    if (row.preview) { URL.revokeObjectURL(row.preview); urls.current.delete(row.preview); }
    for (const [url, entry] of downloadUrls.current) if (entry.ids.includes(row.id)) releaseDownloadUrl(url);
  }

  function purgeExpired(timestamp = Date.now()) {
    const expired = rowsRef.current.filter(row => row.expiresAt <= timestamp);
    if (!expired.length) return false;
    const ids = new Set(expired.map(row => row.id));
    if (ids.has(activeId.current)) controller.current?.abort('expired');
    if (zipJob.current?.ids.some(id => ids.has(id))) zipJob.current.controller.abort('expired');
    for (const row of expired) releaseRow(row);
    replaceRows(rowsRef.current.filter(row => !ids.has(row.id)));
    if (input.current) input.current.value = '';
    setNotice(expiryMessage);
    return true;
  }

  function liveRow(id) {
    purgeExpired();
    return rowsRef.current.find(row => row.id === id);
  }

  function downloadResult(id) {
    const row = liveRow(id);
    if (!row?.result) return;
    const result = resources.current.get(id)?.result;
    if (result) saveBlob(result.blob, result.filename, [id]);
  }

  function saveBlob(blob, filename, ids) {
    purgeExpired();
    const current = ids.map(id => rowsRef.current.find(row => row.id === id));
    if (current.some(row => !row || row.expiresAt <= Date.now())) { purgeExpired(); return false; }
    const expiresAt = Math.min(...current.map(row => row.expiresAt));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    if (Date.now() >= expiresAt) { anchor.remove(); URL.revokeObjectURL(url); purgeExpired(); return false; }
    anchor.click();
    anchor.remove();
    const timer = setTimeout(() => releaseDownloadUrl(url), Math.max(0, Math.min(30000, expiresAt - Date.now())));
    downloadUrls.current.set(url, { ids, timer });
    return true;
  }

  function addFiles(fileList) {
    if (busy || zipping) return;
    const files = Array.from(fileList || []);
    purgeExpired();
    if (!files.length) return;
    const errors = [];
    let size = rowsRef.current.reduce((sum, row) => sum + row.file.size, 0);
    const added = [];
    for (const file of files) {
      const error = mode === 'convert' ? validateConversionFile(file, targetFormat) : validateFile(file);
      if (error) { errors.push(`${file.name}: ${error}`); continue; }
      const kind = kindOf(file);
      if (tab !== 'all' && kind !== tab) { errors.push(`${file.name}: выберите вкладку «Все файлы», чтобы добавить другой формат.`); continue; }
      if (size + file.size > MAX_TOTAL_BYTES) { errors.push(`${file.name}: общий размер очереди не должен превышать ${formatBytes(MAX_TOTAL_BYTES)}.`); continue; }
      const preview = kind === 'image' ? URL.createObjectURL(file) : null;
      if (preview) urls.current.add(preview);
      const id = crypto.randomUUID();
      resources.current.set(id, { file, result: null });
      added.push({ id, file: { name: file.name, size: file.size, type: file.type }, kind, preview, expiresAt: Date.now() + FILE_TTL_MS, status: 'ready', progress: 0, message: '', result: null, error: null });
      size += file.size;
    }
    replaceRows([...rowsRef.current, ...added]);
    if (errors.length) setNotice(errors.slice(0, 4).join('\n'));
    else if (added.length) setNotice('');
    if (input.current) input.current.value = '';
  }

  function removeRow(id) {
    if (busy || zipping) return;
    const row = liveRow(id);
    if (row) releaseRow(row);
    replaceRows(rowsRef.current.filter(item => item.id !== id));
  }

  function clear() {
    if (busy || zipping) return;
    for (const row of rowsRef.current) releaseRow(row);
    replaceRows([]);
    setNotice('');
    if (input.current) input.current.value = '';
  }

  function patchRow(id, patch) {
    purgeExpired();
    replaceRows(rowsRef.current.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function runCompression() {
    purgeExpired();
    if (!rowsRef.current.length || busy || zipping) return;
    if (mode === 'convert') {
      const invalid = rowsRef.current.map(row => ({ row, error: validateConversionFile(resources.current.get(row.id).file, targetFormat) })).filter(item => item.error);
      if (invalid.length) { setNotice('Некоторые файлы не подходят для выбранного формата. Измените формат или удалите их из очереди.'); return; }
    }
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(true);
    setNotice('');
    // Retain IDs, never a snapshot of original/result blobs across the batch.
    const ids = rowsRef.current.map(row => row.id);
    for (const row of rowsRef.current) for (const [url, entry] of downloadUrls.current) if (entry.ids.includes(row.id)) releaseDownloadUrl(url);
    for (const resource of resources.current.values()) resource.result = null;
    replaceRows(rowsRef.current.map(row => ({ ...row, status: 'ready', progress: 0, result: null, error: null, message: '' })));
    try {
      for (const id of ids) {
        if (aborter.signal.aborted) break;
        if (!liveRow(id)) continue;
        activeId.current = id;
        patchRow(id, { status: 'working', message: 'Подготавливаем файл…' });
        try {
          const processor = mode === 'convert' ? convertFile : compressFile;
          const options = mode === 'convert' ? { format: targetFormat, level } : { level, pdfMode, imageFormat };
          let result = await processor(resources.current.get(id).file, options, (progress, message) => patchRow(id, { progress, message }), aborter.signal);
          if (!liveRow(id)) { result = null; if (aborter.signal.aborted) break; continue; }
          if (aborter.signal.aborted) { result = null; patchRow(id, { status: 'ready', progress: 0, message: '' }); break; }
          resources.current.get(id).result = result;
          const summary = { filename: result.filename, originalSize: result.originalSize, outputSize: result.outputSize, savedPercent: result.savedPercent, changed: result.changed, note: result.note, kind: result.kind, operation: mode };
          patchRow(id, { status: 'done', progress: 100, message: '', result: summary });
          result = null;
        } catch (error) {
          if (aborter.signal.aborted || error?.name === 'AbortError') { patchRow(id, { status: 'ready', progress: 0, message: '' }); break; }
          patchRow(id, { status: 'error', progress: 0, error: error?.message || 'Не удалось обработать файл. Попробуйте другой файл.' });
        } finally { activeId.current = null; }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      setBusy(false);
      activeId.current = null;
      controller.current = null;
      purgeExpired();
      if (aborter.signal.aborted && aborter.signal.reason !== 'expired') setNotice(mode === 'convert' ? 'Конвертация остановлена. Готовые результаты можно скачать, остальные файлы — обработать заново.' : 'Сжатие остановлено. Готовые результаты можно скачать, остальные файлы — обработать заново.');
    }
  }

  async function downloadAll() {
    purgeExpired();
    const ids = rowsRef.current.filter(row => row.result).map(row => row.id);
    if (!ids.length || zipping || busy) return;
    if (ids.length === 1) { downloadResult(ids[0]); return; }
    setZipping(true);
    setZipProgress({ percent: 0, message: 'Подготавливаем архив…' });
    setNotice('');
    const aborter = new AbortController();
    const entries = [];
    zipJob.current = { ids, controller: aborter };
    try {
      const names = new Set();
      for (const id of ids) {
        if (!liveRow(id)?.result || aborter.signal.aborted) throw new DOMException('Время хранения истекло', 'AbortError');
        const resource = resources.current.get(id)?.result;
        if (!resource) throw new DOMException('Файл удалён из очереди', 'AbortError');
        const name = uniqueFilename(resource.filename, names);
        names.add(name);
        // Pass Blob references; the helper reads one chunk at a time, never every result buffer.
        entries.push({ name, blob: resource.blob });
      }
      let blob = await createResultsZip(entries, aborter.signal, (percent, message) => {
        purgeExpired();
        if (!aborter.signal.aborted) setZipProgress({ percent: Math.max(0, Math.min(100, Number(percent) || 0)), message: message || 'Собираем ZIP…' });
      });
      purgeExpired();
      if (!aborter.signal.aborted && ids.every(id => liveRow(id)?.result)) saveBlob(blob, 'szhato-files.zip', ids);
      blob = null;
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice(error?.message || 'Не удалось собрать архив. Скачайте файлы по отдельности.');
      else if (aborter.signal.reason === 'user') setNotice('Сборка архива остановлена. Готовые файлы можно скачать по отдельности.');
    } finally {
      entries.length = 0;
      zipJob.current = null;
      setZipping(false);
    }
  }

  const handleDrop = event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(event.dataTransfer.files); };

  return <>
    <header className="site-header"><div className="header-inner"><a href="#" className="brand-link" aria-label="Сжато — наверх"><Brand /></a><nav aria-label="Основная навигация"><a href="/" className="all-projects">Все проекты</a><a href="#how-it-works">Как это работает</a><a href="#questions">Вопросы и ответы</a></nav><span className="header-local"><span />Всё на вашем устройстве</span></div></header>
    <main>
      <section className="hero" aria-labelledby="main-title"><div className="privacy-pill"><ShieldCheck size={15} />Без загрузки на сервер</div><h1 id="main-title">{converting ? <>Нужный формат.<br />Без лишних шагов.</> : <>Меньше размер.<br />Легче отправить.</>}</h1><p>{converting ? 'Конвертируйте PDF и фотографии прямо в браузере.' : 'Сжимайте PDF, фотографии и архивы.'}<br className="desktop-break" /> Без регистрации. Ваши файлы остаются у вас.</p></section>
      <div className="tool-switch" role="group" aria-label="Выбор инструмента"><button type="button" aria-pressed={!converting} onClick={() => changeMode('compress')} disabled={busy || zipping}>Сжатие</button><button type="button" aria-pressed={converting} onClick={() => changeMode('convert')} disabled={busy || zipping}>Конвертер</button></div>
      <section className={`compressor ${converting ? 'converter-mode' : ''}`} aria-label={converting ? 'Конвертация файлов' : 'Сжатие файлов'}>
        <div className="workspace-top"><div className="tabs" role="tablist" aria-label="Тип файлов">{visibleTabs.map(({ id, name, icon: Icon }) => <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="file-workspace" className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)} disabled={busy || zipping || (converting && targetFormat === 'pdf' && id === 'pdf')}><Icon size={17} />{name}</button>)}</div><span className="workspace-limit">До {formatBytes(MAX_FILE_BYTES)} на файл</span></div>
        <div className="workspace-grid">
          <div className="file-workspace" id="file-workspace" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            <input ref={input} className="visually-hidden" type="file" multiple accept={pickerAccept} aria-label={converting ? 'Выбрать файлы для конвертации' : 'Выбрать файлы для сжатия'} onChange={event => addFiles(event.target.files)} disabled={busy || zipping} tabIndex={-1} />
            <div className={`dropzone ${dragging ? 'dragging' : ''} ${rows.length ? 'dropzone-compact' : ''}`} onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={handleDrop}>
              {!rows.length && <FileArtwork />}
              <h2>{dragging ? 'Отпустите файлы здесь' : rows.length ? 'Есть ещё файлы?' : 'Перетащите файлы сюда'}</h2>
              <p>{rows.length ? 'Добавьте их в общую очередь' : 'или выберите их на своём устройстве'}</p>
              <button type="button" className={rows.length ? 'button button-secondary' : 'button button-primary select-button'} onClick={() => input.current?.click()} disabled={busy || zipping}>{rows.length ? <Plus size={18} /> : <Upload size={18} />}{rows.length ? 'Добавить файлы' : 'Выбрать файлы'}</button>
              {!rows.length && <span className="formats">{converting ? (targetFormat === 'pdf' || tab === 'image' ? 'JPG, PNG, WebP' : tab === 'pdf' ? 'PDF' : 'PDF, JPG, PNG, WebP') : tab === 'pdf' ? 'PDF' : tab === 'image' ? 'JPG, PNG, WebP' : tab === 'archive' ? 'ZIP, RAR' : 'PDF, JPG, PNG, WebP, ZIP, RAR'}<span>без лимита количества</span></span>}
            </div>
            {notice && <div className="notice" role="alert" ref={noticeRef} tabIndex={-1}><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Скрыть сообщение"><X size={17} /></button></div>}
            {conversionErrors.length > 0 && <div className="notice conversion-notice" role="alert"><span>Эти файлы не подходят для выбранного формата. Измените формат или удалите их из очереди: {conversionErrors.slice(0, 4).map(item => `${item.filename}: ${item.error}`).join('; ')}{conversionErrors.length > 4 ? `; ещё ${conversionErrors.length - 4}` : ''}. Очередь сохранена.</span></div>}
            {rows.length > 0 && <div className="queue"><div className="queue-header"><h2>Ваши файлы <span>{rows.length}</span></h2><button type="button" className="text-button" onClick={clear} disabled={busy || zipping}>Очистить</button></div><ul className="file-list">{rows.map(row => <li className={`file-row ${row.status === 'error' ? 'file-error' : ''}`} key={row.id} data-expires-at={row.expiresAt}><div className={`file-thumbnail ${row.kind === 'pdf' ? 'thumbnail-pdf' : row.kind === 'archive' ? 'thumbnail-archive' : ''}`}>{row.preview ? <img src={row.preview} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : row.kind === 'archive' ? <Archive size={25} strokeWidth={1.5} /> : <FileText size={25} strokeWidth={1.5} />}{row.kind === 'pdf' && <span>PDF</span>}{row.kind === 'archive' && <span>{/\.rar$/i.test(row.file.name) ? 'RAR' : 'ZIP'}</span>}</div><div className="file-info"><p className="file-name" title={row.file.name}>{row.file.name}</p><span className="file-expiry" data-testid="file-expiry">Удаление через {timeRemaining(row.expiresAt, now)}</span><div className="file-meta"><span>{formatBytes(row.file.size)}</span>{row.result && <><ArrowRight size={13} /><strong>{formatBytes(row.result.outputSize)}</strong>{row.result.changed && row.result.savedPercent > 0 && <span className="saved-tag">−{row.result.savedPercent.toFixed(0)}%</span>}</>}</div>{row.status === 'working' && <><div className="file-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress)} aria-label={`${converting ? 'Конвертация' : 'Сжатие'} ${row.file.name}`}><span style={{ width: `${Math.max(2, Math.min(100, row.progress || 0))}%` }} /></div><span className="file-message">{row.message || (converting ? 'Конвертируем…' : 'Сжимаем…')}</span></>}{row.error && <span className="file-message error-message">{row.error}</span>}{row.result && <span className={`file-message ${row.result.changed ? 'result-message' : ''}`}>{row.result.note || (row.result.operation === 'convert' ? 'Конвертация завершена. Готово к скачиванию.' : row.kind === 'archive' ? 'Архив перепакован в ZIP. Размер может не уменьшиться.' : row.result.changed ? 'Готово к скачиванию' : 'Файл уже хорошо сжат. Сохранён оригинал.')}</span>}</div><div className="file-actions">{row.status === 'working' ? <LoaderCircle className="spin" size={21} /> : row.result ? <button type="button" className="icon-button download-file" onClick={() => downloadResult(row.id)} aria-label={`Скачать ${row.result.filename}`} title="Скачать файл"><ArrowDownToLine size={19} /></button> : null}<button type="button" className="icon-button remove-file" onClick={() => removeRow(row.id)} disabled={busy || zipping} aria-label={`Удалить ${row.file.name}`} title="Удалить файл"><X size={17} /></button></div></li>)}</ul><div className="queue-total"><span>Всего: {formatBytes(totalSize)}</span><span>Лимит очереди: {formatBytes(MAX_TOTAL_BYTES)}</span></div></div>}
            {completed.length > 0 && !busy && <div className="results" aria-live="polite"><div className="result-heading"><span className="result-check"><Check size={20} /></span><div><h2>{sizeDelta > 0 ? `Легче на ${formatBytes(sizeDelta)}` : sizeDelta < 0 ? `Размер вырос на ${formatBytes(-sizeDelta)}` : 'Файлы обработаны'}</h2><p>{completed.length} из {rows.length} готово{` · ${formatBytes(inputSize)} → ${formatBytes(outputSize)}`}</p></div></div><button className="button button-success" type="button" onClick={downloadAll} disabled={zipping}>{zipping ? <LoaderCircle size={18} className="spin" /> : <ArrowDownToLine size={18} />}{zipping ? `Собираем ZIP: ${Math.round(zipProgress.percent)}%` : completed.length > 1 ? 'Скачать ZIP-архив' : 'Скачать файл'}</button>{zipping && <div className="zip-status"><div className="file-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(zipProgress.percent)} aria-label="Сборка ZIP-архива"><span style={{ width: `${zipProgress.percent}%` }} /></div><p role="status">{zipProgress.message}</p><button type="button" className="text-button" onClick={() => zipJob.current?.controller.abort('user')}>Остановить сборку</button></div>}</div>}
            <div className="local-note"><LockKeyhole size={14} /><span>Файлы обрабатываются на устройстве и автоматически удаляются из очереди через 15 минут. Скачанные копии остаются у вас.</span></div>
          </div>
          <aside className="settings" aria-label={converting ? 'Настройки конвертации' : 'Настройки сжатия'}><div className="settings-heading"><SlidersHorizontal size={18} /><h2>{converting ? 'Настройки конвертации' : 'Настройки сжатия'}</h2></div>
            {converting && <fieldset className="conversion-format" disabled={busy || zipping}><label className="select-label" htmlFor="conversion-format">Конвертировать в</label><div className="select-wrap"><select id="conversion-format" value={targetFormat} onChange={event => changeTarget(event.target.value)}><option value="jpeg">JPEG (.jpg)</option><option value="png">PNG</option><option value="webp">WebP</option><option value="pdf">PDF</option></select><ChevronDown size={16} /></div><p className="setting-hint">{targetFormat === 'pdf' ? 'Каждое изображение станет отдельным PDF. Файлы не объединяются.' : 'Из PDF: одна страница — одна картинка; несколько страниц — ZIP с картинками.'}</p><p className="setting-hint">{targetFormat === 'jpeg' ? 'Прозрачные области станут белыми.' : targetFormat === 'png' || targetFormat === 'webp' ? 'PNG и WebP сохраняют прозрачность.' : 'Поддерживаются JPG, PNG и WebP. PDF → PDF не выполняется.'}</p></fieldset>}
            <fieldset disabled={busy || zipping}><legend>{converting ? 'Качество результата' : 'Уровень сжатия'}</legend><div className="level-options">{currentLevels.map(option => <label className={`level-option ${level === option.id ? 'selected' : ''}`} key={option.id}><input type="radio" name="compression-level" value={option.id} checked={level === option.id} onChange={() => setLevel(option.id)} /><span className="level-bars" aria-hidden="true">{[1, 2, 3].map(bar => <i key={bar} className={bar <= option.bars ? 'filled' : ''} />)}</span><span className="level-copy"><span className="level-title">{option.title}{option.id === 'balanced' && <span className="recommended">Рекомендуем</span>}</span><span className="level-description">{!converting && tab === 'archive' ? `Сжатие ZIP, уровень ${archiveLevels[option.id]}` : option.description}</span></span><span className="radio-mark" aria-hidden="true">{level === option.id && <span />}</span></label>)}</div></fieldset>
            {!converting && hasPdf && <fieldset className="extra-options" disabled={busy || zipping}><legend>Обработка PDF</legend><label className="select-label" htmlFor="pdf-mode">Что важнее сохранить</label><div className="select-wrap"><select id="pdf-mode" value={pdfMode} onChange={event => setPdfMode(event.target.value)}><option value="preserve">Текст и структуру документа</option><option value="raster">Минимальный размер файла</option></select><ChevronDown size={16} /></div><p className={pdfMode === 'raster' ? 'setting-hint warning' : 'setting-hint'}>{pdfMode === 'raster' ? 'Страницы станут изображениями. Поиск, выделение текста, ссылки, формы и подписи не сохранятся. До 150 страниц.' : 'Сохраняет текст, ссылки и формы. Уменьшает JPEG-изображения внутри PDF; для других изображений выигрыш может быть небольшим.'}</p></fieldset>}
            {!converting && hasImage && <fieldset className="extra-options" disabled={busy || zipping}><legend>Формат фотографий</legend><label className="select-label" htmlFor="image-format">Сохранить результат как</label><div className="select-wrap"><select id="image-format" value={imageFormat} onChange={event => setImageFormat(event.target.value)}><option value="auto">Автоматически</option><option value="jpeg">JPG</option><option value="webp">WebP</option></select><ChevronDown size={16} /></div><p className="setting-hint">{imageFormat === 'jpeg' ? 'Прозрачные области станут белыми. Если результат больше оригинала, сохраним оригинал.' : 'Автоматический режим сохраняет прозрачность. Уже сжатые файлы могут остаться без изменений.'}</p></fieldset>}
            {!converting && hasArchive && <section className="archive-options extra-options" aria-label="Обработка архивов"><h3>Архивы · ZIP, уровень {archiveLevels[level]}</h3><p className="setting-hint">ZIP и RAR перепаковываются в ZIP. Содержимое не открывается и не запускается. Размер может не уменьшиться.</p><p className="setting-hint">До 10 000 записей, 512 МиБ распакованного содержимого и 256 МиБ на запись. Вложенные архивы не распаковываются.</p></section>}
            {converting && <div className="converter-hints"><p className="setting-hint">Фотографии — до 32 Мп. Разрешение исходных фото не уменьшается; уровень задаёт качество JPEG/WebP. Для PDF: 216 / 144 / 96 dpi с ограничением разрешения, до 150 страниц и 512 МиБ готовых изображений в ZIP.</p><p className="setting-hint warning">{targetFormat === 'pdf' ? 'Фотография встраивается в отдельный PDF. Текст на ней не распознаётся. Размер результата может вырасти.' : 'PDF преобразуется в изображения: текст, ссылки, формы и цифровые подписи в результат не переносятся. Подписанные PDF можно конвертировать без изменения исходника. PDF с паролем не поддерживаются. Размер результата может вырасти.'}</p></div>}
            <div className="compress-action">{busy ? <><button type="button" className="button button-primary" onClick={() => controller.current?.abort()}><X size={18} />{converting ? 'Остановить конвертацию' : 'Остановить сжатие'}</button><span className="action-hint" role="status">{activeRow ? `${Math.round(activeRow.progress)}% · Обрабатываем файлы` : 'Завершаем обработку…'}</span></> : <><button type="button" className="button button-primary" disabled={!rows.length || zipping || (converting && conversionErrors.length > 0)} onClick={runCompression}><Zap size={18} />{converting ? (completed.length ? 'Конвертировать заново' : 'Конвертировать файлы') : (completed.length ? 'Сжать заново' : 'Сжать файлы')}<ArrowRight size={18} /></button><span className="action-hint">{rows.length ? 'Настройки применятся ко всем файлам' : 'Добавьте файлы, чтобы начать'}</span></>}</div>
          </aside>
        </div>
      </section>
      <section className="benefits" aria-label="Преимущества"><div><span className="benefit-icon"><ShieldCheck size={21} /></span><div><h2>Личное остаётся личным</h2><p>Файлы не покидают ваше устройство</p></div></div><div><span className="benefit-icon"><Zap size={21} /></span><div><h2>Без лишних шагов</h2><p>Не нужен аккаунт или установка</p></div></div><div><span className="benefit-icon"><Files size={21} /></span><div><h2>Несколько файлов сразу</h2><p>PDF, фотографии и архивы в одной очереди</p></div></div></section>
      <section id="how-it-works" className="how-section"><div className="section-intro"><h2>{converting ? <>От исходника<br />к нужному формату</> : <>От большого файла<br />к готовому вложению</>}</h2><p>Три шага — и можно отправлять.</p></div><ol className="steps"><li><span className="step-number">1</span><div><h3>Добавьте файлы</h3><p>{converting ? 'Выберите PDF, JPG, PNG или WebP. Для создания PDF добавьте фотографии. Количество файлов не ограничено, общий размер — до 2 ГиБ.' : 'Перетащите PDF, JPG, PNG, WebP, ZIP или RAR. Количество файлов не ограничено, общий размер — до 2 ГиБ.'}</p></div></li><li><span className="step-number">2</span><div><h3>{converting ? 'Выберите формат' : 'Выберите сжатие'}</h3><p>{converting ? 'JPEG, PNG, WebP или PDF. Каждое фото станет отдельным PDF, многостраничный PDF — ZIP с изображениями.' : 'Для PDF по умолчанию выбран минимальный размер. Уровни архивов: 1, 6 и 9. Качество фото зависит от выбранного уровня.'}</p></div></li><li><span className="step-number">3</span><div><h3>Скачайте результат</h3><p>Сравните размер и сохраните файлы по отдельности или одним архивом.</p></div></li></ol></section>
      <section id="questions" className="faq-section"><div className="section-intro"><h2>Перед обработкой</h2><p>Ответы на частые вопросы.</p></div><div className="faq-list"><details><summary>Куда загружаются мои файлы?<Plus size={18} /></summary><p>Никуда. Сжатие и конвертация происходят в вашем браузере. Сайт не отправляет ваши файлы на сервер. Исходные файлы и результаты автоматически удаляются из очереди через 15 минут после добавления, даже если сжатие выполнялось повторно. При возвращении в приостановленную браузером вкладку время проверяется заново. Скачанные копии остаются у вас. Не закрывайте страницу, пока обработка не закончится.</p></details><details><summary>Что происходит с качеством?<Plus size={18} /></summary><p>Для фотографий мы подбираем качество и разрешение по выбранному уровню. Сжатие с потерями может менять мелкие детали и удаляет метаданные, включая геолокацию. Оригиналы на устройстве не меняются. Режим PDF «Текст и структуру документа» сохраняет текст, ссылки и формы и уменьшает JPEG-изображения внутри PDF; «Минимальный размер файла» преобразует страницы в изображения и убирает поиск, выделение текста, ссылки, формы и подписи. При сжатии PDF и фотографий сохраняется исходник, если новый файл больше. При конвертации всегда выдаётся выбранный формат. Архив RAR конвертируется в ZIP, поэтому результат может стать больше исходника.</p></details><details><summary>Какие форматы и размеры поддерживаются?<Plus size={18} /></summary><p>PDF, JPG, JPEG, PNG, WebP, ZIP и RAR. Количество файлов не ограничено. До {formatBytes(MAX_FILE_BYTES)} на один файл и {formatBytes(MAX_TOTAL_BYTES)} в очереди. Большие файлы обрабатываются по очереди; на устройстве должно быть достаточно свободной памяти. Фотографии — до 32 мегапикселей, PDF в режиме минимального размера — до 150 страниц. Защищённые паролем PDF нужно предварительно разблокировать. Подписанные PDF отклоняются при сжатии, но доступны для конвертации без изменения исходника; подпись в результате не сохраняется. Анимированные PNG/WebP не поддерживаются. HEIC, GIF и видео пока не поддерживаются.</p></details><details><summary>Почему размер почти не изменился?<Plus size={18} /></summary><p>Хорошо оптимизированный файл нельзя сильно уменьшить без потери качества. Мы честно показываем результат. При сжатии PDF и фотографий сохраняем оригинал, если новый файл получился больше. Конвертер выдаёт выбранный формат, даже если размер вырос. ZIP и RAR перепаковываются в ZIP без изменения содержимого; размер может не уменьшиться, а после RAR — увеличиться. Для PDF со сканами попробуйте режим минимального размера — после ознакомления с предупреждением о преобразовании страниц.</p></details><details><summary>Что происходит с ZIP и RAR?<Plus size={18} /></summary><p>ZIP и RAR перепаковываются в ZIP с уровнями сжатия 1, 6 или 9 без изменения содержимого файлов. Допускается до 10 000 записей, суммарно до 512 МиБ после распаковки и до 256 МиБ на одну запись. Архивы с паролем, ссылками, опасными путями и несколькими томами отклоняются. Вложенные архивы не распаковываются повторно. Содержимое не открывается и не запускается. Сервис не проверяет его на вредоносный код: вредоносные вложения могут остаться в скачанном ZIP. Итоговый архив может оказаться больше исходника.</p></details><details><summary>Что умеет конвертер?<Plus size={18} /></summary><p>Конвертер принимает PDF, JPG, PNG и WebP и создаёт JPEG, PNG, WebP или PDF. Каждая фотография становится отдельным PDF без объединения. При PDF → картинки одна страница выдаётся отдельным изображением, несколько — ZIP-архивом изображений. PNG и WebP сохраняют прозрачность; JPEG заменяет её белым фоном. Разрешение исходных фотографий не уменьшается. Уровень качества задаёт JPEG/WebP-качество и PDF-рендеринг 216, 144 или 96 dpi с ограничением разрешения. Допускаются фотографии до 32 Мп, PDF до 150 страниц и до 512 МиБ изображений в ZIP результата. Подписанный PDF можно прочитать и преобразовать, но подпись в результат не переносится; PDF с паролем отклоняется. Архивы ZIP/RAR в конвертере не поддерживаются. Новый формат может оказаться больше исходника — конвертер не подменяет результат оригиналом.</p></details><details><summary>Нужен ли интернет для обработки?<Plus size={18} /></summary><p>Интернет нужен, чтобы открыть сайт и загрузить его компоненты. Сами файлы обрабатываются локально. Скорость зависит от размера файлов и мощности устройства. На телефоне лучше обрабатывать большие документы по одному.</p></details></div></section>
    </main><footer className="site-footer"><div><a href="#" className="brand-link" aria-label="Сжато — наверх"><Brand small /></a><p>Меньше вес. Больше свободы.</p></div><div className="source-links"><a className="source-link" href="https://github.com/DenKedr/szhato" target="_blank" rel="noopener noreferrer">GitHub</a><a className="source-link" href="/source/szhato-source.zip">Исходники ZIP <ArrowDownToLine size={14} /></a><span>Open Source · Бесплатно</span></div></footer>
  </>;
}
