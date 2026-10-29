import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(base);
 assert.equal(await page.locator('#pdf-mode').inputValue(),'raster');
 for(const level of ['gentle','balanced','strong']){
  await page.locator(`input[value="${level}"]`).check();
  assert.equal(await page.locator('#pdf-mode').inputValue(),'raster');
 }
 await page.getByRole('tab',{name:'Архивы',exact:true}).click();
 assert.match(await page.locator('input[type=file]').getAttribute('accept'),/\.rar/);
 await page.getByRole('tab',{name:'Все файлы',exact:true}).click();
 // Many small inputs exercise the removal of the former20-file cap.
 await page.locator('input[type=file]').setInputFiles(Array.from({length:25},(_,i)=>({name:`document-${i}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 invalid test-only selection')})));
 assert.equal(await page.locator('.file-row').count(),25);
 await page.getByRole('button',{name:'Очистить',exact:true}).click();
 // Selection metadata tests avoid allocating severalGiB just to exercise bounds.
 await page.evaluate(()=>{
  const input=document.querySelector('input[type=file]'),data=new DataTransfer();
  for(let i=0;i<4;i++){
   const file=new File(['x'],`large-${i}.pdf`,{type:'application/pdf'});
   Object.defineProperty(file,'size',{value:500*1024**2});data.items.add(file);
  }
  const exact=new File(['x'],'remaining.pdf',{type:'application/pdf'});Object.defineProperty(exact,'size',{value:48*1024**2});data.items.add(exact);
  const extra=new File(['x'],'over-total.pdf',{type:'application/pdf'});data.items.add(extra);
  const tooLarge=new File(['x'],'over-file.pdf',{type:'application/pdf'});Object.defineProperty(tooLarge,'size',{value:500*1024**2+1});data.items.add(tooLarge);
  input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 assert.equal(await page.locator('.file-row').count(),5);
 assert.match(await page.getByRole('alert').innerText(),/2 ГБ|2 ГиБ/);
 assert.match(await page.getByRole('alert').innerText(),/500/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.ok(await page.locator('a[href="https://github.com/DenKedr/szhato"]').count());
 console.log('UI passed: raster defaults for3levels;25files accepted;500MiB per-file and exact2GiB queue boundary;390px;GitHub. Large-byte selection checks use metadata, not allocatedGiB payloads.');
}finally{await browser.close();}
