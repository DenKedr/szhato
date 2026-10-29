import {ZipWriter,BlobReader,BlobWriter} from '@zip.js/zip.js';

function check(signal) {if(signal?.aborted)throw new DOMException('Архивация остановлена','AbortError');}

// Result payloads are already compressed. Store them using bounded stream reads;
// do not build one Uint8Array containing the whole queue (which may total2GiB).
export async function createResultsZip(entries,signal,onProgress=()=>{}) {
  check(signal);
  const sink=new BlobWriter('application/zip');
  const writer=new ZipWriter(sink,{level:0,useWebWorkers:false,bufferedWrite:false});
  const total=entries.reduce((sum,entry)=>sum+entry.blob.size,0);
  let written=0,finished=false;
  try {
    for(const entry of entries) {
      check(signal);
      if(!entry.name||/[\\/\x00-\x1f]/.test(entry.name)||entry.name==='.'||entry.name==='..')throw new Error('Недопустимое имя файла для ZIP.');
      await writer.add(entry.name,new BlobReader(entry.blob),{
        level:0,useWebWorkers:false,bufferedWrite:false,signal,
        onprogress:bytes=>{check(signal);onProgress(total?Math.min(99,(written+bytes)/total*100):0,`Добавляем ${entry.name}`);},
      });
      written+=entry.blob.size;
    }
    check(signal);
    const result=await writer.close();finished=true;
    check(signal);onProgress(100,'ZIP готов');
    return result;
  } finally {
    // Close the stream even after errors; no resulting partial Blob is returned.
    if(!finished)await writer.close().catch(()=>{});
  }
}
