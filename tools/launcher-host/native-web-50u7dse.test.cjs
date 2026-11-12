'use strict';
/* Coverage for the 50U7DSE / V0000.09.62N.Q0923 web port: the per-build part
 * (zone, icon policy, direct-image gate), the shared runtime's zone hook, the
 * TV adapter's vendor icon mapping, and both builders (web + probe). Runs
 * without private firmware files: builders are exercised with a synthetic
 * stock and its own hash.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const crypto=require('node:crypto');
const HOST=__dirname;
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function browserLoad(file,sandbox){
  sandbox=sandbox||{};
  sandbox.self=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(HOST,file),'utf8'),sandbox,{filename:file});
  return sandbox;
}
function fixtureAssets(dir){
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'f.txt'),'probe asset\n');
  fs.writeFileSync(path.join(dir,'fonts.css'),'@font-face{font-family:FMTVWeb16;src:url(f16.ttf)}\n');
  fs.writeFileSync(path.join(dir,'assets.json'),JSON.stringify({
    files:{'f.txt':hash(fs.readFileSync(path.join(dir,'f.txt')))},colors:['ffffff'],symbols:[]
  }));
  return dir;
}
test('the per-build part supplies zone, icon policy and direct-image gate',()=>{
  const sandbox=browserLoad('native-web-50u7dse.js');
  assert.equal(typeof sandbox.AlvidaaNativeWebZone,'function');
  assert.equal(sandbox.AlvidaaNativeWebZone(),'Europe/Berlin');
  const policy=sandbox.AlvidaaWebIconPolicy;
  const url='https://img.vidaahub.com/vidaa/2025/7/202507250938322973.png';
  assert.equal(policy({img:url}),url);
  assert.equal(policy({httpIcon:url}),url);
  assert.equal(policy({img:'https://evil.test/'+url.slice('https://img.vidaahub.com/'.length)}),'');
  assert.equal(policy({img:'file:///etc/passwd'}),'');
  assert.equal(policy({img:'https://img.vidaahub.com/../etc/passwd'}),'');
  assert.equal(policy({img:'https://img.evil-lookalike.com/x.png'}),'');
  assert.equal(policy({appName:'x'}),'');
  // Curated wordmarks arrive through the app policy on finished entries, not
  // the artwork lane: the TV's own store icons resolve first in the platform.
  const appPolicy=sandbox.AlvidaaWebAppPolicy;
  assert.equal(typeof appPolicy,'function');
  const base='file:///hisenseUI/var/local/artCache/free-my-tv/curated/';
  assert.equal(appPolicy({title:'Netflix'}).icon,base+'netflix.png');
  assert.equal(appPolicy({title:'YouTube'}).icon,base+'youtube.png');
  assert.equal(appPolicy({title:'Disney+'}).icon,base+'disneyplus.png');
  assert.equal(appPolicy({title:'HBO Max'}).icon,base+'hbomax.png');
  assert.equal(appPolicy({title:'Apple TV'}).icon,base+'appletv.png');
  // Normalization is letters-and-digits only, so near-miss titles stay on
  // the platform/vendor lanes instead of matching a curated wordmark.
  assert.equal(appPolicy({title:'Netflix Kids'}),null);
  assert.equal(appPolicy({title:'YouTube Kids'}),null);
  assert.equal(policy({appName:'Netflix',img:url}),url,'the artwork lane stays vendor-only');
  const direct=sandbox.AlvidaaWebDirectImage;
  assert.equal(direct(url),true);
  assert.equal(direct('https://evil.test/x.png'),false);
  assert.equal(direct('file:///etc/passwd'),false);
  assert.equal(direct(42),false);
});
test('the curated shelf keeps exactly the owner\u2019s five and hides every other installed app',()=>{
  const sandbox=browserLoad('native-web-50u7dse.js');
  const config={shelfApps:[...sandbox.AlvidaaWebConfig.shelfApps],hideApps:[...sandbox.AlvidaaWebConfig.hideApps]};
  assert.ok(Array.isArray(config.shelfApps)&&Array.isArray(config.hideApps));
  // The live 47-app table from the owned unit (context.json, 2026-11-12):
  // titles as the adapter reports them, ids as the platform reports them.
  const live=[
    ['app:284','TV Channels\u25b6'],['app:1','Netflix'],['app:295','Disney+'],['app:2','Prime Video'],
    ['app:351','Apple TV'],['app:334','Paramount+'],['app:2562','V Home'],['app:2081','Public value'],
    ['app:2584','XBOX'],['app:300','RTL TVNOW'],['app:65','Rakuten TV'],
    ['app:2567','Your home for TV & streaming apps'],['app:2378','HBO Max'],['app:3','YouTube'],
    ['app:73','Chili'],['app:162','DAZN'],['app:1908','JOYN'],['app:2201','WOW'],['app:325','HD+ LIVE TV'],
    ['app:1748','ZATTOO'],['app:245','Triller TV.'],['app:2181','Kids'],
    ['app:227','Haystack TV Local + World News'],['app:2256','Spotify : Music & Podcasts'],
    ['app:2470','Ads Privacy'],['app:2414','waipu.tv \u2013 Live TV Streaming'],['app:244','UEFA.tv'],
    ['app:2372','Crunchyroll'],['app:2484','O2 TV'],['app:2243','Art Gallery'],['app:164','APP STORE'],
    ['app:173','PlutoTV'],['app:187','ZDF'],['app:47','DEEZER'],['app:143','Maxdome'],
    ['app:79','Red Bull TV'],['app:376','Amazon Music'],['app:16','TV Browser'],['app:184','On Demand'],
    ['app:293','NBA'],['app:44','Media'],['app:36','ToonGoggles'],['app:42','Plex'],
    ['app:15','AccuWeather'],['app:2368','Smart Life'],['app:166','E-Manual'],['app:296','Richtlinien']
  ];
  // Upstream web/home.js hidden(): id-or-title substring, lowercased.
  const hidden=app=>config.hideApps.some(want=>
    app[0].toLowerCase().indexOf(want)>=0||app[1].toLowerCase().indexOf(want)>=0);
  const kept=live.filter(app=>!hidden(app));
  assert.deepEqual(kept.map(app=>app[1]).sort(),
    ['Netflix','Apple TV','Disney+','HBO Max','YouTube'].slice().sort(),
    'hideApps must swallow the other 42 apps and none of the five');
  // Upstream pickShelf(): WANTED entries pick apps by id-or-title substring.
  const picked=config.shelfApps.map(want=>
    live.find(app=>(app[0].toLowerCase().indexOf(want)>=0||
      app[1].toLowerCase().indexOf(want)>=0)&&!hidden(app)));
  assert.ok(picked.every(Boolean),'every shelfApps entry picks an app');
  assert.deepEqual(picked.map(app=>app[1]),
    ['Netflix','Apple TV','Disney+','HBO Max','YouTube'],
    'the shelf follows the owner\u2019s stated priority order');
  // Every curated wordmark maps to exactly one kept app (normalizedName).
  const appPolicy=sandbox.AlvidaaWebAppPolicy;
  for(const app of kept){
    const curated=appPolicy({title:app[1]});
    assert.ok(curated&&curated.icon.startsWith('file:///hisenseUI/var/local/artCache/free-my-tv/curated/'),
      app[1]+' must resolve to a curated wordmark');
  }
  assert.equal(appPolicy({title:'Prime Video'}),null,'a hidden app never resolves to a curated icon');
});
test('the shared runtime honors the per-build zone hook over the Australian enumeration',()=>{
  const withPart=(function(){
    const sandbox={module:{exports:{}}};
    sandbox.self=sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(HOST,'native-web-50u7dse.js'),'utf8'),sandbox,{filename:'native-web-50u7dse.js'});
    vm.runInContext(fs.readFileSync(path.join(HOST,'native-web-runtime.js'),'utf8'),sandbox,{filename:'native-web-runtime.js'});
    return sandbox;
  })();
  assert.equal(withPart.module.exports.timezone(),'Europe/Berlin');
  const bare=browserLoad('native-web-runtime.js',{module:{exports:{}}});
  assert.equal(bare.module.exports.timezone(),'');
  const australian=browserLoad('native-web-runtime.js',{module:{exports:{}},modeljs:{getIntValue:function(){return 0;}}});
  assert.equal(australian.module.exports.timezone(),'Australia/Sydney');
});
test('the TV adapter maps vendor icons through the per-build policy and keeps local lanes intact',()=>{
  const sandbox=browserLoad('native-web-tv.js');
  vm.runInContext(fs.readFileSync(path.join(HOST,'native-web-50u7dse.js'),'utf8'),sandbox,{filename:'native-web-50u7dse.js'});
  const createWebTV=sandbox.AlvidaaNativeWebTV;
  assert.equal(typeof createWebTV,'function');
  const sdk={key:{KEYMAP:{LEFT:37,UP:38,RIGHT:39,DOWN:40,ENTER:13,BACK:8,BACKSPACE:8,SOURCE:433,KEYPAD_INPUT:403}}};
  function FakePlatform(_sdk,update){
    const platform={stop(){},changeSource(){},launchApp(){},openSettings(){}};
    platform.start=function(){
      update({
        apps:[
          {appId:'netflix',appName:'Netflix',img:'https://img.vidaahub.com/vidaa/2025/7/202507250938322973.png'},
          {appId:'prime',appName:'Prime Video',img:'https://evil.test/icon.png'},
          {appId:'pplus',appName:'Paramount+',presetImg:'var/local/storeAppIcon/paramount.png'},
          {appId:'206',appName:'VIDAA Home',img:'https://img.vidaahub.com/vidaa/x.png'}
        ],
        sources:[]
      });
    };
    return platform;
  }
  const tv=createWebTV(sdk,{createPlatform:FakePlatform,back(){},holdScreenSaver(){return function(){}},onChange(){}});
  tv.start();
  let apps=null;
  tv.apps(function(list){apps=list;});
  assert.equal(JSON.stringify(apps.map(app=>app.id)),JSON.stringify(['app:netflix','app:prime','app:pplus']));
  // The owner's five get the curated repo wordmarks from the artCache lane;
  // vendor artwork stays the fallback for everything else.
  assert.equal(apps[0].icon,'file:///hisenseUI/var/local/artCache/free-my-tv/curated/netflix.png');
  assert.equal(apps[1].icon,'','non-vendor https artwork stays local-only');
  assert.equal(apps[2].icon,'file:///hisenseUI/var/local/storeAppIcon/paramount.png');
  // Without the per-build policy the vendor icon is dropped: the 55A7KAU
  // local-only contract is unchanged.
  const plain=browserLoad('native-web-tv.js');
  const tv2=plain.AlvidaaNativeWebTV(sdk,{createPlatform:FakePlatform,back(){},holdScreenSaver(){return function(){}},onChange(){}});
  tv2.start();
  let apps2=null;
  tv2.apps(function(list){apps2=list;});
  assert.equal(apps2[0].icon,'');
  assert.equal(apps2[2].icon,'file:///hisenseUI/var/local/storeAppIcon/paramount.png');
});
test('the builder hash-checks stock, embeds the per-build asset base and part order',()=>{
  const web=require('./build-native-web-50u7dse.cjs');
  const probe=require('./build-native-probe-50u7dse.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alvidaa-50u7dse-'));
  try{
    const stock=Buffer.from('var SYNTHETIC_STOCK=1;\n');
    fs.writeFileSync(path.join(dir,'stock.js'),stock);
    const assets=fixtureAssets(path.join(dir,'assets'));
    const stockSha=hash(stock);
    const built=web.build(path.join(dir,'stock.js'),assets,null,{expectedSha256:stockSha});
    const assetId=hash(fs.readFileSync(path.join(assets,'assets.json'))).slice(0,20);
    assert.ok(built.candidate.startsWith(web.MARKER),'candidate carries the feed-worker marker');
    assert.ok(built.candidate.includes(stock.toString()),'stock bytes embedded verbatim');
    assert.ok(built.candidate.includes('file:///hisenseUI/var/local/artCache/free-my-tv/assets/'+assetId+'/'),'per-build artCache asset base');
    assert.ok(!built.candidate.includes('file:///hisenseUI/var/local/free-my-tv/assets/'+assetId+'/'),'55A7KAU base must not leak into this build');
    assert.ok(built.candidate.includes('self.AlvidaaNativeWebBundle='),'web bundle prefix');
    const order=['Native VIDAA data adapter for 75U8QTUK','VIDAA implementation of the pinned Free My TV web TV interface',
      '50U7DSE / V0000.09.62N.Q0923 adjustments','Coordinate Free My TV'+String.fromCharCode(39)+'s photo saver',
      'Isolated browser-like globals','Cobalt equivalents for unsupported web drawing APIs',
      'Own the upstream Home lifecycle','Runs after the private, unmodified vendor launcher bundle'];
    let last=-1;
    for(const marker of order){
      const at=built.candidate.indexOf(marker);
      assert.ok(at>last,'part order broke at '+marker);
      last=at;
    }
    assert.ok(!built.candidate.includes('AlvidaaNativeSettingsTheme='),'settings skin must stay out of this build');
    assert.throws(()=>web.build(path.join(dir,'stock.js'),assets,null,{expectedSha256:'deadbeef'}),{message:/wrong stock launcher revision/});
    const broken=fixtureAssets(path.join(dir,'assets-broken'));
    const manifest=JSON.parse(fs.readFileSync(path.join(broken,'assets.json'),'utf8'));
    manifest.files['f.txt']=manifest.files['f.txt'].replace(/.$/,'0');
    fs.writeFileSync(path.join(broken,'assets.json'),JSON.stringify(manifest));
    assert.throws(()=>web.build(path.join(dir,'stock.js'),broken,null,{expectedSha256:stockSha}),
      {message:/Native asset integrity mismatch/});
    const probeBuilt=probe.build(path.join(dir,'stock.js'),null,{expectedSha256:stockSha});
    assert.ok(probeBuilt.candidate.startsWith(probe.MARKER));
    assert.ok(probeBuilt.candidate.includes('ALVIDAA_PROBE_50U7DSE_V1'.slice(0,10)));
    assert.ok(probeBuilt.candidate.includes('probe-report.json'),'probe writes its report through the bridge');
    assert.ok(probeBuilt.candidate.includes('artCache/free-my-tv/probe/'),'probe assets stage under the artCache symlink');
    assert.throws(()=>probe.build(path.join(dir,'stock.js'),null,{expectedSha256:'deadbeef'}),{message:/wrong stock launcher revision/});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('the shared bundle keeps the 55A7KAU asset base when no per-build base is given',()=>{
  const {bundle}=require('./build-native-web.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alvidaa-bundle-'));
  try{
    const assets=fixtureAssets(path.join(dir,'assets'));
    const shared=bundle(assets);
    const assetId=hash(fs.readFileSync(path.join(assets,'assets.json'))).slice(0,20);
    assert.ok(shared.source.includes('file:///hisenseUI/var/local/free-my-tv/assets/'+assetId+'/'));
    const custom=bundle(assets,{assetBase:'file:///hisenseUI/var/local/artCache/free-my-tv/assets/<id>/'});
    assert.ok(custom.source.includes('file:///hisenseUI/var/local/artCache/free-my-tv/assets/'+assetId+'/'));
    assert.equal(custom.assetId,assetId);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
