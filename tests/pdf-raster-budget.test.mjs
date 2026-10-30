import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import {loadPdf} from '../src/pdf-preserve.js';

test('raster preflight rejects huge embedded image dimensions before decoding',async()=>{
 const doc=await PDFDocument.create();
 // Stream bytes are irrelevant: no image decoder should ever receive this object.
 const image=doc.context.stream(new Uint8Array([1,2,3]),{Type:'XObject',Subtype:'Image',Width:100000,Height:100000,BitsPerComponent:8,ColorSpace:'DeviceRGB'});
 const ref=doc.context.register(image);const page=doc.addPage([595,842]);
 page.node.set(PDFName.of('Resources'),doc.context.obj({XObject:{Huge:ref}}));
 const bytes=await doc.save();
 await assert.rejects(()=>loadPdf(bytes,{raster:true}),/изображение.*32 мегапиксел/i);
 // Preserve mode need not decode it and can keep the original unchanged.
 assert.equal((await loadPdf(bytes)).getPageCount(),1);
 image.dict.set(PDFName.of('Width'),PDFNumber.of(100));
 image.dict.set(PDFName.of('Height'),PDFNumber.of(100));
 assert.equal((await loadPdf(await doc.save(),{raster:true})).getPageCount(),1);
});
