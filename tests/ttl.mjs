import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';

// Only the browser clock is simulated. Production TTL stays at 15 minutes.
const TTL=15*60*1000;
const BASE=Date.parse('2026-10-29T10:00:00Z');
const URL=process.env.TTL_QA_URL||'http://127.0.0.1:5173/';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={};
let png;

async function pageForCase(){
  const page=await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{
    window.__qaObjectUrls={created:[],revoked:[]};
    const create=globalThis.URL.createObjectURL.bind(globalThis.URL);
    const revoke=globalThis.URL.revokeObjectURL.bind(globalThis.URL);
    globalThis.URL.createObjectURL=(blob)=>{const url=create(blob);window.__qaObjectUrls.created.push(url);return url;};
    globalThis.URL.revokeObjectURL=(url)=>{window.__qaObjectUrls.revoked.push(url);return revoke(url);};
  });
  await page.clock.install({time:BASE});
  await page.goto(URL);
  await page.getByRole('heading',{name:/Меньше размер/}).waitFor();
  await page.clock.pauseAt(BASE+10000);
  if(!png) png=Buffer.from(await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#0a84ff';ctx.fillRect(0,0,640,480);
    ctx.fillStyle='white';ctx.font='48px sans-serif';ctx.fillText('TTL QA',70,220);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  return page;
}
async function addPhoto(page,name='photo.png'){
  await page.locator('input[type=file]').setInputFiles({name,mimeType:'image/png',buffer:png});
  const rows=page.locator('.file-row');
  await rows.last().waitFor();
  return Number(await rows.last().getAttribute('data-expires-at'));
}
async function click(page,locator){await locator.dispatchEvent('click');await page.clock.runFor(20);}
async function compress(page,again=false){
  const locator=page.getByRole('button',{name:again?'Сжать заново':'Сжать файлы',exact:true});
  await click(page,locator);
  for(let i=0;i<80;i++){
    if(await page.locator('.results').count())return;
    await page.clock.runFor(50);
    await new Promise(resolve=>setTimeout(resolve,15));
  }
  throw new Error('Compression did not finish under simulated clock');
}
async function setTimeAndFocus(page,time,event='focus'){
  await page.clock.setSystemTime(time);
  if(event==='focus')await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  else await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
}

try{
  // Boundary, results, preview URL revocation and immutable expiry across reruns.
  {
    const page=await pageForCase();const expiry=await addPhoto(page);
    const preview=await page.locator('.file-thumbnail img').getAttribute('src');
    assert.equal(expiry,BASE+10000+TTL);
    assert.match(await page.getByTestId('file-expiry').innerText(),/15:00/);
    await compress(page);const firstExpiry=Number(await page.locator('.file-row').getAttribute('data-expires-at'));
    await compress(page,true);const secondExpiry=Number(await page.locator('.file-row').getAttribute('data-expires-at'));
    assert.equal(firstExpiry,expiry);assert.equal(secondExpiry,expiry);
    await setTimeAndFocus(page,expiry-1000);
    assert.equal(await page.locator('.file-row').count(),1);
    assert.equal(await page.locator('.results').count(),1);
    assert.match(await page.getByTestId('file-expiry').innerText(),/0:01/);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.download-file').dispatchEvent('click')]);
    assert.ok((await readFile(await download.path())).length>0);
    await setTimeAndFocus(page,expiry);
    assert.equal(await page.locator('.file-row').count(),0);assert.equal(await page.locator('.results').count(),0);
    assert.equal(await page.locator('.file-thumbnail img').count(),0);
    assert.equal(await page.evaluate(url=>window.__qaObjectUrls.revoked.includes(url),preview),true);
    assert.match(await page.getByRole('alert').innerText(),/Время хранения истекло/);
    report.boundary={availableAt:'14:59',removedAt:'15:00',expiryUnchangedOnRerun:true,countdown:true,previewUrlRevoked:true};
    await page.close();
  }
  // Individual deadlines for files added five minutes apart, plus duplicate ZIP names.
  {
    const page=await pageForCase();const first=await addPhoto(page,'same.png');
    await setTimeAndFocus(page,first-TTL+5*60*1000);
    const second=await addPhoto(page,'same.png');assert.equal(second-first,5*60*1000);
    await compress(page);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Скачать ZIP-архив',exact:true}).dispatchEvent('click')]);
    const archive=unzipSync(new Uint8Array(await readFile(await download.path())));const names=Object.keys(archive);
    assert.equal(names.length,2);assert.notEqual(names[0],names[1]);
    await setTimeAndFocus(page,first);
    assert.equal(await page.locator('.file-row').count(),1);
    assert.equal(Number(await page.locator('.file-row').getAttribute('data-expires-at')),second);
    assert.match(await page.getByTestId('file-expiry').innerText(),/5:00/);
    assert.equal(await page.locator('.results').count(),1);
    await setTimeAndFocus(page,second,'visibilitychange');
    assert.equal(await page.locator('.file-row').count(),0);assert.equal(await page.locator('.results').count(),0);
    report.individualTtl={deadlineDifferenceMs:second-first,firstExpiresIndependently:true,secondExpiresIndependently:true,zipNames:names};
    await page.close();
  }
  // A suspended background tab may keep stale DOM, but Download must never expose expired data.
  {
    const page=await pageForCase();const expiry=await addPhoto(page);await compress(page);
    await page.clock.setSystemTime(expiry+60000); // no timer tick or lifecycle event
    assert.equal(await page.locator('.file-row').count(),1);
    let downloadCount=0;page.on('download',()=>downloadCount++);
    await page.locator('.download-file').dispatchEvent('click');
    assert.equal(await page.locator('.file-row').count(),0);assert.equal(await page.locator('.results').count(),0);
    assert.equal(downloadCount,0);
    report.backgroundDownload={staleDomBeforeAction:true,expiredRowsRemovedByDownload:true,downloads:downloadCount};
    await page.close();
  }
  // Timer-only cleanup after a large jump (laptop suspended and resumed).
  {
    const page=await pageForCase();await addPhoto(page);
    await page.clock.fastForward(TTL+1000);
    assert.equal(await page.locator('.file-row').count(),0);
    report.timerOnly={removedWithoutClickOrFocus:true};
    await page.close();
  }
  console.log(JSON.stringify(report,null,2));
  console.log('TTL browser checks passed.');
}finally{await browser.close();}
