import {PDFDocument} from 'pdf-lib';

export function checkPdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0,1024));
  if (!head.includes('%PDF-')) throw new Error('Файл не является PDF или повреждён.');
  // Rewriting a signed PDF invalidates the signature. Never silently do that.
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 65560));
    if (/\/ByteRange\s*\[/.test(text)) throw new Error('PDF содержит цифровую подпись. Сжатие нарушит её — выберите документ без подписи.');
  }
}
export async function loadPdf(bytes) {
  checkPdf(bytes);
  try {
    return await PDFDocument.load(bytes, {updateMetadata:false});
  } catch (error) {
    if (/encrypt|password/i.test(error.message)) throw new Error('PDF защищён паролем. Сначала сохраните копию без защиты.');
    throw new Error('Не удалось прочитать PDF. Возможно, файл повреждён.');
  }
}
export async function compressPdfPreserve(bytes, optimizeDocument) {
  const doc = await loadPdf(bytes);
  if (!doc.getPageCount()) throw new Error('В PDF нет страниц.');
  if (optimizeDocument) await optimizeDocument(doc);
  return doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});
}
