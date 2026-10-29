import test from 'node:test';
import assert from 'node:assert/strict';

test('conversion validates source/target combinations and the 500 MiB boundary',async()=>{
 const {validateConversionFile}=await import('../src/conversion.js');
 const file=(name,size=100)=>({name,size,type:''});
 assert.equal(validateConversionFile(file('image.png'),'pdf'),null);
 assert.equal(validateConversionFile(file('report.pdf'),'webp'),null);
 assert.equal(validateConversionFile(file('photo.jpg',500*1024*1024),'png'),null);
 assert.match(validateConversionFile(file('photo.jpg',500*1024*1024+1),'png'),/500/);
 assert.match(validateConversionFile(file('empty.png',0),'pdf'),/пуст/i);
 assert.match(validateConversionFile(file('report.pdf'),'pdf'),/JPEG|PNG|WebP/i);
 assert.match(validateConversionFile(file('archive.zip'),'png'),/PDF|JPG/);
 assert.match(validateConversionFile(file('photo.jpg'),'unsupported'),/формат/i);
});
