import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5173/tests/harness.html');
 await page.waitForFunction(()=>!!window.testModules);
 const report=await page.evaluate(async()=>{
   const {compressFile}=window.testModules.engine;
   const {PDFDocument}=window.testModules.pdfLib;
   const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1200;
   const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);
   let seed=17;for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=seed>>>24;data.data[i]=v;data.data[i+1]=(v+100)%256;data.data[i+2]=(v+160)%256;data.data[i+3]=255;}ctx.putImageData(data,0,0);
   const jpg=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.99));
   const photo=new File([jpg],'photo.jpg',{type:'image/jpeg'});
   const image=await compressFile(photo,{level:'balanced'});
   const fixturePdf=await PDFDocument.create();const pdfImage=await fixturePdf.embedJpg(await jpg.arrayBuffer());
   fixturePdf.addPage([600,400]).drawImage(pdfImage,{x:0,y:0,width:600,height:400});
   fixturePdf.getPage(0).drawText('Searchable text survives',{x:20,y:30,size:14});
   fixturePdf.addPage([300,500]).drawText('Second page');
   const pdf=new File([await fixturePdf.save({useObjectStreams:false})],'report.pdf',{type:'application/pdf'});
   const preserved=await compressFile(pdf,{level:'balanced',pdfMode:'preserve'});
   const raster=await compressFile(pdf,{level:'strong',pdfMode:'raster'});
   const rasterDoc=await PDFDocument.load(await raster.blob.arrayBuffer());
   const pdfjs=window.testModules.pdfjs;
   const load=pdfjs.getDocument({data:new Uint8Array(await preserved.blob.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
   const read=await load.promise;const text=(await (await read.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');await load.destroy();
   const pngCanvas=globalThis.document.createElement('canvas');pngCanvas.width=500;pngCanvas.height=500;
   const pngCtx=pngCanvas.getContext('2d');pngCtx.fillStyle='red';pngCtx.fillRect(100,100,200,200);
   const png=await new Promise(r=>pngCanvas.toBlob(r,'image/png'));
   const transparent=await compressFile(new File([png],'transparent.png',{type:'image/png'}));
   const bitmap=await createImageBitmap(transparent.blob);pngCanvas.width=bitmap.width;pngCanvas.height=bitmap.height;pngCtx.drawImage(bitmap,0,0);const alphaValue=pngCtx.getImageData(0,0,1,1).data[3];bitmap.close();
   const controller=new AbortController();controller.abort();let aborted=false;try{await compressFile(photo,{},()=>{},controller.signal);}catch(e){aborted=e.name==='AbortError';}
   let corrupt=false;try{await compressFile(new File(['bad pdf'],'broken.pdf'));}catch(e){corrupt=/PDF|поврежд/.test(e.message);}
   return {photo:{before:photo.size,after:image.outputSize,mime:image.blob.type},preserve:{before:pdf.size,after:preserved.outputSize,text},raster:{before:pdf.size,after:raster.outputSize,pages:rasterDoc.getPageCount(),sizes:rasterDoc.getPages().map(p=>p.getSize())},alpha:alphaValue,aborted,corrupt};
 });
 console.log(JSON.stringify(report,null,2));
 assert.ok(report.photo.after<report.photo.before*.8,'JPEG should actually shrink');
 assert.ok(report.preserve.after<report.preserve.before*.8,'embedded JPEG should shrink without losing PDF text');
 assert.match(report.preserve.text,/Searchable text survives/);
 assert.ok(report.raster.after<report.raster.before);
 assert.equal(report.raster.pages,2);assert.deepEqual(report.raster.sizes,[{width:600,height:400},{width:300,height:500}]);
 assert.equal(report.alpha,0);assert.equal(report.aborted,true);assert.equal(report.corrupt,true);
 console.log('Browser compression checks passed.');
}finally{await browser.close();}
