import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {unzipSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';

const workspace=fileURLToPath(new URL('../../../',import.meta.url));
const root=path.resolve(process.env.STAGE_DIR||path.join(workspace,'work/separate-projects-stage'));
const fixturePhoto=path.join(workspace,'work/fixtures/photo.jpg');
const fixturePdf=path.join(workspace,'work/converter-two-pages.pdf');
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'";
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json','.xml':'application/xml','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');let uri=url.pathname;
    if((uri==='/compressed'||uri==='/compressed/')&&url.searchParams.get('tool')==='convert'){res.writeHead(301,{Location:'/converter','Content-Security-Policy':csp});res.end();return;}
    if(uri==='/')uri='/index.html';
    if(uri==='/compressed'||uri==='/compressed/')uri='/compressed/index.html';
    if(uri==='/converter'||uri==='/converter/')uri='/converter/index.html';
    const file=path.resolve(root,'.'+decodeURIComponent(uri));
    if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;const errors=[],cspErrors=[],report={};
const BASE=Date.parse('2026-10-29T15:00:00Z'),TTL=15*60*1000;

async function newPage(route,{clock=false}={}){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/Refused to|Content Security Policy/.test(message.text()))cspErrors.push(message.text().slice(0,240));});
  await page.addInitScript(()=>{
    window.__qaBlobs={created:[],revoked:[]};
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);window.__qaBlobs.created.push({url,type:blob.type,size:blob.size});return url;};
    URL.revokeObjectURL=url=>{window.__qaBlobs.revoked.push(url);return revoke(url);};
  });
  if(clock)await page.clock.setFixedTime(BASE);
  await page.goto(base+route);await page.waitForLoadState('networkidle');
  return page;
}
async function complete(page,convert){
  await page.getByRole('button',{name:convert?'Конвертировать файлы':'Сжать файлы',exact:true}).click();
  await page.getByRole('button',{name:convert?'Конвертировать заново':'Сжать заново',exact:true}).waitFor({timeout:30000});
  assert.equal(await page.locator('.error-message').count(),0,JSON.stringify(await page.locator('.error-message').allTextContents()));
}
async function download(page){
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('.download-file').click()]);
  return{name:file.suggestedFilename(),bytes:await readFile(await file.path())};
}
async function verifyTtl(page,expiry){
  assert.equal(expiry,BASE+TTL);
  assert.equal(Number(await page.locator('.file-row').getAttribute('data-expires-at')),expiry);
  const preview=await page.locator('.file-thumbnail img').getAttribute('src');
  await page.clock.setFixedTime(expiry-1000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('.file-row').count(),1);assert.equal(await page.locator('.results').count(),1);
  assert.match(await page.getByTestId('file-expiry').innerText(),/0:01/);
  await page.clock.setFixedTime(expiry);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('.file-row').count(),0);assert.equal(await page.locator('.results').count(),0);
  assert.equal(await page.evaluate(url=>window.__qaBlobs.revoked.includes(url),preview),true);
}

