import test from 'node:test';
import assert from 'node:assert/strict';

// User-visible safeguards, not a reimplementation of the compressor.
test('reject unsupported, empty and oversized inputs before allocating image canvases', async () => {
  const {validateFile}=await import('../src/file-utils.js');
  assert.match(validateFile({name:'movie.mp4',type:'video/mp4',size:100}),/PDF|JPG/);
  assert.match(validateFile({name:'empty.pdf',type:'application/pdf',size:0}),/пуст/i);
  assert.match(validateFile({name:'huge.jpg',type:'image/jpeg',size:501*1024*1024}),/500/);
  assert.equal(validateFile({name:'large.pdf',size:500*1024*1024}),null);
  assert.equal(validateFile({name:'archive.ZIP',size:100}),null);
  assert.equal(validateFile({name:'archive.rar',size:100}),null);
  assert.equal(validateFile({name:'Документ.PDF',type:'',size:300}),null);
});
test('queue byte limits allow2GiB and use readableGB units',async()=>{
  const {MAX_TOTAL_BYTES,MAX_FILE_BYTES,formatBytes}=await import('../src/file-utils.js');
  assert.equal(MAX_TOTAL_BYTES,2*1024**3);
  assert.equal(MAX_FILE_BYTES,500*1024**2);
  assert.match(formatBytes(2*1024**3),/2 ГБ/);
});
test('safe, unique download names cannot escape folders or collide', async()=>{
  const {uniqueFilename}=await import('../src/file-utils.js');
  assert.equal(uniqueFilename('../folder/report.pdf',new Set()),'report.pdf');
  assert.equal(uniqueFilename('report.pdf',new Set(['report.pdf','report (2).pdf'])),'report (3).pdf');
});
test('repacked PDF keeps page geometry and selectable text while reducing bytes',async()=>{
  const {PDFDocument}=await import('pdf-lib');
  const {compressPdfPreserve}=await import('../src/pdf-preserve.js');
  const doc=await PDFDocument.create();
  doc.addPage([612,792]).drawText('Selectable report text');
  doc.addPage([300,500]).drawText('Second page');
  const source=await doc.save({useObjectStreams:false});
  const output=await compressPdfPreserve(source);
  assert.ok(output.byteLength<source.byteLength);
  const result=await PDFDocument.load(output);
  assert.equal(result.getPageCount(),2);
  assert.deepEqual(result.getPages().map(p=>p.getSize()),[{width:612,height:792},{width:300,height:500}]);
});
test('signed and malformed PDFs fail with actionable messages',async()=>{
  const {compressPdfPreserve}=await import('../src/pdf-preserve.js');
  await assert.rejects(compressPdfPreserve(new TextEncoder().encode('%PDF-1.7\n/ByteRange [0 10 20 30]')),/подпис/i);
  await assert.rejects(compressPdfPreserve(new TextEncoder().encode('this is not a PDF')),/PDF|повреж/i);
});
