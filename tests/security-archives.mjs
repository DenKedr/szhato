import {chromium} from 'playwright';
import {zipSync,unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {ArchiveBudget} from '../src/archive-policy.js';

const count=new ArchiveBudget(1000000);
for(let i=0;i<10000;i++)count.add({name:`entry-${i}`,size:0,packed:0});
assert.throws(()=>count.add({name:'one-too-many',size:0,packed:0}),/10 000/);

const payload=new Uint8Array(256);for(let i=0;i<payload.length;i++)payload[i]=i;
const valid=zipSync({'data.bin':payload},{level:0});
const broken=valid.slice();const header=new DataView(broken.buffer);
const dataOffset=30+header.getUint16(26,true)+header.getUint16(28,true);broken[dataOffset]^=1;
const forged=valid.slice(),forgeView=new DataView(forged.buffer);
forgeView.setUint32(22,1,true);
for(let i=0;i<forged.length-46;i++)if(forgeView.getUint32(i,true)===0x02014b50){forgeView.setUint32(i+24,1,true);break;}
const inside=zipSync({'../must-not-extract.txt':new TextEncoder().encode('opaque nested bytes')},{level:0});
const nested=zipSync({'nested.zip':inside},{level:0});

const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const context=await browser.newContext();
 const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:;";
 await context.route('**/src/archive.worker.js*',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});});
 const page=await context.newPage();const requests=[];
 page.on('request',request=>requests.push({method:request.method(),url:request.url()}));
 await page.goto('http://127.0.0.1:5173/tests/archive-harness.html');
 await page.waitForFunction(()=>Boolean(window.archiveTest));
 const report=await page.evaluate(async ({broken,forged,nested})=>{
  const {recompressArchive,zip}=window.archiveTest;
  const errors={};
  for(const [name,bytes] of Object.entries({broken,forged})){
   try{await recompressArchive(new File([new Uint8Array(bytes)],`${name}.zip`));errors[name]='ACCEPTED';}
   catch(error){errors[name]=error.message;}
  }
  const result=await recompressArchive(new File([new Uint8Array(nested)],'nested-container.zip'));
  const reader=new zip.ZipReader(new zip.BlobReader(result.blob));
  const entries=await reader.getEntries();
  const inner=await entries[0].getData(new zip.Uint8ArrayWriter());await reader.close();
  return {errors,names:entries.map(entry=>entry.filename),inner:Array.from(inner)};
 },{broken:Array.from(broken),forged:Array.from(forged),nested:Array.from(nested)});
 assert.notEqual(report.errors.broken,'ACCEPTED');assert.notEqual(report.errors.forged,'ACCEPTED');
 assert.deepEqual(report.names,['nested.zip']);assert.deepEqual(new Uint8Array(report.inner),inside);
 assert.deepEqual(unzipSync(new Uint8Array(report.inner))['../must-not-extract.txt'],new TextEncoder().encode('opaque nested bytes'));
 assert.ok(requests.every(request=>request.method==='GET'));
 assert.ok(requests.every(request=>new URL(request.url).origin==='http://127.0.0.1:5173'));
 console.log(JSON.stringify({errors:report.errors,nestedRemainsOpaque:true,requestMethods:[...new Set(requests.map(request=>request.method))],allRequestsSameOrigin:true,entryCap10000:true},null,2));
}finally{await browser.close();}
