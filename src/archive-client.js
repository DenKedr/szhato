const levels=new Set(['gentle','balanced','strong']);
export async function recompressArchive(file,{level='balanced',archiveMode='optimize',pdfMode='raster'}={},onProgress=()=>{},signal){
 if(!levels.has(level))throw new Error('Выберите допустимый уровень сжатия архива.');
 if(!['optimize','repack'].includes(archiveMode)||!['raster','preserve'].includes(pdfMode))throw new Error('Выберите допустимый способ обработки содержимого архива.');
 if(signal?.aborted)throw new DOMException('Обработка отменена','AbortError');
 if(!file?.size||file.size>500*1024*1024)throw new Error('Архив должен быть непустым и не больше 500 МБ.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./archive.worker.js',import.meta.url),{type:'module'});
  let finished=false,processing=false;
  const contentController=new AbortController();
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();contentController.abort();error?reject(error):resolve(result);};
  const abort=()=>finish(new DOMException('Обработка отменена','AbortError'));
  const timer=setTimeout(()=>finish(new Error('Обработка архива заняла больше 2 минут и остановлена. Попробуйте меньший архив.')),120000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>finish(new Error('Не удалось обработать архив. Возможно, недостаточно памяти браузера.'));
  worker.onmessage=async({data})=>{
   if(finished)return;
   if(data.type==='progress'){try{onProgress(data.percent,data.message);}catch(error){finish(error);}return;}
   if(data.type==='error'){finish(new Error(data.message));return;}
   if(data.type==='transform'){
    // Only one validated member at a time; never interpret HTML, scripts or nested archives.
    if(processing||archiveMode!=='optimize'||!Number.isSafeInteger(data.id)||!(data.blob instanceof Blob)||data.blob.size>256*1024*1024||!/\.(pdf|jpe?g|png|webp)$/i.test(data.name)){
     finish(new Error('Неверный запрос обработки содержимого архива.'));return;
    }
    processing=true;
    try{
     onProgress(data.percent,'Сжатие файла внутри архива');
     if(finished)return;
     const {compressFile}=await import('./compression.js');
     if(finished)return;
     const member=new File([data.blob],data.name.split('/').pop());
     const result=await compressFile(member,{level,pdfMode,imageFormat:'auto',preserveImageFormat:true},(p,message)=>{
      if(!finished)onProgress(Math.min(94,data.percent+p/100*data.span),`Внутри архива: ${message}`);
     },contentController.signal);
     if(!finished)worker.postMessage({type:'transformed',id:data.id,blob:result.blob,skipped:false});
    }catch(error){
     if(finished)return;
     if(error?.name==='AbortError'){finish(error);return;}
     // Unsupported or signed documents stay byte-identical. Do not expose names or parser details.
     worker.postMessage({type:'transformed',id:data.id,blob:data.blob,skipped:true});
    }finally{processing=false;}
    return;
   }
   if(data.type==='result')finish(null,data.result);
  };
  worker.postMessage({type:'start',file,level,archiveMode});
 });
}
