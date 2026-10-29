import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page = await browser.newPage();
  page.on('console',message=>console.log('BROWSER:',message.text()));
  await page.goto('http://127.0.0.1:5173/tests/harness.html');
  await page.waitForFunction(()=>!!window.testModules);
  const report=await page.evaluate(async()=>{
    const {PDFDocument,PDFName,PDFString,degrees}=window.testModules.pdfLib;
    const {compressFile}=window.testModules.engine;
    const doc=await PDFDocument.create();
    const first=doc.addPage([420,600]);
    first.setRotation(degrees(90));
    const form=doc.getForm();const field=form.createTextField('customer');
    field.setText('Denis');field.addToPage(first,{x:20,y:50,width:150,height:25});
    const link=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[20,100,220,130],Border:[0,0,0],A:{S:'URI',URI:PDFString.of('https://example.com/test')}}));
    first.node.addAnnot(link);
    const source=new File([await doc.save({useObjectStreams:false})],'form.pdf',{type:'application/pdf'});
    const result=await compressFile(source,{pdfMode:'preserve'});
    const read=await PDFDocument.load(await result.blob.arrayBuffer());
    const annots=read.getPage(0).node.Annots();
    const uris=[];
    for(let i=0;i<annots.size();i++) {
      const annotation=read.context.lookup(annots.get(i));
      const actionRef=annotation.get(PDFName.of('A'));
      const action=actionRef ? read.context.lookup(actionRef) : null;
      if(action) uris.push(action.get(PDFName.of('URI')).decodeText());
    }
    const keptForm={name:read.getForm().getTextField('customer').getText(),rotation:read.getPage(0).getRotation().angle,annotations:annots.size(),uris,before:source.size,after:result.outputSize};
    const empty=new File([''],'empty.png',{type:'image/png'});
    const oversized=new File(['x'],'huge.png',{type:'image/png'});Object.defineProperty(oversized,'size',{value:501*1024*1024});
    const renamed=new File(['not an image'],'fake.jpg',{type:'image/jpeg'});
    const animatedWebp=new Uint8Array(30);animatedWebp.set(new TextEncoder().encode('RIFF'),0);animatedWebp.set(new TextEncoder().encode('WEBPVP8X'),8);animatedWebp[20]=2;
    const hugePng=new Uint8Array(33);hugePng.set([137,80,78,71,13,10,26,10]);hugePng.set(new TextEncoder().encode('IHDR'),12);const pngView=new DataView(hugePng.buffer);pngView.setUint32(16,10000);pngView.setUint32(20,10000);
    const messages={};
    for(const [name,file] of [['empty',empty],['oversized',oversized],['renamed',renamed],['animation',new File([animatedWebp],'animation.webp')],['dimensions',new File([hugePng],'huge-pixels.png')]]) {
      try{await compressFile(file);messages[name]='UNEXPECTED SUCCESS';}catch(e){messages[name]=e.message;}
    }
    console.log('Starting cancel QA');const aborter=new AbortController();let aborted=false;
    try{await Promise.race([compressFile(source,{pdfMode:'raster'},(percent,message)=>{console.log('cancel progress',percent,message);if(message.startsWith('Страница'))aborter.abort();},aborter.signal),new Promise((_,reject)=>setTimeout(()=>reject(new Error('CANCEL_TIMEOUT')),10000))]);}catch(e){aborted=e.name==='AbortError';}
    return {keptForm,messages,aborted};
  });
  console.log(JSON.stringify(report,null,2));
  assert.equal(report.keptForm.name,'Denis');assert.equal(report.keptForm.rotation,90);
  assert.equal(report.keptForm.annotations,2);assert.deepEqual(report.keptForm.uris,['https://example.com/test']);
  assert.match(report.messages.empty,/пуст/i);assert.match(report.messages.oversized,/500/);
  assert.notEqual(report.messages.renamed,'UNEXPECTED SUCCESS');assert.match(report.messages.animation,/Анимирован/);
  assert.match(report.messages.dimensions,/32/);assert.equal(report.aborted,true);
  console.log('Independent QA checks passed.');
}finally{await browser.close();}
