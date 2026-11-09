'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderableSnapshot}=require('./native-feed-worker.cjs');
const base='file:///hisenseUI/var/local/free-my-tv/media/';
const icon='file:///hisenseUI/var/local/storeAppIcon/fixture.png';
function fixture(){
 const raw=base+'current-raw.jpg',thumb=base+'current-thumb.png',lift=base+'current-lift.png',logo=base+'logo.png',app=base+'app.png';
 return {raw,thumb,lift,logo,app,render:{imageFailures:0,images:{'w1280:/current.jpg':raw,'original:/current.jpg':raw,'w500:/logo.png':logo,'w1280:/stale.jpg':base+'stale.jpg'},media:{
  [raw]:{src:raw,thumb,lift:{src:lift}},[thumb]:{src:thumb},[lift]:{src:lift},[logo]:{src:logo},
  [icon]:{src:app},[app]:{src:app},[base+'stale.jpg']:{src:base+'stale.jpg'},[base+'orphan.png']:{src:base+'orphan.png'}
 }}};
}
test('publication retains only current recommendation mappings and reachable derived resources',()=>{
 const f=fixture(),snapshot={version:1,cache:{'fmtv.recs':JSON.stringify({picks:[{id:1,backdrop:'/current.jpg',logo:'/logo.png'}]})}},before=JSON.stringify(f.render);
 const result=renderableSnapshot(snapshot,f.render);
 assert.deepEqual(Object.keys(result.images).sort(),['original:/current.jpg','w1280:/current.jpg','w500:/logo.png']);
 assert.deepEqual(Object.keys(result.media).sort(),[f.raw,f.thumb,f.lift,f.logo,icon,f.app].sort());
 assert.equal(result.cache,snapshot.cache);assert.equal(JSON.stringify(f.render),before,'publication does not mutate or delete disk-cache data');
});
test('empty or malformed recommendations publish no old artwork but preserve native icons',()=>{
 const f=fixture();
 for(const value of [undefined,'broken','null','[]','{"picks":null}','{"picks":[null]}','{"picks":[]}']){
  const result=renderableSnapshot({cache:{'fmtv.recs':value}},f.render);
  assert.deepEqual(result.images,{});assert.deepEqual(Object.keys(result.media).sort(),[icon,f.app].sort());
 }
 assert.deepEqual(renderableSnapshot({},{}).images,{});
});
test('reachability handles cycles, missing entries and malformed descriptors without exposing orphans',()=>{
 const f=fixture();f.render.media[f.thumb]={src:f.raw,lift:{src:base+'missing.png'}};f.render.media[f.lift]=null;
 const result=renderableSnapshot({cache:{'fmtv.recs':JSON.stringify({picks:[{backdrop:'/current.jpg'}]})}},f.render);
 assert.deepEqual(Object.keys(result.media).sort(),[f.raw,f.thumb,icon,f.app].sort());
});
