import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../deploy/analytics/metrika-113884564.js',import.meta.url),'utf8');
function run(hostname){
 const inserted=[];const first={parentNode:{insertBefore:node=>inserted.push(node)}};
 const scope={location:{hostname,href:'https://'+hostname+'/compressed'},document:{referrer:'https://it-kedr.ru/',scripts:[],createElement:()=>({}),getElementsByTagName:()=>[first]}};
 scope.window=scope;vm.createContext(scope);return {scope,inserted,execute:()=>vm.runInContext(source,scope)};
}
test('owned hosts initialize counter once with supplied options even if bootstrap repeats',()=>{
 for(const host of ['it-kedr.ru','soft.it-kedr.ru','forum.it-kedr.ru','project.it-kedr.ru','future.it-kedr.ru']){
  const app=run(host);app.execute();app.execute();
  assert.equal(app.inserted.length,1);assert.equal(app.inserted[0].src,'https://mc.yandex.ru/metrika/tag.js?id=113884564');
  assert.equal(app.scope.ym.a.length,1);
  const args=[...app.scope.ym.a[0]];assert.equal(args[0],113884564);assert.equal(args[1],'init');
  assert.deepEqual(JSON.parse(JSON.stringify(args[2])),{ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',referrer:'https://it-kedr.ru/',url:'https://'+host+'/compressed',accurateTrackBounce:true,trackLinks:true});
 }
});
test('unowned domains and deceptive suffixes never initialize owner analytics',()=>{
 for(const host of ['localhost','127.0.0.1','201.24.61.235','example.com','it-kedr.ru.evil.test','not-it-kedr.ru']){
  const app=run(host);app.execute();assert.equal(app.inserted.length,0);assert.equal(app.scope.ym,undefined);
 }
});
