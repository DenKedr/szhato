import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {zipSync,unzipSync} from 'fflate';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173/';
const chrome=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TTL=15*60*1000,BASE=Date.parse('2026-10-29T12:00:00Z');
const report={};
const browser=await chromium.launch({executablePath:chrome,headless:true});
let png,jpeg;
const pdfDoc=await PDFDocument.create();
pdfDoc.addPage([240,320]).drawText('Page one',{x:20,y:220,size:18});
pdfDoc.addPage([320,240]).drawText('Page two',{x:20,y:150,size:18});
const pdf=Buffer.from(await pdfDoc.save());
const archive=Buffer.from(zipSync({'hello.txt':new TextEncoder().encode('Hello from archive QA')}));

async function newPage({convert=true,clock=false}={}){
  const page=await browser.newPage();page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{
    window.__qaBlobMetadata=[];
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=original(blob);window.__qaBlobMetadata.push({url,type:blob.type,size:blob.size});return url;};
  });
  if(clock)await page.clock.install({time:BASE});
  const url=new URL(convert?'/converter':'/compressed',base);
  await page.goto(url.href);await page.getByRole('heading',{level:1,name:convert?/Нужный формат/:/Меньше размер/}).waitFor();
  if(clock)await page.clock.pauseAt(BASE+10000);
  if(!png){
    const fixture=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
      const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(320,240);let seed=19;
      for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed>>>24;pixels.data[i+1]=(seed>>>24)+70;pixels.data[i+2]=(seed>>>24)+140;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
      const encode=type=>new Promise(resolve=>canvas.toBlob(resolve,type,.15));
      const png=await encode('image/png'),jpg=await encode('image/jpeg');
      return {png:[...new Uint8Array(await png.arrayBuffer())],jpeg:[...new Uint8Array(await jpg.arrayBuffer())]};
    });png=Buffer.from(fixture.png);jpeg=Buffer.from(fixture.jpeg);
  }
  return page;
}
async function choose(page,files){await page.locator('input[type=file]').setInputFiles(files);}
const imageFile=(name='photo.jpg')=>({name,mimeType:'image/jpeg',buffer:jpeg});
const pngFile=(name='photo.png')=>({name,mimeType:'image/png',buffer:png});
const pdfFile=(name='report.pdf')=>({name,mimeType:'application/pdf',buffer:pdf});
const zipFile=(name='documents.zip')=>({name,mimeType:'application/zip',buffer:archive});
async function drop(page,files){
  await page.evaluate(files=>{
    const data=new DataTransfer();for(const file of files){const raw=atob(file.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));data.items.add(new File([bytes],file.name,{type:file.mimeType}));}
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
  },files.map(file=>({name:file.name,mimeType:file.mimeType,base64:file.buffer.toString('base64')})));
}
async function processQueue(page,{convert=true,again=false,clock=false}={}){
  const name=convert?(again?'Конвертировать заново':'Конвертировать файлы'):(again?'Сжать заново':'Сжать файлы');
  await page.getByRole('button',{name,exact:true}).dispatchEvent('click');
  if(clock){
    for(let i=0;i<150;i++){
      if(await page.locator('.results').count())break;
      await page.clock.runFor(50);await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  await page.locator('.results').waitFor({timeout:30000});
  assert.equal(await page.locator('.error-message').count(),0,await page.locator('.error-message').allTextContents());
}
async function download(page,locator,{ext,mime}={}){
  const offset=await page.evaluate(()=>window.__qaBlobMetadata.length);
  const [file]=await Promise.all([page.waitForEvent('download'),locator.dispatchEvent('click')]);
  const bytes=await readFile(await file.path());
  const meta=await page.evaluate(offset=>window.__qaBlobMetadata.slice(offset),offset);
  if(ext)assert.ok(file.suggestedFilename().toLowerCase().endsWith(ext),file.suggestedFilename());
  if(mime)assert.ok(meta.some(item=>item.type===mime),JSON.stringify(meta));
  return {name:file.suggestedFilename(),bytes,meta};
}
function assertMagic(bytes,format){
  if(format==='jpeg')assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
  if(format==='png')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  if(format==='webp'){assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');}
  if(format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
}

try{
  // Separate converter entry/reload, drag-and-drop and incompatibility without losing the queue.
  {
    const page=await newPage();assert.equal(new URL(page.url()).pathname.replace(/\/$/,''),'/converter');
    await page.reload();await page.getByLabel('Конвертировать в',{exact:true}).waitFor();
    assert.equal(await page.locator('.tool-switch').count(),0);
    assert.equal(await page.locator('.sibling-project').getAttribute('href'),'/compressed');
    await drop(page,[pdfFile(),pngFile(),zipFile()]);assert.equal(await page.locator('.file-row').count(),2);
    assert.match(await page.getByRole('alert').innerText(),/ZIP|RAR|архив/i);
    const names=await page.locator('.file-name').allTextContents();
    await page.getByLabel('Конвертировать в',{exact:true}).selectOption('pdf');
    assert.deepEqual(await page.locator('.file-name').allTextContents(),names);
    assert.equal(await page.getByRole('button',{name:'Конвертировать файлы',exact:true}).isDisabled(),true);
    assert.match(await page.locator('.conversion-notice').innerText(),/Очередь сохранена/);
    await page.getByLabel('Конвертировать в',{exact:true}).selectOption('jpeg');
    assert.equal(await page.getByRole('button',{name:'Конвертировать файлы',exact:true}).isEnabled(),true);
    report.navigationAndValidation={separateEntryAndReload:true,noModeSwitch:true,siblingProjectLink:true,mixedDropRetainsCompatibleFiles:true,rejectedArchive:true,pdfTargetDoesNotRemoveQueuedPdf:true};
    await page.close();
  }
  // New formats must be returned even if larger, with matching extension, MIME and file bytes.
  {
    const page=await newPage();await page.getByLabel('Конвертировать в',{exact:true}).selectOption('png');await choose(page,[imageFile()]);await processQueue(page);
    const output=await download(page,page.locator('.download-file'),{ext:'.png',mime:'image/png'});assertMagic(output.bytes,'png');
    assert.ok(output.bytes.length>jpeg.length,'Fixture must verify conversion output larger than the original');
    assert.match(await page.locator('.results h2').innerText(),/Размер вырос/);
    report.largerResult={inputBytes:jpeg.length,outputBytes:output.bytes.length,filename:output.name,mime:'image/png',notReplacedByOriginal:true};
    await page.getByRole('button',{name:'Очистить',exact:true}).click();
    const formats=[];
    for(const [format,ext,mime] of [['jpeg','.jpg','image/jpeg'],['webp','.webp','image/webp']]){
      await page.getByLabel('Конвертировать в',{exact:true}).selectOption(format);await choose(page,[pngFile()]);await processQueue(page);
      const converted=await download(page,page.locator('.download-file'),{ext,mime});assertMagic(converted.bytes,format);formats.push({format,name:converted.name,mime});
      await page.getByRole('button',{name:'Очистить',exact:true}).click();
    }
    report.imageFormats=formats;await page.close();
  }
  // Each input photo becomes one PDF; common ZIP keeps duplicate output names distinct.
  {
    const page=await newPage();await page.getByLabel('Конвертировать в',{exact:true}).selectOption('pdf');await choose(page,[imageFile('same.jpg'),imageFile('same.jpg')]);await processQueue(page);
    assert.equal(await page.locator('.download-file').count(),2);
    const single=await download(page,page.locator('.download-file').first(),{ext:'.pdf',mime:'application/pdf'});assertMagic(single.bytes,'pdf');assert.equal((await PDFDocument.load(single.bytes)).getPageCount(),1);
    const result=await download(page,page.getByRole('button',{name:'Скачать ZIP-архив',exact:true}),{ext:'.zip',mime:'application/zip'});
    const files=unzipSync(new Uint8Array(result.bytes)),names=Object.keys(files);assert.equal(names.length,2);assert.notEqual(names[0],names[1]);
    for(const [name,bytes]of Object.entries(files)){assert.match(name,/\.pdf$/i);assertMagic(Buffer.from(bytes),'pdf');assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);}
    report.photosToSeparatePdf={count:2,onePageEach:true,zipNames:names};await page.close();
  }
  // Multi-page PDF produces a ZIP of actual page images, not a misleading image extension.
  {
    const page=await newPage();await page.getByLabel('Конвертировать в',{exact:true}).selectOption('png');await choose(page,[pdfFile()]);await processQueue(page);
    const result=await download(page,page.locator('.download-file'),{ext:'.zip',mime:'application/zip'});
    const files=unzipSync(new Uint8Array(result.bytes));assert.equal(Object.keys(files).length,2);
    for(const [name,bytes]of Object.entries(files)){assert.match(name,/\.png$/i);assertMagic(Buffer.from(bytes),'png');}
    report.pdfPages={archiveName:result.name,pages:Object.keys(files)};await page.close();
  }
  // Clock freezes busy state long enough to verify controls, then advances processing normally.
  {
    const page=await newPage({clock:true});await choose(page,[imageFile()]);const expiry=Number(await page.locator('.file-row').getAttribute('data-expires-at'));
    await page.getByRole('button',{name:'Конвертировать файлы',exact:true}).dispatchEvent('click');
    assert.equal(await page.locator('.tool-switch').count(),0);
    assert.equal(await page.locator('input[name="compression-level"]').first().isDisabled(),true);
    assert.equal(await page.getByLabel('Конвертировать в',{exact:true}).isDisabled(),true);
    for(let i=0;i<150&&!await page.locator('.results').count();i++){await page.clock.runFor(50);await new Promise(resolve=>setTimeout(resolve,10));}
    await page.locator('.results').waitFor();assert.equal(Number(await page.locator('.file-row').getAttribute('data-expires-at')),expiry);
    await page.getByLabel('Конвертировать в',{exact:true}).selectOption('png');await page.getByLabel('Конвертировать в',{exact:true}).selectOption('jpeg');
    assert.equal(Number(await page.locator('.file-row').getAttribute('data-expires-at')),expiry);
    await page.clock.setSystemTime(expiry-1000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await page.locator('.file-row').count(),1);
    await page.clock.setSystemTime(expiry);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await page.locator('.file-row').count(),0);assert.equal(await page.locator('.results').count(),0);
    report.ttlAndBusy={qualityAndTargetDisabledWhileBusy:true,noModeSwitch:true,conversionDoesNotExtendTtl:true,targetChangeDoesNotExtendTtl:true,removedAtFifteenMinutes:true};await page.close();
  }
  // Compression and ZIP remain reachable; GitHub link and former count-cap removal remain intact.
  {
    const page=await newPage({convert:false});assert.equal(await page.locator('#pdf-mode').inputValue(),'raster');
    assert.equal(await page.locator('a[href="https://github.com/DenKedr/szhato"]').count(),1);
    await choose(page,Array.from({length:25},(_,i)=>imageFile(`photo-${i}.jpg`)));assert.equal(await page.locator('.file-row').count(),25);await page.getByRole('button',{name:'Очистить',exact:true}).click();
    await choose(page,[pngFile()]);await processQueue(page,{convert:false});const photo=await download(page,page.locator('.download-file'));assert.ok(photo.bytes.length>0);await page.getByRole('button',{name:'Очистить',exact:true}).click();
    await page.getByRole('tab',{name:'Архивы',exact:true}).click();await choose(page,[zipFile()]);await processQueue(page,{convert:false});const packed=await download(page,page.locator('.download-file'),{ext:'.zip',mime:'application/zip'});
    assert.equal(new TextDecoder().decode(unzipSync(new Uint8Array(packed.bytes))['hello.txt']),'Hello from archive QA');
    report.compressionRegression={photoDownload:true,archiveContentsPreserved:true,twentyFiveFilesAccepted:true,githubLinkPreserved:true};await page.close();
  }
  // Validate selection boundaries with metadata, without allocating gigabytes of test data.
  {
    const page=await newPage();
    await page.evaluate(()=>{
      const input=document.querySelector('input[type=file]'),data=new DataTransfer();
      for(let i=0;i<4;i++){const file=new File(['x'],`large-${i}.jpg`,{type:'image/jpeg'});Object.defineProperty(file,'size',{value:500*1024**2});data.items.add(file);}
      const remaining=new File(['x'],'remaining.jpg',{type:'image/jpeg'});Object.defineProperty(remaining,'size',{value:48*1024**2});data.items.add(remaining);
      data.items.add(new File(['x'],'over-total.jpg',{type:'image/jpeg'}));
      const tooLarge=new File(['x'],'over-file.jpg',{type:'image/jpeg'});Object.defineProperty(tooLarge,'size',{value:500*1024**2+1});data.items.add(tooLarge);
      input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    assert.equal(await page.locator('.file-row').count(),5);
    const errors=await page.getByRole('alert').innerText();assert.match(errors,/2 ГБ|2 ГиБ/);assert.match(errors,/500/);
    report.converterSelectionBounds={exactTwoGiBAccepted:true,aboveQueueLimitRejected:true,aboveFiveHundredMiBRejected:true,metadataSimulation:true};await page.close();
  }
  console.log(JSON.stringify(report,null,2));console.log('Converter UI checks passed.');
}finally{await browser.close();}