try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const pages={};
  for(const [route,brand,heading,action,sibling] of [
    ['/compressed','сжато.',/Меньше размер/,'Сжать файлы','/converter'],
    ['/converter','конвертер.',/Нужный формат/,'Конвертировать файлы','/compressed'],
  ]){
    const page=await newPage(route);const converting=route==='/converter';
    await page.getByRole('heading',{level:1,name:heading}).waitFor();
    assert.equal((await page.locator('.site-header .brand').innerText()).replace(/\s+/g,''),brand);
    assert.equal(await page.locator('.tool-switch').count(),0);
    assert.equal(await page.getByRole('button',{name:'Конвертер',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Сжатие',exact:true}).count(),0);
    assert.equal(await page.locator('.sibling-project').getAttribute('href'),sibling);
    assert.equal(await page.locator('.sibling-project').evaluate(element=>element.tagName),'A');
    assert.equal(await page.getByRole('button',{name:action,exact:true}).isDisabled(),true);
    assert.equal(await page.locator('#conversion-format').count(),converting?1:0);
    assert.equal(await page.locator('#pdf-mode').count(),converting?0:1);
    assert.equal(await page.locator('#image-format').count(),converting?0:1);
    assert.equal(await page.getByRole('tab',{name:'Архивы',exact:true}).count(),converting?0:1);
    assert.match(await page.locator('.privacy-pill').innerText(),/Без загрузки на сервер/);
    assert.match(await page.locator('.local-note').innerText(),/15 минут/);
    assert.match(await page.locator('.workspace-limit').innerText(),/500/);
    assert.equal(new URL(await page.locator('link[rel=canonical]').getAttribute('href')).pathname,route);
    const layouts=[];
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      assert.ok(layout.document<=layout.viewport,`${route}: ${JSON.stringify(layout)}`);layouts.push(width);
    }
    pages[route]={title:await page.title(),canonical:await page.locator('link[rel=canonical]').getAttribute('href'),brand,h1:await page.locator('h1').innerText(),action,sibling,layouts};
    await page.close();
  }
  assert.notEqual(pages['/compressed'].title,pages['/converter'].title);
  assert.notEqual(pages['/compressed'].canonical,pages['/converter'].canonical);
  report.projects=pages;
  {
    const page=await newPage('/');assert.equal(await page.locator('article.project-card').count(),2);
    const cards=await page.locator('article.project-card').evaluateAll(elements=>elements.map(element=>({title:element.querySelector('h3').textContent,href:element.querySelector('a.button-primary').getAttribute('href')})));
    assert.deepEqual(cards,[{title:'Сжато',href:'/compressed'},{title:'Конвертер',href:'/converter'}]);
    for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`catalog overflow ${width}`);}
    await page.getByRole('link',{name:'Открыть Конвертер'}).click();assert.equal(new URL(page.url()).pathname,'/converter');
    assert.ok(await page.locator('a[href="/source/szhato-source.zip"]').count());
    report.catalog={cards,layouts:[320,390,1440],sourceLinkPresent:true};await page.close();
  }
  {
    const page=await newPage('/compressed?tool=convert');
    assert.equal(new URL(page.url()).pathname,'/converter');
    const response=await page.goto(base+'/compressed?tool=convert');
    const previous=response.request().redirectedFrom();assert.ok(previous);assert.equal((await previous.response()).status(),301);
    report.legacyRedirect={status:301,destination:'/converter',scope:'local staging route contract'};await page.close();
  }
  {
    const page=await newPage('/compressed',{clock:true});
    await page.locator('input[type=file]').setInputFiles(fixturePhoto);const expiry=Number(await page.locator('.file-row').getAttribute('data-expires-at'));
    await complete(page,false);const result=await download(page);assert.match(result.name,/\.jpg$/i);assert.equal(result.bytes.subarray(0,3).toString('hex'),'ffd8ff');
    const before=(await readFile(fixturePhoto)).length;assert.ok(result.bytes.length<before);
    await verifyTtl(page,expiry);
    report.compression={inputBytes:before,outputBytes:result.bytes.length,filename:result.name,ttlFifteenMinutes:true};await page.close();
  }
  {
    const page=await newPage('/converter');assert.equal(await page.locator('#conversion-format').inputValue(),'jpeg');
    await page.locator('input[type=file]').setInputFiles(fixturePdf);await complete(page,true);
    const result=await download(page);assert.match(result.name,/-jpg\.zip$/i);
    const entries=unzipSync(new Uint8Array(result.bytes));assert.deepEqual(Object.keys(entries),['page-001.jpg','page-002.jpg']);
    for(const image of Object.values(entries))assert.equal(Buffer.from(image).subarray(0,3).toString('hex'),'ffd8ff');
    report.pdfToImages={filename:result.name,pages:Object.keys(entries)};await page.close();
  }
  {
    const page=await newPage('/converter',{clock:true});await page.getByLabel('Конвертировать в',{exact:true}).selectOption('pdf');
    await page.locator('input[type=file]').setInputFiles(fixturePhoto);const expiry=Number(await page.locator('.file-row').getAttribute('data-expires-at'));
    await complete(page,true);const result=await download(page);assert.match(result.name,/\.pdf$/i);
    const document=await PDFDocument.load(result.bytes);assert.equal(document.getPageCount(),1);
    await verifyTtl(page,expiry);
    report.imageToPdf={filename:result.name,pages:1,ttlFifteenMinutes:true};await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(cspErrors,[]);
  report.security={productionCsp:true,pageErrors:0,cspErrors:0};
  console.log(JSON.stringify(report,null,2));console.log('Independent projects QA passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
