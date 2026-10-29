import {PDFDocument, PDFRawStream, PDFName, PDFNumber} from 'pdf-lib';
import {validateFile, uniqueFilename} from './file-utils.js';
import {compressPdfPreserve, loadPdf} from './pdf-preserve.js';

const presets = {
  gentle: {quality:.86, edge:4096, dpi:160},
  balanced: {quality:.70, edge:2560, dpi:120},
  strong: {quality:.48, edge:1600, dpi:85},
};
function checkAbort(signal) { if (signal?.aborted) throw new DOMException('Обработка отменена','AbortError'); }
function abortable(promise,signal) {
  checkAbort(signal);
  if(!signal) return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Обработка отменена','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
function toBlob(canvas,type,quality) {
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Браузер не смог обработать изображение.')),type,quality));
}
function makeResult(file,blob,filename,note,kind) {
  const changed = blob.size < file.size;
  if (!changed) {blob=file;filename=file.name;note='Файл уже оптимизирован: сохранён оригинал без увеличения размера.';}
  return {blob,filename:uniqueFilename(filename),originalSize:file.size,outputSize:blob.size,savedPercent:Math.max(0,Math.round((1-blob.size/file.size)*100)),changed,note,kind};
}
// Inspect dimensions before image decoding to bound canvas and bitmap allocation.
export function inspectImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (a,b)=>String.fromCharCode(...bytes.subarray(a,b));
  if (bytes.length>=24 && bytes[0]===137 && ascii(1,4)==='PNG') {
    for (let p=8;p+12<=bytes.length;) {
      const length=view.getUint32(p),tag=ascii(p+4,p+8);
      if (tag==='acTL') throw new Error('Анимированные PNG не поддерживаются. Выберите статичную фотографию.');
      if (tag==='IDAT') break;
      p+=12+length;
    }
    return {type:'image/png',width:view.getUint32(16),height:view.getUint32(20)};
  }
  if (bytes.length>=12 && bytes[0]===255 && bytes[1]===216) {
    let p=2;
    while (p+4<bytes.length) {
      if(bytes[p++]!==255) continue;
      while(bytes[p]===255) p++;
      const marker=bytes[p++];
      if(marker===0xD9||marker===0xDA) break;
      if(marker===0x01||(marker>=0xD0&&marker<=0xD8)) continue;
      if(p+2>bytes.length) break;
      const length=view.getUint16(p);
      if(length<2||p+length>bytes.length) break;
      if([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)&&length>=7) return {type:'image/jpeg',width:view.getUint16(p+5),height:view.getUint16(p+3)};
      p+=length;
    }
  }
  if(bytes.length>=30 && ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP') {
    const chunk=ascii(12,16);
    const uint24=p=>bytes[p]+bytes[p+1]*256+bytes[p+2]*65536;
    if(chunk==='VP8X') {
      if(bytes[20]&2) throw new Error('Анимированные WebP не поддерживаются. Выберите статичную фотографию.');
      return {type:'image/webp',width:1+uint24(24),height:1+uint24(27)};
    }
    if(chunk==='VP8 ') return {type:'image/webp',width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    if(chunk==='VP8L') return {type:'image/webp',width:1+(((bytes[22]&63)<<8)|bytes[21]),height:1+(((bytes[24]&15)<<10)|(bytes[23]<<2)|(bytes[22]>>6))};
  }
  throw new Error('Не удалось прочитать фотографию. Поддерживаются статичные JPG, PNG и WebP.');
}
async function compressImage(file,bytes,options,onProgress,signal) {
  const meta=inspectImage(bytes);
  if(!meta.width||!meta.height||meta.width*meta.height>32_000_000) throw new Error('Фотография слишком большая: допустимо до 32 мегапикселей.');
  checkAbort(signal);
  const bitmap=await createImageBitmap(new Blob([bytes],{type:meta.type}),{imageOrientation:'from-image'});
  let canvas;
  try {
    checkAbort(signal);
    const preset=presets[options.level];
    const scale=Math.min(1,preset.edge/Math.max(bitmap.width,bitmap.height));
    canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const type=options.imageFormat==='jpeg'?'image/jpeg':options.imageFormat==='webp'?'image/webp':meta.type==='image/jpeg'?'image/jpeg':'image/webp';
    const ctx=canvas.getContext('2d');
    if(!ctx) throw new Error('Браузер не поддерживает обработку изображений.');
    if(type==='image/jpeg') {ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    onProgress(60,'Сжимаем фотографию');await yieldFrame();checkAbort(signal);
    const blob=await toBlob(canvas,type,preset.quality);checkAbort(signal);
    if(blob.type!==type) throw new Error('Этот браузер не умеет сохранять выбранный формат. Попробуйте JPG.');
    const filename=file.name.replace(/\.[^.]+$/,'')+'-сжато.'+(type==='image/jpeg'?'jpg':'webp');
    const note=`${canvas.width} × ${canvas.height} пикс. Метаданные EXIF удалены.${type==='image/jpeg'&&meta.type!=='image/jpeg'?' Прозрачность заменена белым фоном.':''}`;
    return makeResult(file,blob,filename,note,'image');
  } finally {bitmap.close();if(canvas)canvas.width=canvas.height=0;}
}
async function optimizePdfImages(doc,options,onProgress,signal) {
  const name=PDFName.of;
  let changed=0;
  const images=doc.context.enumerateIndirectObjects().filter(([,obj])=>
    obj instanceof PDFRawStream && obj.dict.get(name('Subtype'))===name('Image') &&
    obj.dict.get(name('Filter'))===name('DCTDecode') &&
    [name('DeviceRGB'),name('DeviceGray')].includes(obj.dict.get(name('ColorSpace'))) &&
    !['SMask','Mask','Decode','DecodeParms'].some(key=>obj.dict.has(name(key)))
  );
  for(let i=0;i<images.length;i++) {
    checkAbort(signal);onProgress(10+Math.round(i/images.length*75),`Изображение ${i+1} из ${images.length}`);await yieldFrame();
    const [ref,stream]=images[i],bytes=stream.getContents();
    let bitmap,canvas;
    try {
      const meta=inspectImage(bytes);
      if(meta.width*meta.height>32_000_000) continue;
      bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}),{imageOrientation:'none'});
      checkAbort(signal);
      const preset=presets[options.level],scale=Math.min(1,preset.edge/Math.max(bitmap.width,bitmap.height));
      canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const compressed=await toBlob(canvas,'image/jpeg',preset.quality);checkAbort(signal);
      if(compressed.size>=bytes.length) continue;
      const dictionary=stream.dict.clone(doc.context);
      dictionary.set(name('Width'),PDFNumber.of(canvas.width));dictionary.set(name('Height'),PDFNumber.of(canvas.height));
      dictionary.set(name('ColorSpace'),name('DeviceRGB'));dictionary.set(name('BitsPerComponent'),PDFNumber.of(8));
      doc.context.assign(ref,PDFRawStream.of(dictionary,new Uint8Array(await compressed.arrayBuffer())));
      changed++;
    } catch(error) {
      checkAbort(signal);
      // Unusual image encodings stay untouched. Text and other document objects remain intact.
    } finally {bitmap?.close();if(canvas)canvas.width=canvas.height=0;}
  }
  return changed;
}
let pdfjsPromise;
export async function getPdfJs() {
  pdfjsPromise??=Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs,worker])=>{pdfjs.GlobalWorkerOptions.workerSrc=worker.default;return pdfjs;}).catch(error=>{pdfjsPromise=undefined;throw error;});
  return pdfjsPromise;
}
async function rasterPdf(file,bytes,options,onProgress,signal) {
  const original=await loadPdf(bytes); // validate signatures and encryption before rendering
  if(original.getPageCount()>150) throw new Error('Для сжатия страниц в изображения допустимо до 150 страниц. Выберите режим сохранения текста.');
  const pdfjs=await getPdfJs();checkAbort(signal);
  const base=import.meta.env.BASE_URL;
  const loading=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true,cMapUrl:base+'pdf-cmaps/',cMapPacked:true,standardFontDataUrl:base+'pdf-fonts/',wasmUrl:base+'pdf-wasm/'});
  const cancel=()=>{void loading.destroy();};signal?.addEventListener('abort',cancel,{once:true});
  let canvas;
  try {
    const doc=await abortable(loading.promise,signal);checkAbort(signal);
    if(!doc.numPages) throw new Error('В PDF нет страниц.');
    const output=await PDFDocument.create();
    for(let i=1;i<=doc.numPages;i++) {
      checkAbort(signal);onProgress(8+Math.round((i-1)/doc.numPages*85),`Страница ${i} из ${doc.numPages}`);await yieldFrame();
      checkAbort(signal);
      const page=await abortable(doc.getPage(i),signal);checkAbort(signal);
      const base=page.getViewport({scale:1}),preset=presets[options.level];
      const scale=Math.min(preset.dpi/72,4096/Math.max(base.width,base.height),Math.sqrt(12_000_000/(base.width*base.height)));
      const viewport=page.getViewport({scale});
      canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const context=canvas.getContext('2d');
      const render=page.render({canvasContext:context,canvas,viewport,background:'#ffffff'});
      const cancelRender=()=>render.cancel();signal?.addEventListener('abort',cancelRender,{once:true});
      try {await render.promise;}finally{signal?.removeEventListener('abort',cancelRender);}
      checkAbort(signal);
      const jpg=await toBlob(canvas,'image/jpeg',preset.quality);checkAbort(signal);
      const image=await output.embedJpg(await jpg.arrayBuffer());
      const next=output.addPage([base.width,base.height]);next.drawImage(image,{x:0,y:0,width:base.width,height:base.height});
      canvas.width=canvas.height=0;page.cleanup();
    }
    const out=await output.save({useObjectStreams:true});checkAbort(signal);
    return makeResult(file,new Blob([out],{type:'application/pdf'}),file.name.replace(/\.pdf$/i,'-сжато.pdf'),'Страницы сохранены как изображения. Поиск, выделение текста, ссылки и формы недоступны.','pdf');
  } catch(error) {
    checkAbort(signal);
    if(error.name==='PasswordException') throw new Error('PDF защищён паролем. Сначала сохраните копию без защиты.');
    throw error;
  } finally {signal?.removeEventListener('abort',cancel);if(canvas)canvas.width=canvas.height=0;await loading.destroy();}
}
export async function compressFile(file,options={},onProgress=()=>{},signal) {
  const error=validateFile(file);if(error)throw new Error(error);
  const settings={level:'balanced',pdfMode:'raster',imageFormat:'auto',...options};
  if(!presets[settings.level]||!['preserve','raster'].includes(settings.pdfMode)||!['auto','jpeg','webp'].includes(settings.imageFormat)) throw new Error('Выберите допустимые настройки сжатия.');
  checkAbort(signal);onProgress(2,'Читаем файл');
  if (/\.(zip|rar)$/i.test(file.name)) {
    const {recompressArchive}=await import('./archive-client.js');
    checkAbort(signal);
    return recompressArchive(file,settings,onProgress,signal);
  }
  const bytes=new Uint8Array(await file.arrayBuffer());checkAbort(signal);await yieldFrame();
  let result;
  if(/\.pdf$/i.test(file.name)) {
    if(settings.pdfMode==='raster') result=await rasterPdf(file,bytes,settings,onProgress,signal);
    else {
      onProgress(5,'Оптимизируем PDF');await yieldFrame();let imageCount=0;
      const out=await compressPdfPreserve(bytes,async doc=>{imageCount=await optimizePdfImages(doc,settings,onProgress,signal);});checkAbort(signal);
      const note=imageCount?'Текст, ссылки и формы сохранены. JPEG-изображения сжаты с выбранным качеством.':'Текст, ссылки и формы сохранены. Оптимизирована структура PDF.';
      result=makeResult(file,new Blob([out],{type:'application/pdf'}),file.name.replace(/\.pdf$/i,'-сжато.pdf'),note,'pdf');
    }
  } else result=await compressImage(file,bytes,settings,onProgress,signal);
  checkAbort(signal);onProgress(100,'Готово');return result;
}
