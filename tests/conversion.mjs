import {chromium}from'playwright';
import assert from'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5173/tests/conversion-harness.html');await page.waitForFunction(()=>!!window.conversionTest);
 const report=await page.evaluate(async()=>{
  const {conversion:{convertFile},pdf:{PDFDocument,PDFName,PDFHexString},zip}=window.conversionTest;
  globalThis.conversionPdfExecuted=false;
  const doc=await PDFDocument.create();doc.addPage([600,400]).drawText('First page');doc.addPage([300,500]).drawText('Second page');doc.addJavaScript('unused','globalThis.conversionPdfExecuted=true');
  const sig=doc.context.register(doc.context.obj({Type:'Sig',Filter:'Adobe.PPKLite',SubFilter:'adbe.pkcs7.detached',ByteRange:[0,1,2,3],Contents:PDFHexString.of('00000000')}));doc.catalog.set(PDFName.of('ConversionTestSignature'),sig);
  const source=new File([await doc.save({useObjectStreams:false})],'signed-report.pdf',{type:'application/pdf'});
  const dimensions=async blob=>{const bitmap=await createImageBitmap(blob);try{return[bitmap.width,bitmap.height];}finally{bitmap.close();}};
  const pdfOutputs={};
  for(const format of ['jpeg','png','webp']){
   const result=await convertFile(source,{format,level:'balanced'}),reader=new zip.ZipReader(new zip.BlobReader(result.blob),{useWebWorkers:false});
   const entries=[];try{for await(const entry of reader.getEntriesGenerator()){const blob=await entry.getData(new zip.BlobWriter());entries.push({name:entry.filename,size:blob.size,dimensions:await dimensions(blob)});}}finally{await reader.close();}
   pdfOutputs[format]={mime:result.blob.type,filename:result.filename,kind:result.kind,entries};
  }
  const single=await PDFDocument.create();single.addPage([123,234]).drawText('one');
  const singleResult=await convertFile(new File([await single.save()],'one.pdf'),{format:'jpeg'});
  const square=await PDFDocument.create();square.addPage([100,100]);const squareFile=new File([await square.save()],'square.pdf');
  const dpi={};for(const level of ['gentle','balanced','strong'])dpi[level]=await dimensions((await convertFile(squareFile,{format:'png',level})).blob);
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(32,0,32,32);
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const pngFile=new File([png],'transparent.png',{type:'image/png'});
  const converted={};
  for(const format of ['jpeg','png','webp']){
   const out=await convertFile(pngFile,{format}),bitmap=await createImageBitmap(out.blob),tmp=document.createElement('canvas');tmp.width=bitmap.width;tmp.height=bitmap.height;const ctx=tmp.getContext('2d');ctx.drawImage(bitmap,0,0);converted[format]={mime:out.blob.type,name:out.filename,pixel:Array.from(ctx.getImageData(0,0,1,1).data),dimensions:[bitmap.width,bitmap.height],outputLarger:out.outputSize>out.originalSize};bitmap.close();
  }
  const imagePdf=await convertFile(pngFile,{format:'pdf'});const read=await PDFDocument.load(await imagePdf.blob.arrayBuffer());
  const protectedDoc=await PDFDocument.create();protectedDoc.addPage([100,100]);protectedDoc.context.trailerInfo.Encrypt=protectedDoc.context.register(protectedDoc.context.obj({Filter:'Standard',V:1,R:2,Length:40,O:PDFHexString.of('00'.repeat(32)),U:PDFHexString.of('00'.repeat(32)),P:-4}));protectedDoc.context.trailerInfo.ID=protectedDoc.context.obj([PDFHexString.of('00'.repeat(16)),PDFHexString.of('00'.repeat(16))]);
  const errors={};for(const[name,file,format]of[
   ['bad',new File(['not pdf'],'broken.pdf'),'png'],['renamed',new File([png],'wrong.jpg'),'png'],['password',new File([await protectedDoc.save({useObjectStreams:false})],'protected.pdf'),'jpeg'],['pdfToPdf',source,'pdf'],['archive',new File(['PK'],'test.zip'),'png']
  ]){try{await convertFile(file,{format});errors[name]='UNEXPECTED SUCCESS';}catch(error){errors[name]=error.message;}}
  const stopped=new AbortController();stopped.abort();let earlyAbort=false;try{await convertFile(source,{format:'png'},()=>{},stopped.signal);}catch(error){earlyAbort=error.name==='AbortError';}
  const during=new AbortController();let pageAbort=false;const start=performance.now();try{await convertFile(source,{format:'png'},(_,message)=>{if(message.startsWith('Страница'))during.abort();},during.signal);}catch(error){pageAbort=error.name==='AbortError';}
  const many=await PDFDocument.create();for(let i=0;i<151;i++)many.addPage([10,10]);let pageLimit=false;try{await convertFile(new File([await many.save()],'many.pdf'),{format:'png'});}catch(error){pageLimit=/150/.test(error.message);}
  return{pdfOutputs,dpi,single:{mime:singleResult.blob.type,filename:singleResult.filename,kind:singleResult.kind,dimensions:await dimensions(singleResult.blob)},converted,imagePdf:{mime:imagePdf.blob.type,name:imagePdf.filename,page:read.getPage(0).getSize(),pages:read.getPageCount()},errors,earlyAbort,pageAbort,abortMs:performance.now()-start,pageLimit,pdfScriptExecuted:globalThis.conversionPdfExecuted};
 });
 console.log(JSON.stringify(report,null,2));
 for(const format of ['jpeg','png','webp']){const output=report.pdfOutputs[format];assert.equal(output.mime,'application/zip');assert.equal(output.kind,'archive');assert.equal(output.entries.length,2);assert.deepEqual(output.entries.map(e=>e.dimensions),[[1200,800],[600,1000]]);assert.deepEqual(output.entries.map(e=>e.name),[`page-001.${format==='jpeg'?'jpg':format}`,`page-002.${format==='jpeg'?'jpg':format}`]);}
 assert.equal(report.single.mime,'image/jpeg');assert.equal(report.single.filename,'one.jpg');assert.deepEqual(report.single.dimensions,[246,468]);
 assert.deepEqual(report.dpi,{gentle:[300,300],balanced:[200,200],strong:[133,133]});
 for(const format of ['jpeg','png','webp']){assert.equal(report.converted[format].mime,`image/${format}`);assert.deepEqual(report.converted[format].dimensions,[64,32]);}
 assert.equal(report.converted.jpeg.pixel[3],255);assert.ok(report.converted.jpeg.pixel.slice(0,3).every(v=>v>245));assert.equal(report.converted.png.pixel[3],0);assert.equal(report.converted.webp.pixel[3],0);assert.equal(report.converted.jpeg.outputLarger,true);
 assert.equal(report.imagePdf.mime,'application/pdf');assert.equal(report.imagePdf.pages,1);assert.deepEqual(report.imagePdf.page,{width:48,height:24});
 for(const message of Object.values(report.errors))assert.notEqual(message,'UNEXPECTED SUCCESS');assert.match(report.errors.password,/парол/i);
 assert.equal(report.earlyAbort,true);assert.equal(report.pageAbort,true);assert.ok(report.abortMs<5000);assert.equal(report.pageLimit,true);assert.equal(report.pdfScriptExecuted,false);
 console.log('Conversion Chrome checks passed.');
}finally{await browser.close();}
