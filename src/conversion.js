import {PDFDocument} from 'pdf-lib';
import {BlobReader,BlobWriter,ZipWriter} from '@zip.js/zip.js';
import {getPdfJs,inspectImage} from './compression.js';
import {MAX_FILE_BYTES} from './file-utils.js';

const formats={jpeg:{mime:'image/jpeg',ext:'jpg',label:'JPEG'},png:{mime:'image/png',ext:'png',label:'PNG'},webp:{mime:'image/webp',ext:'webp',label:'WebP'}};
const qualities={gentle:.92,balanced:.85,strong:.70};
const pdfScales={gentle:3,balanced:2,strong:4/3};
const MAX_OUTPUT_BYTES=512*1024*1024;
const MAX_ZIP_OVERHEAD=1024*1024;
const fail=message=>{throw new Error(message);};
const cancelled=()=>new DOMException('Конвертация отменена','AbortError');
function checkAbort(signal){if(signal?.aborted)throw cancelled();}
function controlled(promise,signal){
 checkAbort(signal);
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
const nextTask=()=>new Promise(resolve=>setTimeout(resolve,0));
function stemOf(name){return name.split(/[\\/]/).pop().replace(/\.[^.]+$/,'').replace(/[\x00-\x1f<>:"|?*]/g,'_').replace(/^\.+|[ .]+$/g,'')||'document';}
function result(file,blob,filename,note,kind){
 if(blob.size>MAX_OUTPUT_BYTES+MAX_ZIP_OVERHEAD)fail('Результат конвертации превышает 512 МБ. Конвертируйте меньший файл.');
 const changed=blob.size<file.size;
 return{blob,filename,originalSize:file.size,outputSize:blob.size,savedPercent:Math.max(0,Math.round((1-blob.size/file.size)*100)),changed,note:note+(changed?'':' Целевой формат сохранён, даже если результат не меньше исходника.'),kind};
}
export function validateConversionFile(file,format){
 if(!file||typeof file.name!=='string'||!Number.isFinite(file.size))return 'Выберите файл для конвертации.';
 if(!/\.(pdf|jpe?g|png|webp)$/i.test(file.name))return 'Для конвертации поддерживаются PDF, JPG, PNG и WebP.';
 if(!file.size)return 'Файл пуст. Выберите другой файл.';
 if(file.size>MAX_FILE_BYTES)return 'Максимальный размер файла — 500 МБ.';
 if(![...Object.keys(formats),'pdf'].includes(format))return 'Выберите целевой формат конвертации.';
 if(format==='pdf'&&/\.pdf$/i.test(file.name))return 'Для PDF выберите JPEG, PNG или WebP.';
 return null;
}
function encode(canvas,type,quality,signal){
 checkAbort(signal);
 return controlled(new Promise((resolve,reject)=>canvas.toBlob(blob=>{
  if(!blob){reject(new Error('Браузер не смог сохранить изображение.'));return;}
  if(blob.type!==type){reject(new Error('Браузер не поддерживает выбранный формат. Попробуйте PNG или JPEG.'));return;}
  resolve(blob);
 },type,quality)),signal);
}
function imageDimensions(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>32_000_000||Math.max(width,height)>16384)fail('Изображение слишком большое: допустимо до 32 мегапикселей и 16 384 пикселей по стороне.');
}
async function imageConversion(file,bytes,options,onProgress,signal){
 const meta=inspectImage(bytes);imageDimensions(meta.width,meta.height);
 const expected=/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.png$/i.test(file.name)?'image/png':'image/webp';
 if(meta.type!==expected)fail('Расширение изображения не соответствует его содержимому.');
 checkAbort(signal);onProgress(15,'Читаем изображение');
 const pending=createImageBitmap(file,{imageOrientation:'from-image'}).then(bitmap=>{if(signal?.aborted){bitmap.close();throw cancelled();}return bitmap;});
 const bitmap=await controlled(pending,signal);
 let canvas;
 try{
  checkAbort(signal);imageDimensions(bitmap.width,bitmap.height);
  canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d');if(!context)fail('Браузер не поддерживает конвертацию изображений.');
  const target=options.format==='pdf'?(meta.type==='image/jpeg'?'image/jpeg':'image/png'):formats[options.format].mime;
  if(target==='image/jpeg'){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}
  context.drawImage(bitmap,0,0);onProgress(45,'Сохраняем целевой формат');await nextTask();checkAbort(signal);
  const blob=await encode(canvas,target,qualities[options.level],signal);checkAbort(signal);
  const dimensions=`${bitmap.width} × ${bitmap.height} пикс.`;
  if(options.format!=='pdf')return result(file,blob,`${stemOf(file.name)}.${formats[options.format].ext}`,`${dimensions} ${formats[options.format].label}. Метаданные EXIF удалены.${target==='image/jpeg'&&meta.type!=='image/jpeg'?' Прозрачность заменена белым фоном.':''}`,'image');
  onProgress(70,'Создаём PDF');await nextTask();checkAbort(signal);
  const pdfDocument=await PDFDocument.create(),data=await controlled(blob.arrayBuffer(),signal);
  const image=target==='image/jpeg'?await controlled(pdfDocument.embedJpg(data),signal):await controlled(pdfDocument.embedPng(data),signal);
  checkAbort(signal);const pageScale=Math.min(.75,14400/Math.max(bitmap.width,bitmap.height));
  const width=bitmap.width*pageScale,height=bitmap.height*pageScale;
  pdfDocument.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
  const output=await controlled(pdfDocument.save({useObjectStreams:true}),signal);checkAbort(signal);
  return result(file,new Blob([output],{type:'application/pdf'}),`${stemOf(file.name)}.pdf`,`${dimensions} Одна страница PDF с сохранением пропорций, масштаб 96 dpi (сторона до 14 400 pt). EXIF удалён.`,'pdf');
 }finally{bitmap.close();if(canvas)canvas.width=canvas.height=0;}
}
async function pdfConversion(file,bytes,options,onProgress,signal){
 if(!new TextDecoder('latin1').decode(bytes.subarray(0,1024)).includes('%PDF-'))fail('Файл не является PDF или повреждён.');
 const pdfjs=await controlled(getPdfJs(),signal);checkAbort(signal);
 const base=import.meta.env.BASE_URL;
 const loading=pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,cMapUrl:base+'pdf-cmaps/',cMapPacked:true,standardFontDataUrl:base+'pdf-fonts/',wasmUrl:base+'pdf-wasm/'});
 let destroyPromise;
 const destroy=()=>destroyPromise??=Promise.resolve(loading.destroy()).catch(()=>{});
 const abort=()=>{void destroy();};signal?.addEventListener('abort',abort,{once:true});
 let canvas,zipWriter,zipClosePromise;
 const closeZip=()=>zipClosePromise??=zipWriter.close();
 try{
  const doc=await controlled(loading.promise,signal);checkAbort(signal);
  if(!doc.numPages)fail('В PDF нет страниц.');
  if(doc.numPages>150)fail('Для конвертации PDF допустимо до 150 страниц. Сначала разделите документ.');
  const format=formats[options.format],many=doc.numPages>1;
  if(many)zipWriter=new ZipWriter(new BlobWriter('application/zip'),{level:0,useWebWorkers:false,useCompressionStream:false});
  let outputBytes=0,single;
  for(let index=1;index<=doc.numPages;index++){
   checkAbort(signal);onProgress(5+Math.floor((index-1)/doc.numPages*90),`Страница ${index} из ${doc.numPages}`);await nextTask();checkAbort(signal);
   const page=await controlled(doc.getPage(index),signal);checkAbort(signal);
   try{
    const original=page.getViewport({scale:1});
    if(!Number.isFinite(original.width)||!Number.isFinite(original.height)||original.width<=0||original.height<=0)fail('Некорректный размер страницы PDF.');
    // Reserve a small rounding margin so ceil() captures the complete page
    // without crossing the 12 MP / 4096 px canvas bounds.
    const scale=Math.min(pdfScales[options.level],4096/Math.max(original.width,original.height),Math.sqrt(11_990_000/(original.width*original.height)));
    const viewport=page.getViewport({scale});
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.min(4096,Math.round(viewport.width)));canvas.height=Math.max(1,Math.min(4096,Math.round(viewport.height)));
    const context=canvas.getContext('2d');if(!context)fail('Браузер не поддерживает конвертацию PDF.');
    const render=page.render({canvasContext:context,canvas,viewport,transform:[canvas.width/viewport.width,0,0,canvas.height/viewport.height,0,0],background:'#ffffff'});
    const cancelRender=()=>render.cancel();signal?.addEventListener('abort',cancelRender,{once:true});
    try{await controlled(render.promise,signal);}finally{signal?.removeEventListener('abort',cancelRender);}
    checkAbort(signal);let image=await encode(canvas,format.mime,qualities[options.level],signal);checkAbort(signal);
    outputBytes+=image.size;if(outputBytes>MAX_OUTPUT_BYTES)fail('Изображения из PDF превышают 512 МБ. Сначала разделите документ.');
    if(many)await controlled(zipWriter.add(`page-${String(index).padStart(3,'0')}.${format.ext}`,new BlobReader(image),{level:0,useWebWorkers:false,signal}),signal);
    else single=image;
    image=null;
   }finally{if(canvas)canvas.width=canvas.height=0;page.cleanup();}
  }
  checkAbort(signal);onProgress(97,many?'Собираем ZIP':'Сохраняем изображение');
  const output=many?await controlled(closeZip(),signal):single;checkAbort(signal);
  return result(file,output,many?`${stemOf(file.name)}-${format.ext}.zip`:`${stemOf(file.name)}.${format.ext}`,`${doc.numPages} ${doc.numPages===1?'страница сохранена':'страниц сохранено'} в ${format.label}${many?' внутри ZIP':''}. Изображения имеют белый фон; интерактивность PDF и проверяемая цифровая подпись не переносятся.`,many?'archive':'image');
 }catch(error){
  checkAbort(signal);
  if(error?.name==='PasswordException')fail('PDF защищён паролем. Сначала сохраните копию без защиты.');
  if(error?.name==='InvalidPDFException'||error?.name==='MissingPDFException')fail('Не удалось прочитать PDF. Возможно, файл повреждён.');
  throw error;
 }finally{
  signal?.removeEventListener('abort',abort);if(canvas)canvas.width=canvas.height=0;
  // Do not block cancellation forever on an already-destroyed PDF worker.
  const bounded=async promise=>{let timer;try{await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}};
  await Promise.all([bounded(destroy()),zipWriter?bounded(Promise.resolve().then(closeZip).catch(()=>{})):Promise.resolve()]);
 }
}
export async function convertFile(file,options={},onProgress=()=>{},signal){
 checkAbort(signal);const settings={format:'jpeg',level:'balanced',...options};
 const error=validateConversionFile(file,settings.format);if(error)fail(error);
 if(!Object.hasOwn(qualities,settings.level))fail('Выберите допустимый уровень качества.');
 onProgress(1,'Подготавливаем файл');await nextTask();checkAbort(signal);
 const bytes=new Uint8Array(await controlled(file.arrayBuffer(),signal));checkAbort(signal);
 const output=/\.pdf$/i.test(file.name)?await pdfConversion(file,bytes,settings,onProgress,signal):await imageConversion(file,bytes,settings,onProgress,signal);
 checkAbort(signal);onProgress(100,'Конвертация завершена');return output;
}
