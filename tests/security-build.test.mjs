import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('pinned UnRAR glue works without JavaScript eval under production CSP',async()=>{
 const {rewriteUnrarGlue,SAFE_CREATE_NAMED_FUNCTION}=await import('../build/unrar-csp.js');
 const source=readFileSync(new URL('../node_modules/node-unrar-js/esm/js/unrar.js',import.meta.url),'utf8');
 const rewritten=rewriteUnrarGlue(source);
 assert.equal(rewritten.includes('new Function('),false);
 assert.equal(rewritten.includes('new_(Function,'),false);
 const create=vm.runInNewContext('const makeLegalFunctionName = n => n.replace(/[^a-zA-Z0-9_]/g,"_");'+SAFE_CREATE_NAMED_FUNCTION+'; createNamedFunction',{}, {contextCodeGeneration:{strings:false,wasm:false}});
 const Named=create('safe-name',function(a,b){this.total=a+b;});
 assert.equal(Named.name,'safe_name');
 const instance=new Named(4,7);assert.equal(instance.total,11);assert.ok(instance instanceof Named);
 const target={};Named.call(target,3,5);assert.equal(target.total,8);
 assert.throws(()=>rewriteUnrarGlue(source+' '),/identity|pinned|идентич/i);
});

test('CSP-safe embind invoker preserves ABI conversion and destructor rules',async()=>{
 const {SAFE_CREATE_NAMED_FUNCTION,SAFE_CRAFT_INVOKER_FUNCTION}=await import('../build/unrar-csp.js');
 const boot='const makeLegalFunctionName=n=>n.replace(/[^a-zA-Z0-9_]/g,"_");const throwBindingError=m=>{throw new Error(m)};const runDestructors=d=>{while(d.length){const p=d.pop();d.pop()(p)}};';
 const craft=vm.runInNewContext(boot+SAFE_CREATE_NAMED_FUNCTION+';'+SAFE_CRAFT_INVOKER_FUNCTION+';craftInvokerFunction',{}, {contextCodeGeneration:{strings:false,wasm:false}});
 const returns={name:'int',fromWireType:x=>x+1};
 const cls={name:'Class',toWireType:(_,x)=>x.handle,destructorFunction:null};
 const arg={name:'int',toWireType:(_,x)=>x*2,destructorFunction:null};
 const method=craft('method-name',[returns,cls,arg],{},(target,self,x)=>target+self+x,5);
 assert.equal(method.call({handle:10},3),22);assert.equal(method.length,1);assert.equal(method.name,'method_name');
 assert.throws(()=>method.call({handle:10}),/arguments|args/);
 const destroyed=[];
 const alloc={name:'alloc',toWireType:(stack,x)=>{stack.push(v=>destroyed.push(v),x);return x;}};
 const call=craft('allocated',[returns,null,alloc],null,(target,x)=>target+x,2);
 assert.equal(call(8),11);assert.deepEqual(destroyed,[8]);
 const direct={name:'direct',toWireType:(_,x)=>x,destructorFunction:x=>destroyed.push(x)};
 const nonreturn=craft('void-return',[{name:'void'},null,direct],null,()=>undefined,0);
 assert.equal(nonreturn(4),undefined);assert.deepEqual(destroyed,[8,4]);
});
