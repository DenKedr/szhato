const levels=new Set(['gentle','balanced','strong']);
export async function recompressArchive(file,{level='balanced'}={},onProgress=()=>{},signal){
 if(!levels.has(level))throw new Error('Выберите допустимый уровень сжатия архива.');
 if(signal?.aborted)throw new DOMException('Обработка отменена','AbortError');
 if(!file?.size||file.size>500*1024*1024)throw new Error('Архив должен быть непустым и не больше 500 МБ.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./archive.worker.js',import.meta.url),{type:'module'});
  let finished=false;
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};
  const abort=()=>finish(new DOMException('Обработка отменена','AbortError'));
  const timer=setTimeout(()=>finish(new Error('Обработка архива заняла больше 2 минут и остановлена. Попробуйте меньший архив.')),120000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>finish(new Error('Не удалось обработать архив. Возможно, недостаточно памяти браузера.'));
  worker.onmessage=({data})=>{
   if(finished)return;
   if(data.type==='progress'){try{onProgress(data.percent,data.message);}catch(error){finish(error);}return;}
   if(data.type==='error'){finish(new Error(data.message));return;}
   if(data.type==='result')finish(null,data.result);
  };
  worker.postMessage({file,level});
 });
}
