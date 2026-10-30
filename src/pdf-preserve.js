import {PDFDocument,PDFRawStream,PDFName,PDFNumber} from 'pdf-lib';

export function checkPdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0,1024));
  if (!head.includes('%PDF-')) throw new Error('Файл не является PDF или повреждён.');
  // Rewriting a signed PDF invalidates the signature. Never silently do that.
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 65560));
    if (/\/ByteRange\s*\[/.test(text)) throw new Error('PDF содержит цифровую подпись. Сжатие нарушит её — выберите документ без подписи.');
  }
}
export async function loadPdf(bytes,{raster=false}={}) {
  checkPdf(bytes);
  let doc;
  try {
    doc=await PDFDocument.load(bytes, {updateMetadata:false});
  } catch (error) {
    if (/encrypt|password/i.test(error.message)) throw new Error('PDF защищён паролем. Сначала сохраните копию без защиты.');
    throw new Error('Не удалось прочитать PDF. Возможно, файл повреждён.');
  }
  if(raster)for(const [,object] of doc.context.enumerateIndirectObjects()){
    if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))!==PDFName.of('Image'))continue;
    const width=object.dict.lookup(PDFName.of('Width'),PDFNumber)?.asNumber();
    const height=object.dict.lookup(PDFName.of('Height'),PDFNumber)?.asNumber();
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>32_000_000){
      throw new Error('В PDF изображение больше 32 мегапикселей или с неверными размерами. Выберите сохранение текста.');
    }
  }
  return doc;
}
export async function compressPdfPreserve(bytes, optimizeDocument) {
  const doc = await loadPdf(bytes);
  if (!doc.getPageCount()) throw new Error('В PDF нет страниц.');
  if (optimizeDocument) await optimizeDocument(doc);
  return doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});
}
