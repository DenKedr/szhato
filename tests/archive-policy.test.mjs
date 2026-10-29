import test from 'node:test';
import assert from 'node:assert/strict';

test('archive paths reject traversal, absolute paths, devices and normalized collisions',async()=>{
 const {validateMemberPath,ArchiveBudget}=await import('../src/archive-policy.js');
 for(const name of ['../a','a/../b','/tmp/a','C:/a','C:\\a','\\\\host\\a','a\\..\\b','a\0b','__proto__/x','constructor/x','a/prototype/x','CON.txt','a/evil:stream','a/space.']) assert.throws(()=>validateMemberPath(name),/архив|путь|имя/i,name);
 assert.equal(validateMemberPath('папка/readme.txt'),'папка/readme.txt');
 const b=new ArchiveBudget(1000);b.add({name:'test.txt',size:10,packed:10});
 assert.throws(()=>b.add({name:'TEST.txt',size:10,packed:10}),/повтор|имя/i);
});
test('archive budgets reject declared and actual bombs before retaining bytes',async()=>{
 const {ArchiveBudget,MAX_MEMBER_BYTES,MAX_UNPACKED_BYTES}=await import('../src/archive-policy.js');
 assert.throws(()=>new ArchiveBudget(1).add({name:'bomb',size:1000000,packed:1}),/коэффициент|сжат/i);
 assert.throws(()=>new ArchiveBudget(100000000).add({name:'large',size:MAX_MEMBER_BYTES+1,packed:100000000}),/256/);
 const b=new ArchiveBudget(100000000);b.add({name:'file',size:100,packed:100});
 assert.throws(()=>b.actual('file',101),/заявлен|размер/i);
 assert.throws(()=>b.add({name:'link',size:0,packed:0,symlink:true}),/ссыл|тип/i);
 const total=new ArchiveBudget(100000000);total.add({name:'a',size:MAX_MEMBER_BYTES,packed:10000000});total.add({name:'b',size:MAX_MEMBER_BYTES,packed:10000000});
 assert.throws(()=>total.add({name:'c',size:1,packed:1}),/512/);
 assert.equal(MAX_UNPACKED_BYTES,512*1024*1024);
 const many=new ArchiveBudget(1000);for(let i=0;i<10000;i++)many.add({name:`empty-${i}`,size:0,packed:0});
 assert.throws(()=>many.add({name:'overflow',size:0,packed:0}),/10 000/);
});
test('RAR5 redirection/encryption and RAR4 symlinks fail closed',async()=>{
 const {preflightRar}=await import('../src/archive-policy.js');
 const vint=n=>{const out=[];do{const part=n%128;n=Math.floor(n/128);out.push(part|(n?128:0));}while(n);return out;};
 const header=(body)=>new Uint8Array([0,0,0,0,...vint(body.length),...body]);
 const join=(...items)=>new Uint8Array(items.flatMap(x=>Array.from(x)));
 const sig5=new Uint8Array([82,97,114,33,26,7,1,0]);
 const main=header([1,0,0]);
 const file=header([2,1,3,0,0,0,0,0,1,97,2,5,0]); // extra record redirection
 assert.throws(()=>preflightRar(join(sig5,main,file)),/ссыл|перенаправ/i);
 assert.throws(()=>preflightRar(join(sig5,header([4,0]))),/парол|шифр/i);
 const rar4=new Uint8Array(7+13+32);rar4.set([82,97,114,33,26,7,0]);const v=new DataView(rar4.buffer);rar4[9]=0x73;v.setUint16(12,13,true);const p=20;rar4[p+2]=0x74;v.setUint16(p+5,32,true);rar4[p+15]=3;v.setUint32(p+28,0o120777,true);
 assert.throws(()=>preflightRar(rar4),/ссыл|тип/i);
});
