import {PDFDocument} from 'pdf-lib';
import {zipSync} from 'fflate';
import {ZipReader, BlobReader, Uint8ArrayWriter} from '@zip.js/zip.js';
import {compressFile} from '../src/compression.js';
const report=document.querySelector('#report');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const read=async blob=>{const reader=new ZipReader(new BlobReader(blob));try{const entries={};for await(const e of reader.getEntriesGenerator())entries[e.filename]=e.directory?null:await e.getData(new Uint8ArrayWriter());return entries;}finally{await reader.close();}};
const asBytes=async blob=>new Uint8Array(await blob.arrayBuffer());
const blobOf=(canvas,type,quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
document.querySelector('#run').onclick=async()=>{
 const checks=[]; document.querySelector('#run').disabled=true;
 try{
  const canvas=document.createElement('canvas');canvas.width=2600;canvas.height=1900;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Deterministic fine detail produces a PDF similar to scanned documents.
  for(let i=0;i<30000;i++){ctx.fillStyle=`rgb(${i*31%256},${i*47%256},${i*67%256})`;ctx.fillRect(i*113%2600,i*197%1900,3,3);}
  const jpg=await asBytes(await blobOf(canvas,'image/jpeg',.98));
  const doc=await PDFDocument.create();const image=await doc.embedJpg(jpg);
  doc.addJavaScript('must-not-run','globalThis.archivePayloadRan=true; throw new Error("PDF script must never run");');
  for(let i=0;i<2;i++)doc.addPage([595,435]).drawImage(image,{x:0,y:0,width:595,height:435});
  const pdf=await doc.save();
  canvas.width=2800;canvas.height=1200;ctx.clearRect(0,0,2800,1200);ctx.fillStyle='#ff880080';ctx.fillRect(0,0,2400,1000);
  const png=await asBytes(await blobOf(canvas,'image/png'));canvas.width=canvas.height=0;
  const bytes=new TextEncoder();const script=bytes.encode('globalThis.archivePayloadRan=true; throw new Error("must never run");');
  const signed=new Uint8Array([...pdf,...bytes.encode('\n% /ByteRange [0 1 2 3]\n')]);
  const nested=zipSync({'inner.txt':bytes.encode('opaque nested archive')});
  const files={'папка/скан.pdf':pdf,'photo.jpeg':jpg,'alpha.png':png,'spoof.jpg':png,'signed.pdf':signed,'bad.pdf':bytes.encode('not a pdf'),'payload.js':script,'page.html':bytes.encode('<script>globalThis.archivePayloadRan=true</script>'),'nested.zip':nested};
  const source=new File([zipSync(files,{level:6})],'scanned-documents.zip');
  report.textContent='Сжимаем PDF и фотографии внутри ZIP…';
  const result=await compressFile(source,{level:'strong',pdfMode:'raster',archiveMode:'optimize'});
  const members=await read(result.blob);
  assert(result.outputSize<source.size*.7,`PDF inside ZIP was not reduced enough: ${source.size} → ${result.outputSize}`);
  assert(Object.keys(members).sort().join('|')===Object.keys(files).sort().join('|'),'Member names changed');
  assert((await PDFDocument.load(members['папка/скан.pdf'])).getPageCount()===2,'PDF page count changed');
  for(const name of ['payload.js','page.html','nested.zip','signed.pdf','bad.pdf','spoof.jpg'])assert(equal(members[name],files[name]),`${name}: opaque/skipped bytes changed`);
  assert(members['photo.jpeg'][0]===255&&members['photo.jpeg'][1]===216,'JPEG format changed');
  assert(members['alpha.png'][0]===137&&members['alpha.png'][1]===80,'PNG format changed');
  assert(globalThis.archivePayloadRan!==true,'Archive script executed');
  assert(result.optimizedEntries>=2&&result.skippedEntries===3,'Missing optimization/skip summary');
  checks.push({test:'optimize',ok:true,before:source.size,after:result.outputSize,optimized:result.optimizedEntries,skipped:result.skippedEntries});
  const repack=await compressFile(source,{level:'strong',archiveMode:'repack'});const originalMembers=await read(repack.blob);
  for(const name of Object.keys(files))assert(equal(originalMembers[name],files[name]),`Repack changed ${name}`);
  checks.push({test:'repack preserves every member',ok:true});
  const controller=new AbortController();let didAbort=false;
  try{await compressFile(source,{archiveMode:'optimize'},(p,message)=>{if(message.startsWith('Внутри архива: Страница'))controller.abort();},controller.signal);}catch(e){didAbort=e.name==='AbortError';}
  assert(didAbort,'Content compression did not honor cancellation');checks.push({test:'abort during content optimization',ok:true});
  for(const name of ['traversal.zip','duplicate.zip','bomb.zip','symlink.zip','encrypted.zip','test_read_format_rar5_symlink.rar','HeaderEnc1234.rar']){
   const response=await fetch('./fixtures/'+name);assert(response.ok,'Fixture missing: '+name);let rejected=false;
   try{await compressFile(new File([await response.blob()],name),{archiveMode:'optimize'});}catch{rejected=true;}
   assert(rejected,'Unsafe archive accepted: '+name);
  }
  checks.push({test:'unsafe ZIP/RAR blocked',ok:true});
  for(const name of ['FolderTest.rar','test_read_format_rar5_compressed.rar']){
   const response=await fetch('./fixtures/'+name);assert(response.ok,'Fixture missing: '+name);const r=await compressFile(new File([await response.blob()],name),{archiveMode:'optimize'});assert((await read(r.blob))&&r.kind==='archive','RAR failed: '+name);
  }
  checks.push({test:'RAR4/5 still work',ok:true});
  report.textContent=JSON.stringify({ok:true,checks},null,2);report.dataset.status='pass';
 }catch(error){report.textContent=JSON.stringify({ok:false,error:error.message,checks},null,2);report.dataset.status='fail';}
 finally{document.querySelector('#run').disabled=false;}
};
