import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
test('results ZIP reads blobs incrementally and preserves all payload bytes',async()=>{
 const {createResultsZip}=await import('../src/results-zip.js');
 const file=new Blob(['actual data']);file.arrayBuffer=()=>{throw new Error('Do not materialize whole original');};
 const blob=await createResultsZip([{name:'one.txt',blob:file},{name:'two.txt',blob:new Blob(['second'])}],new AbortController().signal);
 const entries=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 assert.deepEqual(Object.keys(entries),['one.txt','two.txt']);
 assert.equal(strFromU8(entries['one.txt']),'actual data');
 assert.equal(strFromU8(entries['two.txt']),'second');
});
test('results ZIP respects cancellation before processing any input',async()=>{
 const {createResultsZip}=await import('../src/results-zip.js');
 const controller=new AbortController();controller.abort();
 await assert.rejects(createResultsZip([{name:'one.txt',blob:new Blob(['data'])}],controller.signal),{name:'AbortError'});
});
