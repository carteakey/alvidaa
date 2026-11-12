#!/usr/bin/env node
'use strict';
/* Builds the reversible Cobalt probe candidate for 50U7DSE / 09.62N:
 * stock bundle + probe part + shared entry, hash-checked against models.json.
 * Install/rollback through switch-home-50u7dse.sh only. Output stays private.
 */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const MODEL=require('./models.json').models['50u7dse'];
const PARTS=['probe-cobalt-50u7dse.js','native-entry.js'];
const MARKER='/* ALVIDAA_PROBE_50U7DSE_V1\n';
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function build(stockFile,output,options){
  options=options||{};
  const expected=options.expectedSha256||MODEL.stock_sha256;
  const stock=fs.readFileSync(stockFile);
  assert.equal(hash(stock),expected,'wrong stock launcher revision');
  const candidate=MARKER+'no license: read-only probe, removed after use\n*/\n'+stock+'\n;\n'+
    PARTS.map(file=>fs.readFileSync(path.join(__dirname,file),'utf8')).join('\n;\n');
  new vm.Script(candidate,{filename:'native-probe-50u7dse.js'});
  if(output){
    const target=path.resolve(output);
    const privateRoot=path.resolve(__dirname,'../../firmware')+path.sep;
    assert.ok(target.startsWith(privateRoot)||target.startsWith('/tmp/'),'Firmware-containing output must remain private');
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,candidate,{mode:0o600});
    fs.chmodSync(target,0o600);
  }
  return {candidate,sha256:hash(candidate)};
}
if(require.main===module){
  const [stock,output]=process.argv.slice(2);
  assert.ok(stock&&output,'Usage: build-native-probe-50u7dse.cjs private-stock.js private-output.js');
  const result=build(stock,output);
  console.log('Built 50U7DSE probe candidate: '+result.sha256.slice(0,16)+'… ('+Buffer.byteLength(result.candidate)+' bytes)');
}
module.exports={build,PARTS,MARKER};
