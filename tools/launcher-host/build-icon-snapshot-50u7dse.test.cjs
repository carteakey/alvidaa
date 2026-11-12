'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const generator=path.join(__dirname,'build-icon-snapshot-50u7dse.cjs');
// A 4x4 opaque PNG and a 2x1 PNG whose only pixel is transparent: stand-ins
// for a pulled shelf icon and the lifted logo the processor writes.
const ICON_B64='iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGM8oaHxnwEJMDGgAcICAInkAh8jE34AAAAAAElFTkSuQmCC';
const LOGO_B64='iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4////fwYGBgYAGe8D/ZYSdisAAAAASUVORK5CYII=';
async function workspace(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'icon-snapshot-test-'));
  // A processor faithful to the native-image CLI contract: icon mode writes
  // the lifted logo next to the prefix and reports worker-shaped JSON.
  const processor=path.join(dir,'fake-processor.cjs');
  fs.writeFileSync(processor,`#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const [input,prefix,mode]=process.argv.slice(2);
if(mode!=='icon'){process.exit(1);}
if(!fs.readFileSync(input).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){process.exit(1);}
fs.writeFileSync(prefix+'-logo.png',Buffer.from('${LOGO_B64}','base64'));
process.stdout.write(JSON.stringify({width:4,height:4,lift:{width:2,height:1,bg:[204,40,40],ink:[0,1,0,0,0,0,0,0]}}));
`);
  fs.chmodSync(processor,0o755);
  const icons=path.join(dir,'storeAppIcon');
  fs.mkdirSync(icons);
  fs.writeFileSync(path.join(icons,'0CB278EC-377F-83D5-7E6F-2829472DD8ED'),Buffer.from(ICON_B64,'base64'));
  fs.writeFileSync(path.join(dir,'context.json'),JSON.stringify({version:1,
    apps:[{id:'app:1',title:'Example',icon:'file:///hisenseUI/var/local/storeAppIcon/0CB278EC-377F-83D5-7E6F-2829472DD8ED'}]}));
  return {dir,processor,icons,context:path.join(dir,'context.json'),
    media:path.join(dir,'media'),snapshot:path.join(dir,'snapshot.json')};
}
test('the offline icon-lift generator emits a staged worker-shaped snapshot',async()=>{
  const work=await workspace();
  try{
    await run(process.execPath,[generator,work.context,work.icons,work.processor,work.media,work.snapshot]);
    const snapshot=JSON.parse(fs.readFileSync(work.snapshot,'utf8'));
    assert.equal(snapshot.version,1);
    assert.equal(snapshot.keyConfigured,false);
    assert.deepEqual(snapshot.cache,{});
    assert.equal(snapshot.error,'');
    assert.equal(snapshot.imageFailures,0);
    const icon='file:///hisenseUI/var/local/storeAppIcon/0CB278EC-377F-83D5-7E6F-2829472DD8ED';
    const value=snapshot.media[icon];
    assert.ok(value&&value.width===4&&value.height===4,'raw rendition metadata');
    assert.equal(value.src.startsWith('file:///hisenseUI/var/local/artCache/free-my-tv/media/'),true,
      'media lands on the artCache symlink lane the engine accepts');
    const lift=value.lift;
    assert.ok(lift&&lift.width===2&&lift.height===1,'lifted logo metadata');
    assert.deepEqual(lift.bg,[204,40,40]);
    assert.equal(lift.src.startsWith('file:///hisenseUI/var/local/artCache/free-my-tv/media/'),true);
    assert.ok(fs.existsSync(path.join(work.media,path.basename(value.src))),'raw file staged');
    assert.ok(fs.existsSync(path.join(work.media,path.basename(lift.src))),'logo file staged');
    const logoEntry=snapshot.media[lift.src];
    assert.ok(logoEntry&&logoEntry.src===lift.src,'logo rendition is addressable media');
  }finally{fs.rmSync(work.dir,{recursive:true,force:true});}
});
test('the generator refuses contexts that did not come from the runtime',async()=>{
  const work=await workspace();
  try{
    fs.writeFileSync(work.context,JSON.stringify({version:2,apps:[]}));
    await assert.rejects(run(process.execPath,[generator,work.context,work.icons,work.processor,work.media,work.snapshot]));
  }finally{fs.rmSync(work.dir,{recursive:true,force:true});}
});
test('the generator refuses icons outside the storeAppIcon namespace',async()=>{
  const work=await workspace();
  try{
    fs.writeFileSync(work.context,JSON.stringify({version:1,apps:[
      {id:'app:1',title:'Escaped',icon:'file:///hisenseUI/var/local/../../escape/AAA'}]}));
    await assert.rejects(run(process.execPath,[generator,work.context,work.icons,work.processor,work.media,work.snapshot]));
  }finally{fs.rmSync(work.dir,{recursive:true,force:true});}
});
test('the generator fails loudly when the icon pipeline drops every shelf icon',async()=>{
  const work=await workspace();
  try{
    fs.writeFileSync(path.join(work.icons,'0CB278EC-377F-83D5-7E6F-2829472DD8ED'),Buffer.from('not an image'));
    await assert.rejects(run(process.execPath,[generator,work.context,work.icons,work.processor,work.media,work.snapshot]));
  }finally{fs.rmSync(work.dir,{recursive:true,force:true});}
});
