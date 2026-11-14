#!/usr/bin/env node
'use strict';
/* Free My TV web-port builder for 50U7DSE / V0000.09.62N.Q0923 (SystemUI,
 * MTK9618). Reuses the pinned upstream program and the shared web parts;
 * only the per-build facts differ from the 55A7KAU builder:
 *   - the stock hash comes from models.json (single source of truth),
 *   - the platform adapter is the 75U8QTUK one (this build's SDK contracts
 *     are the same family; verified by the running 75U8QTUK-family V1),
 *   - native-web-50u7dse.js supplies the zone constant and vendor icon
 *     policy,
 *   - the settings skin is deliberately NOT included: TV Settings stays the
 *     stock vendor surface on this build until a separate verified pass.
 * Assets stage on the TV under the vendor artCache symlink (see the part
 * file), so the asset base differs from 55A7KAU. Output stays private
 * (firmware/ or /tmp), mode 0600. Nothing here rewrites vendor bytes.
 */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {bundle}=require('./build-native-web.cjs');
const MODEL=require('./models.json').models['50u7dse'];
const ASSET_BASE='file:///hisenseUI/var/local/artCache/free-my-tv/assets/<id>/';
const PARTS=['native-platform-75u8qtuk.js','native-web-tv.js','native-web-50u7dse.js',
  'native-web-screensaver.js','native-web-scope.js','native-web-compat.js','native-web-runtime.js','native-entry.js'];
// The feed worker watches the installed Home file for this exact marker.
const MARKER='/* ALVIDAA_FREE_MY_TV_NATIVE_V1; ALVIDAA_FREE_MY_TV_WEB_PARITY_V2\n';
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function build(stockFile,assetsDirectory,output,options){
  options=options||{};
  const expected=options.expectedSha256||MODEL.stock_sha256;
  assert.ok(MODEL.app.endsWith('/launcher/js/app.js'),'model bundle path moved');
  const stock=fs.readFileSync(stockFile);
  assert.equal(hash(stock),expected,'wrong stock launcher revision');
  const web=bundle(assetsDirectory,{assetBase:options.assetBase||ASSET_BASE});
  const license=fs.readFileSync(path.join(__dirname,'third-party/free-my-tv/LICENSE'),'utf8');
  const candidate=MARKER+license+'\n*/\n'+stock+'\n;\n'+web.source+
    PARTS.map(file=>fs.readFileSync(path.join(__dirname,file),'utf8')).join('\n;\n');
  new vm.Script(candidate,{filename:'native-web-50u7dse-candidate.js'});
  if(output){
    const target=path.resolve(output);
    const privateRoot=path.resolve(__dirname,'../../firmware')+path.sep;
    assert.ok(target.startsWith(privateRoot)||target.startsWith('/tmp/'),'vendor-containing output must stay private');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,candidate,{mode:0o600});
    fs.chmodSync(target,0o600);
  }
  return {candidate,assetId:web.assetId,sha256:hash(candidate)};
}
if(require.main===module){
  const [stock,assets,output]=process.argv.slice(2);
  assert.ok(stock&&assets&&output,'Usage: build-native-web-50u7dse.cjs private-stock.js asset-directory private-output.js');
  const result=build(stock,assets,output);
  console.log('Built 50U7DSE web candidate: '+result.sha256.slice(0,16)+'… assets: '+result.assetId);
}
module.exports={build,PARTS,MARKER,ASSET_BASE,MODEL};
