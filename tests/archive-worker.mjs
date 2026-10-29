import {chromium}from'playwright';
import {zipSync}from'fflate';
import{readFile,writeFile}from'node:fs/promises';
import assert from'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const context=await browser.newContext();
 const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:";
 await context.route('**/*',async route=>{
  if(route.request().url().includes('/src/archive.worker.js')){const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':csp}});}else await route.continue();
 });
 const page=await context.newPage();page.on('console',m=>{if(m.type()==='error')console.log('Browser:',m.text())});
 await page.goto('http://127.0.0.1:5173/tests/archive-harness.html');await page.waitForFunction(()=>!!window.archiveTest);
 const text='Repeated text payload for compression testing. '.repeat(200);
 const script='globalThis.archivePayloadRan=true; throw new Error("must never run");';
 const files={'folder/readme.txt':new TextEncoder().encode(text),'payload.js':new TextEncoder().encode(script),'page.html':new TextEncoder().encode('<script>globalThis.archivePayloadRan=true</script>')};
 const zip=zipSync(files,{level:0});
 const fixtures={};for(const name of ['FolderTest.rar','WithComment.rar','test_read_format_rar5_compressed.rar','HeaderEnc1234.rar','test_read_format_rar5_encrypted.rar','test_read_format_rar5_symlink.rar','traversal.zip','duplicate.zip','bomb.zip','symlink.zip','encrypted.zip'])fixtures[name]=Array.from(await readFile(new URL('fixtures/'+name,import.meta.url)));
 const report=await page.evaluate(async({zip,fixtures,text,script})=>{
  const {recompressArchive,zip:lib}=window.archiveTest;globalThis.archivePayloadRan=false;
  const readZip=async blob=>{const reader=new lib.ZipReader(new lib.BlobReader(blob));try{const values={};for await(const e of reader.getEntriesGenerator())if(!e.directory)values[e.filename]=await e.getData(new lib.TextWriter());return values;}finally{await reader.close();}};
  const source=new File([new Uint8Array(zip)],'source.zip',{type:'application/zip'});
  const gentle=await recompressArchive(source,{level:'gentle'}),strong=await recompressArchive(source,{level:'strong'});
  const values=await readZip(strong.blob);
  const rar={};for(const [name,bytes]of Object.entries(fixtures)){try{const result=await recompressArchive(new File([new Uint8Array(bytes)],name),{level:'balanced'});rar[name]={ok:true,size:result.outputSize,files:await readZip(result.blob)};}catch(e){rar[name]={ok:false,error:e.message};}}
  const aborted=new AbortController();aborted.abort();let abort=false;try{await recompressArchive(source,{},()=>{},aborted.signal);}catch(e){abort=e.name==='AbortError';}
  const during=new AbortController();let abortDuring=false;try{await recompressArchive(source,{},()=>during.abort(),during.signal);}catch(e){abortDuring=e.name==='AbortError';}
  return{before:source.size,gentle:gentle.outputSize,strong:strong.outputSize,textEqual:values['folder/readme.txt']===text,scriptEqual:values['payload.js']===script,htmlEqual:values['page.html']==='<script>globalThis.archivePayloadRan=true</script>',payloadRan:globalThis.archivePayloadRan,rar,abort,abortDuring};
 },{zip:Array.from(zip),fixtures,text,script});
 console.log(JSON.stringify({...report,rar:Object.fromEntries(Object.entries(report.rar).map(([n,r])=>[n,{...r,files:r.files?Object.keys(r.files):undefined}]))},null,2));
 assert.ok(report.strong<report.before);assert.ok(report.strong<=report.gentle);
 assert.equal(report.textEqual,true);assert.equal(report.scriptEqual,true);assert.equal(report.htmlEqual,true);assert.equal(report.payloadRan,false);assert.equal(report.abort,true);assert.equal(report.abortDuring,true);
 for(const name of ['FolderTest.rar','WithComment.rar','test_read_format_rar5_compressed.rar'])assert.equal(report.rar[name].ok,true,JSON.stringify(report.rar[name]));
 for(const name of ['HeaderEnc1234.rar','test_read_format_rar5_encrypted.rar','test_read_format_rar5_symlink.rar','traversal.zip','duplicate.zip','bomb.zip','symlink.zip','encrypted.zip'])assert.equal(report.rar[name].ok,false,name);
 console.log('Archive worker Chrome/CSP checks passed.');
}finally{await browser.close();}
