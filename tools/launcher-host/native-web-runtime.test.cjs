'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {storage}=require('./native-web-runtime.js');
const PREFIX='alvidaa.freeMyTV.web.';
function fixture(initial={}){
 const data=new Map(Object.entries(initial)),writes=[];
 const sdk={storage:{get:key=>data.get(key),set:(key,value)=>{writes.push(key);data.set(key,value);}}};
 return {data,writes,sdk};
}
test('web preferences migrate theme and ordered favorites without modifying the legacy store',()=>{
 const legacy=JSON.stringify({theme:'light',favorites:['netflix','42','youtube']});
 const f=fixture({'alvidaa.freeMyTV':legacy,'vendor.preference':'keep'}),local=storage(f.sdk);
 assert.deepEqual(JSON.parse(local.getItem('fmtv.prefs')),{theme:'light',shelf:['app:netflix','app:42','app:youtube']});
 assert.equal(f.data.get('alvidaa.freeMyTV'),legacy);assert.equal(f.data.get('vendor.preference'),'keep');
 assert.deepEqual(f.writes,[PREFIX+'fmtv.prefs']);
});
test('saved upstream choices survive a new adapter instance and are not overwritten by legacy choices',()=>{
 const f=fixture({'alvidaa.freeMyTV':{theme:'light',favorites:['old']}}),first=storage(f.sdk);
 const prefs=JSON.stringify({theme:'dark',lang:'pt-BR',shelf:['app:new'],weather:false,quotes:false});
 first.setItem('fmtv.prefs',prefs);first.setItem('fmtv.cache.test','cached');
 const second=storage(f.sdk);assert.equal(second.getItem('fmtv.prefs'),prefs);assert.equal(second.getItem('fmtv.cache.test'),'cached');
 second.removeItem('fmtv.cache.test');assert.equal(storage(f.sdk).getItem('fmtv.cache.test'),null);
 assert.equal(f.data.get('alvidaa.freeMyTV').theme,'light');
});
test('empty favorites remain empty and malformed legacy data is not rewritten',()=>{
 const f=fixture({'alvidaa.freeMyTV':{theme:'auto',favorites:[]}});
 assert.deepEqual(JSON.parse(storage(f.sdk).getItem('fmtv.prefs')),{theme:'auto',shelf:[]});
 const bad=fixture({'alvidaa.freeMyTV':'broken legacy JSON'});assert.equal(storage(bad.sdk).getItem('fmtv.prefs'),null);assert.deepEqual(bad.writes,[]);
});
test('upstream storage cannot address unrelated vendor keys',()=>{
 const f=fixture(),local=storage(f.sdk);
 for(const name of ['vendor.preference','../fmtv.prefs','fmtv.X','fmtv.prefs\n']){
  assert.throws(()=>local.getItem(name),/Unexpected preference key/);
  assert.throws(()=>local.setItem(name,'x'),/Unexpected preference key/);
  assert.throws(()=>local.removeItem(name),/Unexpected preference key/);
 }
 assert.deepEqual(f.writes,[]);
});
