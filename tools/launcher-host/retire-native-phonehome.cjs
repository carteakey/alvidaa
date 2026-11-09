#!/usr/bin/env node
'use strict';
// One verified legacy revision only. Preserve SSH and every old recovery byte.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeHome,acquire}=require('./native-home.cjs');
const {APP,hash,atomicWrite}=require('./native-trial.cjs');
const {archive,controlFiles,postinst,PACKAGE}=require('./retire-native-bridge.cjs');
const boot=require('./native-web-boot.cjs');
const SCRIPT='/APPS/.re_sshd/phonehome.sh';
const BLOCK_HASH='72259468b9c057bb3f11b36f7ef3c6ac35725e857aea1ab09999f9bbbc4f52be';
const SCRIPT_HASH='63474ddd13c49dde5e2ddcefd613d6a9b7b26d1955a22e78a87ceb49330bd837';
const CONTROL=['retire-native-phonehome.cjs','native-home.cjs','native-trial.cjs','native-update.cjs','stock-ui-restart.cjs','retire-native-bridge.cjs','native-web-boot.cjs','native-feed-boot.sh'];
function transform(source){
 const marker='echo "--- step: phone home ---"',end='\n} > "$D/installer_log.txt"';
 const a=source.indexOf(marker),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a&&source.lastIndexOf(marker)===a,'Unknown phonehome bootstrap');
 assert.equal(hash(Buffer.from(source.slice(a,b))),BLOCK_HASH,'Unknown phonehome fragment');
 return source.slice(0,a)+marker+'\n  # ALVIDAA_PHONEHOME_RETIRED_V1: root SSH is the recovery lane.'+source.slice(b);
}
function validate(before,after){
 const a=archive(before),b=archive(after);assert.deepEqual(Object.keys(a),Object.keys(b),'Package layout changed');
 for(const key of Object.keys(a))if(key!=='control.tar.gz')assert.ok(a[key].equals(b[key]),'Root payload changed');
 const x=controlFiles(a['control.tar.gz']),y=controlFiles(b['control.tar.gz']);assert.deepEqual(Object.keys(x),Object.keys(y),'Control layout changed');
 for(const key of Object.keys(x)){assert.equal(x[key].metadata,y[key].metadata,'Control permissions changed');if(key!=='postinst')assert.ok(x[key].body.equals(y[key].body),'Control data changed');}
 assert.equal(postinst(b['control.tar.gz']),transform(postinst(a['control.tar.gz'])),'Unexpected bootstrap change');
}
function ready(){
 const tcp=fs.readFileSync('/proc/net/tcp','utf8').split('\n').map(x=>x.trim().split(/\s+/));
 assert.ok(tcp.some(x=>x[3]==='0A'&&x[1].endsWith(':1F48')),'Root SSH must remain listening');
 assert.ok(!tcp.some(x=>x[2]==='2532A8C0:2328'),'Legacy reverse connection is still present');
 for(const id of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
  let args;try{args=fs.readFileSync('/proc/'+id+'/cmdline').toString().split('\0');}catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')continue;throw error;}
  assert.ok(!args.some(x=>x===SCRIPT||x.endsWith('/phonehome.sh')),'Stop the owned phonehome process before retirement');
 }
}
function bytes(file){const s=fs.lstatSync(file);assert.ok(s.isFile()&&!s.isSymbolicLink(),'Unexpected recovery file type');return fs.readFileSync(file);}
function readJournal(file){
 try{const value=JSON.parse(bytes(file));assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value;}
 catch{throw new Error('Invalid retirement recovery journal');}
}
function privateCopy(file,data){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(dir,m){atomicWrite(path.join(dir,'state.json'),Buffer.from(JSON.stringify(m,null,2)),{uid:process.getuid(),gid:process.getgid(),mode:0o600});}
function checkHome(home,expected){const state=home.load();assert.equal(state.phase,'installed','Unstable Home');const current=hash(bytes(home.p(APP)));assert.equal(current,expected,'Concurrent Home edit');assert.equal(current,state.files.find(x=>x.file===APP).trial,'Home ownership changed');}
function apply(home,candidate,base,expectedHome,expectedBootstrap,ops={}){
 const check=ops.ready||ready;check();checkHome(home,expectedHome);
 const packageFile=home.p(PACKAGE),before=bytes(packageFile),updated=bytes(candidate),original=bytes(base),meta=fs.statSync(packageFile);
 assert.equal(hash(before),expectedBootstrap,'Concurrent bootstrap edit');
 const live=path.join(home.state,'web-feed-boot'),oldState=bytes(path.join(live,'state.json')),old=readJournal(path.join(live,'state.json')),oldOriginal=bytes(path.join(live,'installer.orig'));
 assert.ok(['uid','gid','mode'].every(k=>old[k]===meta[k]),'Bootstrap permissions changed');
 assert.equal(old.phase,'installed','Bootstrap recovery is not stable');assert.equal(hash(oldOriginal),old.original,'Bootstrap backup changed');assert.equal(hash(before),old.updated,'Bootstrap ownership changed');
 assert.deepEqual(fs.readdirSync(live).sort(),['installer.orig','state.json'],'Unexpected bootstrap journal files');
 validate(before,updated);validate(oldOriginal,original);boot.validate(original,updated);
 let script=null;if(fs.existsSync(home.p(SCRIPT))){const data=bytes(home.p(SCRIPT)),s=fs.statSync(home.p(SCRIPT));assert.equal(hash(data),SCRIPT_HASH,'Legacy script changed');script={sha256:hash(data),uid:s.uid,gid:s.gid,mode:s.mode};}
 const free=fs.statfsSync(home.state);assert.ok(free.bavail*free.bsize>=64*1024*1024+4*(before.length+original.length)+4*1024*1024,'64 MiB reserve would be endangered');
 const dir=path.join(home.state,'retired-phonehome');fs.mkdirSync(dir,{mode:0o700});
 const m={phase:'prepared',expectedHome,before:hash(before),after:hash(updated),oldOriginal:old.original,oldState:hash(oldState),safeOriginal:hash(original),uid:meta.uid,gid:meta.gid,mode:meta.mode,script};
 privateCopy(path.join(dir,'installer.before'),before);
 if(script)privateCopy(path.join(dir,'phonehome.disabled'),bytes(home.p(SCRIPT)));
 const control=path.join(dir,'control');fs.mkdirSync(control,{mode:0o700});for(const name of CONTROL)privateCopy(path.join(control,name),bytes(path.join(__dirname,name)));
 const next=path.join(dir,'new-boot');fs.mkdirSync(next,{mode:0o700});privateCopy(path.join(next,'installer.orig'),original);
 const nextState={...old,original:hash(original),updated:hash(updated)};privateCopy(path.join(next,'state.json'),JSON.stringify(nextState,null,2));
 m.safeState=hash(bytes(path.join(next,'state.json')));save(dir,m);
 try{
  checkHome(home,expectedHome);assert.equal(hash(bytes(packageFile)),m.before,'Concurrent bootstrap edit');
  assert.equal(hash(bytes(path.join(live,'state.json'))),m.oldState,'Concurrent recovery edit');assert.equal(hash(bytes(path.join(live,'installer.orig'))),m.oldOriginal,'Bootstrap backup changed');
  fs.renameSync(live,path.join(dir,'old-boot'));if(ops.afterMove)ops.afterMove();
  fs.renameSync(next,live);atomicWrite(packageFile,updated,m);
  check();if(script){assert.equal(hash(bytes(home.p(SCRIPT))),script.sha256,'Concurrent legacy script edit');fs.unlinkSync(home.p(SCRIPT));}
  m.phase='retired';save(dir,m);return m.phase;
 }catch(error){m.phase='needs-recovery';save(dir,m);throw new Error(error.message+'; retain retired-phonehome journal and use its independent restore controller');}
}
function restore(home){
 const dir=path.join(home.state,'retired-phonehome'),m=readJournal(path.join(dir,'state.json')),live=path.join(home.state,'web-feed-boot'),old=path.join(dir,'old-boot');
 assert.ok(['prepared','needs-recovery','retired','restored'].includes(m.phase)&&['expectedHome','before','after','oldOriginal','oldState','safeOriginal','safeState'].every(k=>typeof m[k]==='string'&&/^[a-f0-9]{64}$/.test(m[k])),'Invalid retirement identity');
 assert.ok(['uid','gid','mode'].every(k=>Number.isSafeInteger(m[k])&&m[k]>=0),'Invalid retirement permissions');
 if(m.script)assert.ok(m.script.sha256===SCRIPT_HASH&&['uid','gid','mode'].every(k=>Number.isSafeInteger(m.script[k])&&m.script[k]>=0),'Invalid script recovery record');
 checkHome(home,m.expectedHome);const current=hash(bytes(home.p(PACKAGE)));assert.ok(current===m.before||current===m.after,'Concurrent bootstrap edit');
 const before=bytes(path.join(dir,'installer.before'));assert.equal(hash(before),m.before,'Retirement backup changed');
 const oldDir=fs.existsSync(old)?old:live;
 assert.equal(hash(bytes(path.join(oldDir,'installer.orig'))),m.oldOriginal,'Historical bootstrap backup changed');assert.equal(hash(bytes(path.join(oldDir,'state.json'))),m.oldState,'Historical recovery journal changed');
 if(fs.existsSync(old)&&fs.existsSync(live)){assert.equal(hash(bytes(path.join(live,'installer.orig'))),m.safeOriginal,'Concurrent safe backup edit');assert.equal(hash(bytes(path.join(live,'state.json'))),m.safeState,'Concurrent safe journal edit');}
 if(m.script){assert.equal(hash(bytes(path.join(dir,'phonehome.disabled'))),m.script.sha256,'Script backup changed');if(fs.existsSync(home.p(SCRIPT)))assert.equal(hash(bytes(home.p(SCRIPT))),m.script.sha256,'Concurrent script edit');}
 if(fs.existsSync(old)){if(fs.existsSync(live))fs.renameSync(live,path.join(dir,'safe-boot-restored'));fs.renameSync(old,live);}
 atomicWrite(home.p(PACKAGE),before,m);
 if(m.script&&!fs.existsSync(home.p(SCRIPT)))atomicWrite(home.p(SCRIPT),bytes(path.join(dir,'phonehome.disabled')),m.script);
 m.phase='restored';save(dir,m);return 'restored; legacy startup restored but no process started';
}
if(require.main===module){try{assert.equal(process.getuid(),0,'Root SSH required');const [command,candidate,base,expectedHome,expectedBootstrap]=process.argv.slice(2),home=new NativeHome(),release=acquire(home.state);try{if(command==='apply')console.log(apply(home,candidate,base,expectedHome,expectedBootstrap));else if(command==='restore')console.log(restore(home));else throw Error('Use apply updated.ipk base.ipk home-sha bootstrap-sha | restore');}finally{release();}process.exit(0);}catch(error){console.error(error.message);process.exit(1);}}
module.exports={transform,validate,apply,restore,ready,SCRIPT,CONTROL};
