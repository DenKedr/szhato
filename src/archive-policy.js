// Archive members are untrusted bytes. This module never interprets their contents.
export const MAX_ARCHIVE_ENTRIES=10000;
export const MAX_UNPACKED_BYTES=512*1024*1024;
export const MAX_MEMBER_BYTES=256*1024*1024;
export const MAX_EXPANSION_RATIO=200;
const bad=message=>{throw new Error(message);};
export function validateMemberPath(value){
 if(typeof value!=='string'||!value||value.length>1024||/^[\\/]|^[a-z]:/i.test(value)||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value))bad('Небезопасный путь внутри архива.');
 const name=value.replace(/\\/g,'/').normalize('NFC').replace(/\/$/,'');
 const segments=name.split('/');
 if(segments.some(s=>!s||s==='.'||s==='..'||/[<>:"|?*]/.test(s)||/[ .]$/.test(s)||['__proto__','constructor','prototype'].includes(s.toLowerCase())||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))bad('Небезопасное имя или путь внутри архива.');
 return name;
}
export class ArchiveBudget{
 constructor(packedSize){this.packedSize=packedSize;this.entries=new Map();this.total=0;this.actualTotal=0;}
 add({name,size,packed,directory=false,symlink=false,special=false,encrypted=false}){
  name=validateMemberPath(name);const key=name.toLowerCase();
  if(this.entries.size>=MAX_ARCHIVE_ENTRIES)bad('В архиве больше 10 000 записей.');
  if(this.entries.has(key))bad('В архиве повторяются нормализованные имена файлов.');
  if(symlink||special)bad('Архив содержит ссылки или специальные типы файлов.');
  if(encrypted)bad('Архив защищён паролем. Выберите копию без шифрования.');
  if(!Number.isSafeInteger(size)||size<0||!Number.isSafeInteger(packed)||packed<0||(directory&&size!==0))bad('Повреждён размер записи архива.');
  if(size>MAX_MEMBER_BYTES)bad('Распакованная запись архива превышает 256 МБ.');
  if(this.total+size>MAX_UNPACKED_BYTES)bad('Распакованное содержимое архива превышает 512 МБ.');
  if(size/Math.max(1,packed)>MAX_EXPANSION_RATIO||(this.total+size)/Math.max(1,this.packedSize)>MAX_EXPANSION_RATIO)bad('Слишком высокий коэффициент сжатия архива (защита от архивов-бомб).');
  this.total+=size;this.entries.set(key,{name,size,packed,directory,actual:0});return name;
 }
 actual(name,length){
  const item=this.entries.get(validateMemberPath(name).toLowerCase());
  if(!item||!Number.isSafeInteger(length)||length<0)bad('Повреждённая запись архива.');
  if(item.actual+length>item.size||item.actual+length>MAX_MEMBER_BYTES)bad('Фактический размер записи превышает заявленный размер.');
  if(this.actualTotal+length>MAX_UNPACKED_BYTES)bad('Распакованное содержимое архива превышает 512 МБ.');
  item.actual+=length;this.actualTotal+=length;
 }
 finish(name){const item=this.entries.get(validateMemberPath(name).toLowerCase());if(!item||item.actual!==item.size)bad('Фактический размер записи архива не совпадает с заявленным.');}
}

// The public UnRAR JS wrapper hides link metadata. Check raw container headers
// first, including RAR5 redirection records, before calling the native WASM parser.
// Specification: https://www.rarlab.com/technote.htm; RAR4 uses HEAD_SIZE/PACK_SIZE.
export function preflightRar(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),budget=new ArchiveBudget(bytes.length);
 const requireBytes=(pos,count)=>{if(!Number.isSafeInteger(pos)||!Number.isSafeInteger(count)||count<0||pos<0||pos+count>bytes.length)bad('Повреждён или обрезан заголовок RAR.');};
 const uint16=pos=>{requireBytes(pos,2);return view.getUint16(pos,true);};
 const uint32=pos=>{requireBytes(pos,4);return view.getUint32(pos,true);};
 const prefix=[82,97,114,33,26,7];if(!prefix.every((b,i)=>bytes[i]===b))bad('Файл не является поддерживаемым RAR. SFX не поддерживается.');
 let offset=bytes[6]===0?7:bytes[6]===1&&bytes[7]===0?8:bad('Неизвестная версия RAR.');
 const version=offset===7?4:5;let ended=false,main=false,blocks=0;
 function vint(cursor,end){let n=0,m=1;for(let i=0;i<10;i++){if(cursor.p>=end)bad('Повреждён заголовок RAR.');const b=bytes[cursor.p++];n+=(b&127)*m;if(!Number.isSafeInteger(n))bad('Слишком большой размер RAR.');if(!(b&128))return n;m*=128;}bad('Повреждён размер RAR.');}
 while(offset<bytes.length){
  if(++blocks>MAX_ARCHIVE_ENTRIES*4+100)bad('Слишком много служебных заголовков RAR.');
  if(version===4){
   requireBytes(offset,7);const type=bytes[offset+2],flags=uint16(offset+3),headerSize=uint16(offset+5);if(headerSize<7)bad('Повреждён заголовок RAR.');requireBytes(offset,headerSize);let packed=(flags&0x8000)?uint32(offset+7):0;
   if(type===0x73){if(main||offset!==7)bad('Неоднозначная структура RAR.');main=true;if(flags&0x80)bad('RAR защищён шифрованием заголовков.');if(flags&1)bad('Многотомные RAR не поддерживаются.');}
   else if(type===0x74){
    if(!main||headerSize<32)bad('Повреждён заголовок файла RAR.');if(flags&3)bad('Многотомные RAR не поддерживаются.');if(flags&4)bad('RAR защищён паролем.');
    let size=uint32(offset+11);packed=uint32(offset+7);const host=bytes[offset+15],attributes=uint32(offset+28),nameSize=uint16(offset+26);let nameStart=offset+32;
    if(flags&0x100){if(headerSize<40)bad('Повреждён заголовок RAR.');packed+=uint32(offset+32)*2**32;size+=uint32(offset+36)*2**32;nameStart+=8;}
    requireBytes(nameStart,nameSize);if(nameStart+nameSize>offset+headerSize)bad('Повреждено имя файла RAR.');
    // RAR4's legacy Unicode name encoding is decoded by UnRAR later. The ANSI
    // prefix is still checked now, then the actual decoded name is compared.
    const raw=bytes.subarray(nameStart,nameStart+nameSize),zero=raw.indexOf(0),ansi=zero>=0?raw.subarray(0,zero):raw;
    const name=new TextDecoder('windows-1252').decode(ansi);const directory=(flags&0xe0)===0xe0;const fileType=host===3?(attributes>>>12)&15:0;
    if(host>3||fileType&&![4,8].includes(fileType)||(host!==3&&(attributes&0x400)))bad('RAR содержит ссылки или неподдерживаемый тип файла.');
    // Unicode RAR4 stores a lossy ANSI prefix (often containing literal '?').
    // It is not the actual extraction name. UnRAR decodes that legacy encoding;
    // the worker validates every resulting Unicode name before any extraction.
    budget.add({name:flags&0x200?`rar4-entry-${budget.entries.size}`:name,size,packed,directory});
   }else if(type===0x7b){if(flags&1)bad('Многотомные RAR не поддерживаются.');ended=true;offset+=headerSize;break;}
   else if(![0x75,0x76,0x77,0x78,0x79,0x7a].includes(type))bad('Неподдерживаемый служебный заголовок RAR.');
   requireBytes(offset+headerSize,packed);offset+=headerSize+packed;
  }else{
   requireBytes(offset,5);const cursor={p:offset+4},headerSize=vint(cursor,bytes.length);if(headerSize>2*1024*1024)bad('Слишком большой заголовок RAR.');const end=cursor.p+headerSize;requireBytes(cursor.p,headerSize);
   const type=vint(cursor,end),flags=vint(cursor,end),extraSize=flags&1?vint(cursor,end):0,packed=flags&2?vint(cursor,end):0;
   if(flags&0x18)bad('Многотомные RAR не поддерживаются.');if(extraSize>end-cursor.p)bad('Повреждён дополнительный заголовок RAR.');const bodyEnd=end-extraSize;
   if(type===4)bad('RAR защищён шифрованием заголовков.');
   if(type===1){if(main||offset!==8)bad('Неоднозначная структура RAR.');main=true;const archiveFlags=vint(cursor,bodyEnd);if(archiveFlags&3)bad('Многотомные RAR не поддерживаются.');}
   else if(type===2||type===3){
    if(!main)bad('Повреждён заголовок RAR.');const fileFlags=vint(cursor,bodyEnd),size=vint(cursor,bodyEnd),attributes=vint(cursor,bodyEnd);if(fileFlags&8)bad('RAR с неизвестным распакованным размером не поддерживается.');
    if(fileFlags&2)cursor.p+=4;if(fileFlags&4)cursor.p+=4;if(cursor.p>bodyEnd)bad('Повреждён заголовок RAR.');
    const compression=vint(cursor,bodyEnd),host=vint(cursor,bodyEnd),nameSize=vint(cursor,bodyEnd);if(nameSize>1024||cursor.p+nameSize>bodyEnd)bad('Повреждено имя RAR.');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor.p,cursor.p+nameSize));
    const dictionaryBits=(compression>>10)&31;if((compression&63)>0||dictionaryBits>9)bad('RAR требует неподдерживаемый или слишком большой словарь.');
    const fileType=host===1?(attributes>>>12)&15:0;if(host>1||fileType&&![4,8].includes(fileType)||(host===0&&(attributes&0x400)))bad('RAR содержит ссылки или неподдерживаемый тип файла.');
    const extra={p:bodyEnd};while(extra.p<end){const length=vint(extra,end),recordEnd=extra.p+length;if(!length||recordEnd>end)bad('Повреждён дополнительный заголовок RAR.');const extraType=vint(extra,recordEnd);if(extraType===1)bad('RAR защищён паролем.');if(extraType===5)bad('RAR содержит ссылки или перенаправления файлов.');if(extraType<1||extraType>7)bad('Неизвестный дополнительный тип RAR.');extra.p=recordEnd;}
    if(type===3){if(name!=='CMT'||size>65536||size!==packed||((compression>>7)&7)!==0)bad('Служебные потоки и метаданные RAR не поддерживаются.');}
    else budget.add({name,size,packed,directory:!!(fileFlags&1)});
   }else if(type===5){const endFlags=vint(cursor,bodyEnd);if(endFlags&1)bad('Многотомные RAR не поддерживаются.');ended=true;offset=end;break;}
   else bad('Неподдерживаемый служебный заголовок RAR.');
   requireBytes(end,packed);offset=end+packed;
  }
 }
 if(!main||!ended||offset!==bytes.length)bad('Повреждённая или неоднозначная структура RAR.');
 return {version,budget};
}
