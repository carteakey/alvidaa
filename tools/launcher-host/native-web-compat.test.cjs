'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const create=require('./native-web-compat.js');
function browserLoad(file){
  const sandbox={};sandbox.self=sandbox;vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),sandbox,{filename:file});
  return sandbox;
}
function adapter(){return create({setTimeout:()=>1,clearTimeout(){}},{},{assets:{colors:[],symbols:[]},assetBase:''});}
const local='file:///hisenseUI/var/local/free-my-tv/media/photo-raw.jpg';
test('unavailable original artwork falls back to a prepared local rendition of the same photo',()=>{
 const native=adapter();native.accept({version:1,media:{},images:{'w1280:/photo.jpg':local}});
 assert.equal(native.image('/photo.jpg','original'),local);
 assert.equal(native.image('/different.jpg','original'),'');
 native.accept({version:1,media:{},images:{'original:/photo.jpg':'https://evil.test/photo.jpg','w1280:/photo.jpg':local}});
 assert.equal(native.image('/photo.jpg','original'),local);
 native.accept({version:1,media:{},images:{'original:/photo.jpg':'file:///hisenseUI/var/local/free-my-tv/../private.jpg'}});
 assert.equal(native.image('/photo.jpg','original'),'');native.dispose();
});
test('staged assets under the 50U7DSE artCache symlink resolve like the 55A7KAU free-my-tv lane',()=>{
  const native=adapter();
  const staged='file:///hisenseUI/var/local/artCache/free-my-tv/media/photo-raw.jpg';
  native.accept({version:1,media:{},images:{'w1280:/photo.jpg':staged}});
  assert.equal(native.image('/photo.jpg','original'),staged);
  assert.equal(native.image('/different.jpg','original'),'');
  native.dispose();
});
test('a per-build direct-image hook allows exactly the vendor CDN for browser loads',()=>{
  // The hook is consulted on the engine root (self), like on the TV: load the
  // compat layer in a browser-like sandbox, then install the per-build part.
  const sandbox=browserLoad('native-web-compat.js');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'native-web-50u7dse.js'),'utf8'),sandbox,{filename:'native-web-50u7dse.js'});
  const create=sandbox.AlvidaaNativeWebCompat;
  assert.equal(typeof create,'function');
  const host={setTimeout:()=>1,clearTimeout(){},Image:function(){this.src='';}};
  const options={assets:{colors:[],symbols:[]},assetBase:''};
  const gated=create(host,{},{...options});
  let image=new gated.Image(),errors=0;
  image.onerror=function(){errors++;};
  image.src='https://img.vidaahub.com/vidaa/2025/7/202507250938322973.png';
  assert.equal(errors,0,'vendor URL resolves to a direct load');
  assert.equal(image.src,'https://img.vidaahub.com/vidaa/2025/7/202507250938322973.png','resolved URL reaches the engine');
  image=new gated.Image();image.onerror=function(){errors++;};
  image.src='https://evil.test/x.png';
  assert.equal(errors,1,'non-vendor https still rejected without worker metadata');
  gated.dispose();
  const plain=browserLoad('native-web-compat.js');
  const bare=plain.AlvidaaNativeWebCompat(host,{},options);
  image=new bare.Image();image.onerror=function(){errors++;};
  image.src='https://img.vidaahub.com/vidaa/2025/7/202507250938322973.png';
  assert.equal(errors,2,'no hook: the 55A7KAU local-only contract is unchanged');
  bare.dispose();
});
test('shelf logo images paint without worker metadata instead of erroring',()=>{
  // The 09.62N no-worker state: a local icon loads while its node is still
  // detached from the document, so computed sizes report nothing. Measured
  // (findings 01): that must paint, not fall back to the lettered tile.
  const sandbox=browserLoad('native-web-compat.js');
  const create=sandbox.AlvidaaNativeWebCompat;
  const host={setTimeout:()=>1,clearTimeout(){},
    Image:function(){const self=this;Object.defineProperty(self,'src',{
      set(value){self._src=value;if(self.onload)self.onload();},
      get(){return self._src;}});},
    document:{createElement:()=>({style:{},setAttribute(){}})},
    getComputedStyle:()=>({getPropertyValue:()=>''})};
  const native=create(host,{},{assets:{colors:[],symbols:[]},assetBase:''});
  const node=native.imageElement();
  let errors=0,loads=0;
  node.onerror=()=>errors++;
  node.onload=()=>loads++;
  node.src='file:///hisenseUI/var/local/storeAppIcon/2473F963';
  assert.equal(errors,0,'a loaded icon without metadata must not error');
  assert.equal(loads,1,'upstream onload must run (lift + showLogo)');
  assert.equal(node.style.backgroundImage,'url("file:///hisenseUI/var/local/storeAppIcon/2473F963")');
  assert.ok(!node.style.width,'sizing stays with CSS when no metadata exists');
  assert.ok(!node.style.height,'sizing stays with CSS when no metadata exists');
  // Worker metadata still pins explicit pixel sizes (the 55A7KAU contract).
  native.accept({version:1,media:{'file:///hisenseUI/var/local/storeAppIcon/sized':{src:'file:///hisenseUI/var/local/storeAppIcon/sized',width:200,height:120}},images:{}});
  const sized=native.imageElement();
  sized.onerror=()=>errors++;
  sized.src='file:///hisenseUI/var/local/storeAppIcon/sized';
  assert.equal(sized.style.width,'200px');
  assert.equal(sized.style.height,'120px');
  assert.equal(errors,0);
  native.dispose();
});
test('lift falls back to the raw icon shape when no worker metadata exists',()=>{
  const sandbox=browserLoad('native-web-compat.js');
  const create=sandbox.AlvidaaNativeWebCompat;
  const host={setTimeout:()=>1,clearTimeout(){},Image:function(){this.src='';},
    document:{createElement:()=>({style:{},setAttribute(){}})},getComputedStyle:()=>({getPropertyValue:()=>''})};
  const native=create(host,{},{assets:{colors:[],symbols:[]},assetBase:''});
  native.accept({version:1,media:{'file:///media/measured':{src:'file:///media/measured',lift:false}},images:{}});
  assert.equal(native.lift({src:'file:///media/measured'}),false,'the worker decision wins when metadata exists');
  assert.equal(JSON.stringify(native.lift({src:'file:///hisenseUI/var/local/storeAppIcon/2473F963'})),
    JSON.stringify({src:'file:///hisenseUI/var/local/storeAppIcon/2473F963'}),'no metadata: raw-icon lifted shape');
  native.dispose();
});
test('a staged icon-lift snapshot drives the shelf logo treatment',()=>{
  // build-icon-snapshot-50u7dse.cjs stages worker-shaped media entries offline:
  // the shelf icon URL maps to a raw rendition plus the lifted-logo object.
  // Upstream face()/showLogo() then renders the lifted logo over the brand
  // gradient, the same contract the on-TV feed worker used on 55A7KAU.
  const native=adapter();
  const icon='file:///hisenseUI/var/local/storeAppIcon/0CB278EC-377F-83D5-7E6F-2829472DD8ED';
  const raw='file:///hisenseUI/var/local/artCache/free-my-tv/media/deadbeef-raw.png';
  const logo='file:///hisenseUI/var/local/artCache/free-my-tv/media/deadbeef-logo.png';
  native.accept({version:1,media:{
    [icon]:{src:raw,width:154,height:154,lift:{src:logo,bg:[255,255,255],ink:[0,0,0,0,0,0,0,0],width:106,height:29}},
    [raw]:{src:raw,width:154,height:154},
    [logo]:{src:logo,width:106,height:29}},images:{}});
  const lifted=native.lift({src:icon});
  assert.equal(lifted.src,logo,'showLogo renders the lifted logo rendition');
  assert.deepEqual(lifted.bg,[255,255,255],'the brand gradient comes from the measured icon background');
  assert.deepEqual(lifted.ink,[0,0,0,0,0,0,0,0]);
  assert.equal(lifted.width,106);assert.equal(lifted.height,29);
  // The shelf icon itself loads through the raw staged rendition, not the
  // storeAppIcon URL: face() sets img.src=app.icon, LocalImage resolves it.
  let inner=null;
  const host={setTimeout:()=>1,clearTimeout(){},Image:function(){inner=this;this.src='';},
    document:{createElement:()=>({style:{},setAttribute(){}})},getComputedStyle:()=>({getPropertyValue:()=>''})};
  const create=require('./native-web-compat.js');
  const resolving=create(host,{},{assets:{colors:[],symbols:[]},assetBase:''});
  resolving.accept({version:1,media:{
    [icon]:{src:raw,width:154,height:154,lift:{src:logo,bg:[255,255,255],ink:[0,0,0,0,0,0,0,0],width:106,height:29}}},images:{}});
  const shelfIcon=new resolving.Image();shelfIcon.src=icon;
  assert.equal(inner&&inner.src,raw,'the icon URL resolves to the staged raw rendition');
  const shelfLogo=new resolving.Image();shelfLogo.src=logo;
  assert.equal(inner&&inner.src,logo,'the lifted logo rendition loads from the artCache lane');
  resolving.dispose();
  native.accept({version:1,media:{},images:{}});
  assert.equal(JSON.stringify(native.lift({src:icon})),JSON.stringify({src:icon}),
    'snapshot removal falls back to raw icons without a remount');
  native.dispose();
});
test('image mapping changes invalidate cards even if metadata is unchanged',()=>{
 const native=adapter();let refreshes=0;native.refreshMedia=()=>refreshes++;
 const media={[local]:{src:local,width:1280,height:720}};
 native.accept({version:1,media,images:{}});assert.equal(refreshes,1);
 native.accept({version:1,media,images:{'original:/photo.jpg':local}});assert.equal(refreshes,2);
 native.accept({version:1,media,images:{'original:/photo.jpg':local}});assert.equal(refreshes,2);
 native.dispose();native.accept({version:1,media,images:{}});assert.equal(refreshes,2);
});
