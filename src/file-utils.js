export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 2 * 1024 ** 3;
export function validateFile(file) {
  if (!/\.(pdf|jpe?g|png|webp|zip|rar)$/i.test(file.name)) return 'Поддерживаются PDF, JPG, PNG, WebP, ZIP и RAR.';
  if (!file.size) return 'Файл пуст. Выберите другой файл.';
  if (file.size > MAX_FILE_BYTES) return 'Максимальный размер файла — 500 МБ.';
  return null;
}
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes >= 1024 ** 3) return `${(bytes/1024**3).toLocaleString('ru-RU',{maximumFractionDigits:1})} ГБ`;
  const unit = bytes >= 1024 ** 2 ? 'МБ' : 'КБ';
  return `${(bytes / (unit === 'МБ' ? 1024 ** 2 : 1024)).toLocaleString('ru-RU', {maximumFractionDigits: 1})} ${unit}`;
}
export function uniqueFilename(name, occupiedNames = new Set()) {
  const safe = name.split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '') || 'file';
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0,dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  const used = new Set([...occupiedNames].map(n => n.toLowerCase()));
  let candidate = safe, i = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${i++})${ext}`;
  return candidate;
}
