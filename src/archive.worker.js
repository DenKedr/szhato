import {BlobReader,BlobWriter,ZipReader,ZipWriter,configure} from '@zip.js/zip.js';
import zipWasmUrl from '@zip.js/zip.js/dist/zip-module.wasm?url';
import {ArchiveBudget,validateMemberPath,preflightRar} from './archive-policy.js';

configure({useWebWorkers:false,useCompressionStream:false,wasmURI:zipWasmUrl,maxWorkers:1});
const levels={gentle:1,balanced:6,strong:9};
const progress=(percent,message)=>self.postMessage({type:'progress',percent,message});
const fail=message=>{throw new Error(message);};
let pendingTransform=null,requestId=0,archiveMode='repack';
let optimizedEntries=0,unchangedEntries=0,skippedEntries=0;
async function transformMember(blob,name,index,total){
 if(archiveMode!=='optimize'||!/\.(pdf|jpe?g|png|webp)$/i.test(name))return blob;
 const id=++requestId;
 const result=await new Promise(resolve=>{
  pendingTransform={id,resolve};
  self.postMessage({type:'transform',id,blob,name,percent:10+index/Math.max(1,total)*80,span:80/Math.max(1,total)});
 });
 if(!(result.blob instanceof Blob)||result.blob.size>blob.size)fail('Неверный размер обработанной записи архива.');
 if(result.skipped)skippedEntries++;else if(result.blob.size<blob.size)optimizedEntries++;else unchangedEntries++;
 return result.blob;
}
function assertRegularZip(entry){
 const attributes=entry.externalFileAttributes>>>0,mode=(attributes>>>16)&0xffff,type=mode&0xf000;
 if(entry.encrypted)fail('ZIP защищён паролем. Выберите копию без шифрования.');
 if(entry.diskNumberStart)fail('Многотомные ZIP не поддерживаются.');
 if(entry.symlink||(type&&type!==0x8000&&type!==0x4000)||(attributes&0x400))fail('ZIP содержит ссылки или специальные типы файлов.');
 if(type===0x4000&&!entry.directory||type===0x8000&&entry.directory)fail('Неоднозначный тип записи ZIP.');
}
async function readBounded(entry,budget,name){
 const chunks=[];
 const writable=new WritableStream({write(chunk){budget.actual(name,chunk.byteLength);chunks.push(chunk.slice());}});
 await entry.getData(writable,{checkSignature:true,checkOverlappingEntry:true,checkZipCryptoPassword:true});
 budget.finish(name);
 return new Blob(chunks,{type:'application/octet-stream'});
}
function regularOptions(directory){return {directory,unixMode:directory?0o40755:0o100644,msdosAttributesRaw:directory?0x10:0,extendedTimestamp:false};}
async function rezip(file,writer,level){
 const reader=new ZipReader(new BlobReader(file),{strictness:'strict',filenameValidation:'strict',checkSignature:true,checkOverlappingEntry:true});
 const entries=[],budget=new ArchiveBudget(file.size);
 try{
  for await(const entry of reader.getEntriesGenerator()){
   assertRegularZip(entry);
   const name=budget.add({name:entry.filename,size:entry.uncompressedSize,packed:entry.compressedSize,directory:entry.directory});
   entries.push({entry,name});
  }
  for(let index=0;index<entries.length;index++){
   const {entry,name}=entries[index];progress(10+Math.round(index/Math.max(1,entries.length)*80),`Перепаковка записи ${index+1} из ${entries.length}`);
   if(entry.directory)await writer.add(name+'/',undefined,{...regularOptions(true),level});
   else{
    const blob=await transformMember(await readBounded(entry,budget,name),name,index,entries.length);
    await writer.add(name,new BlobReader(blob),{...regularOptions(false),level});
   }
  }
  return entries.length;
 }finally{await reader.close();}
}
async function rerar(file,writer,level){
 const bytes=new Uint8Array(await file.arrayBuffer());
 const raw=preflightRar(bytes);progress(5,'Проверяем структуру RAR');
 const [{createExtractorFromData},wasm]=await Promise.all([import('node-unrar-js/esm/index.esm.js'),import('node-unrar-js/esm/js/unrar.wasm?url')]);
 const response=await fetch(wasm.default);if(!response.ok)fail('Не удалось загрузить обработчик RAR.');
 const extractor=await createExtractorFromData({data:bytes.buffer,wasmBinary:await response.arrayBuffer()});
 const listing=extractor.getFileList(),budget=new ArchiveBudget(file.size);const entries=[];
 if(listing.arcHeader.flags.volume||listing.arcHeader.flags.headerEncrypted)fail('Многотомные и зашифрованные RAR не поддерживаются.');
 for(const header of listing.fileHeaders){
  const name=budget.add({name:header.name,size:header.unpSize,packed:header.packSize,directory:header.flags.directory,encrypted:header.flags.encrypted});
  entries.push({name,original:header.name,size:header.unpSize,directory:header.flags.directory});
 }
 if(entries.length!==raw.budget.entries.size||budget.total!==raw.budget.total)fail('RAR содержит неоднозначные заголовки файлов.');
 // All write callbacks run through this check BEFORE UnRAR copies bytes into JS
 // buffers. Checking extraction.length afterwards would not bound allocations.
 const originalCreate=extractor.create.bind(extractor),originalWrite=extractor.write.bind(extractor),fdNames=new Map();
 extractor.create=filename=>{
  const name=validateMemberPath(filename);if(!budget.entries.has(name.toLowerCase()))fail('RAR пытается создать необъявленную запись.');
  const fd=originalCreate(filename);fdNames.set(fd,name);return fd;
 };
 extractor.write=(fd,pointer,size)=>{
  const name=fdNames.get(fd);if(!name)fail('RAR записывает неизвестную запись.');budget.actual(name,size);
  return originalWrite(fd,pointer,size);
 };
 let index=0;
 const extracted=extractor.extract();
 for(const member of extracted.files){
  const expected=entries[index];if(!expected||member.fileHeader.name!==expected.original||member.fileHeader.unpSize!==expected.size||member.fileHeader.flags.directory!==expected.directory)fail('Заголовки RAR изменились при распаковке.');
  progress(10+Math.round(index/Math.max(1,entries.length)*80),`Перепаковка записи ${index+1} из ${entries.length}`);
  if(expected.directory)await writer.add(expected.name+'/',undefined,{...regularOptions(true),level});
  else{
   const data=member.extraction;budget.finish(expected.name);if(!data||data.byteLength!==expected.size)fail('Неверный размер распакованной записи RAR.');
   const blob=await transformMember(new Blob([data],{type:'application/octet-stream'}),expected.name,index,entries.length);
   await writer.add(expected.name,new BlobReader(blob),{...regularOptions(false),level});
   // Drop the extracted backing buffers after each file. The worker is also
   // terminated by the client on success, errors, cancellation and timeout.
   const key=extractor.getExtractedFileName(expected.original),stored=extractor.dataFiles[key];
   if(stored){for(const [fd,name]of fdNames)if(name===expected.name){delete extractor.dataFileMap[fd];fdNames.delete(fd);}}delete extractor.dataFiles[key];
   member.extraction=null;
  }
  index++;
 }
 if(index!==entries.length)fail('RAR содержит неполные данные.');
 return index;
}
self.onmessage=async({data})=>{
 if(data.type==='transformed'){
  if(!pendingTransform||data.id!==pendingTransform.id)return;
  const {resolve}=pendingTransform;pendingTransform=null;resolve(data);return;
 }
 const {file,level}=data;
 try{
  archiveMode=data.archiveMode??'repack';
  if(!['optimize','repack'].includes(archiveMode))fail('Неизвестный способ обработки архива.');
  progress(1,'Проверяем архив');
  const signature=new Uint8Array(await file.slice(0,8).arrayBuffer());
  const isZip=signature[0]===80&&signature[1]===75&&((signature[2]===3&&signature[3]===4)||(signature[2]===5&&signature[3]===6));
  const isRar=signature[0]===82&&signature[1]===97&&signature[2]===114&&signature[3]===33;
  if(!levels[level])fail('Неизвестный уровень сжатия.');
  if(!isZip&&!isRar)fail('Файл не является ZIP или RAR. Самораспаковывающиеся архивы не поддерживаются.');
  if((/\.zip$/i.test(file.name)&&!isZip)||(/\.rar$/i.test(file.name)&&!isRar))fail('Расширение архива не соответствует его содержимому.');
  const writer=new ZipWriter(new BlobWriter('application/zip'),{level:levels[level],useWebWorkers:false,useCompressionStream:false,bufferedWrite:true});
  const count=isZip?await rezip(file,writer,levels[level]):await rerar(file,writer,levels[level]);
  progress(95,'Собираем ZIP');const blob=await writer.close();
  const changed=blob.size<file.size;
  const contentNote=archiveMode==='optimize'?` Уменьшено PDF/фото: ${optimizedEntries}. Уже оптимизировано: ${unchangedEntries}.${skippedEntries?` Сохранено без обработки: ${skippedEntries} (неподдерживаемые или защищённые документы).`:''}`:'';
  const note=`${count} записей собрано в ZIP (уровень ${levels[level]}).${contentNote} Скрипты и программы не запускались.${changed?'':' Новый ZIP не меньше исходника; уменьшение размера не гарантируется.'}`;
  const filename=(file.name.replace(/[\\/]/g,'_').replace(/\.[^.]+$/,'')||'archive')+(archiveMode==='optimize'?'-сжато.zip':'-перепаковано.zip');
  self.postMessage({type:'result',result:{blob,filename,originalSize:file.size,outputSize:blob.size,savedPercent:Math.max(0,Math.round((1-blob.size/file.size)*100)),changed,note,kind:'archive',optimizedEntries,unchangedEntries,skippedEntries}});
 }catch(error){
  const reason=error?.reason||'';
  const message=/PASSWORD|MISSING_PASSWORD/.test(reason)?'RAR защищён паролем. Выберите копию без шифрования.':reason?'RAR повреждён или использует неподдерживаемый формат.':/unsafe filename/i.test(error?.message||'')?'ZIP содержит небезопасное имя или путь.':error instanceof Error?error.message:'Не удалось перепаковать архив.';
  self.postMessage({type:'error',message});
 }
};
