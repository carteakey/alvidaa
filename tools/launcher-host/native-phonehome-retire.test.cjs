'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const retirement=require('./retire-native-phonehome.cjs'),boot=require('./native-web-boot.cjs');
const {NativeHome}=require('./native-home.cjs'),{APP,hash}=require('./native-trial.cjs'),{PACKAGE,archive,postinst}=require('./retire-native-bridge.cjs');
function packages(){
 const code=String.raw`import ast,base64,importlib.util,io,json,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]); tree=ast.parse((root.parent/'u7q/scripts/make_installer.py').read_text())
template=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='POSTINST' for t in n.targets))
template=template.replace('@PHONE@','192.168.50.37:9000').replace('@PHONEHOST@','192.168.50.37').replace('@PHONEPORT@','9000')
a=template.index('echo "--- step: phone home ---"');b=template.index('\n} > "$D/installer_log.txt"',a)
block=template[a:b]
source='#!/bin/sh\n{\necho root-ssh-unchanged\n  echo "--- native Home: no extra launcher server ---"\n  '+block+'\n} > "$D/installer_log.txt"\nexit 0\n'
line=next(x for x in block.splitlines() if "printf '" in x)
script=line.split("printf '",1)[1].split("' >",1)[0].replace('\\n','\n')
ctrl=io.BytesIO()
with tarfile.open(fileobj=ctrl,mode='w:gz') as t:
 for name,data in [('control',b'Package: fixture\n'),('postinst',source.encode())]:
  info=tarfile.TarInfo('./'+name);info.mode=0o755;info.size=len(data);t.addfile(info,io.BytesIO(data))
out=bytearray(b'!<arch>\n')
for name,data in [('debian-binary',b'2.0\n'),('control.tar.gz',ctrl.getvalue()),('data.tar.gz',b'unchanged fixture payload')]:
 header=(name+'/').ljust(16)+'0'.ljust(12)+'0'.ljust(6)+'0'.ljust(6)+'100644'.ljust(8)+str(len(data)).ljust(10)+'\x60\n'
 out.extend(header.encode()+data+(b'\n' if len(data)%2 else b''))
def load(name):
 spec=importlib.util.spec_from_file_location(name,root/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
feed=load('patch-native-feed-bootstrap');retire=load('patch-native-phonehome');original=bytes(out);active=feed.patch(original)
print(json.dumps({k:base64.b64encode(v).decode() for k,v in {'original':original,'active':active,'safeOriginal':retire.patch(original),'safeActive':retire.patch(active),'script':script.encode()}.items()}))`;
 const values=JSON.parse(cp.execFileSync('python3',['-c',code,__dirname],{encoding:'utf8'}));return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Buffer.from(v,'base64')]));
}
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-retire-phonehome-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=new NativeHome({root}),p=packages();fs.mkdirSync(home.state,{recursive:true});
 for(const file of [APP,PACKAGE,retirement.SCRIPT])fs.mkdirSync(path.dirname(home.p(file)),{recursive:true});
 fs.writeFileSync(home.p(APP),'ALVIDAA_FREE_MY_TV_WEB_PARITY_V2');const expectedHome=hash(fs.readFileSync(home.p(APP)));
 home.save({phase:'installed',files:[{file:APP,trial:expectedHome}]});fs.writeFileSync(home.p(PACKAGE),p.active,{mode:0o640});fs.writeFileSync(home.p(retirement.SCRIPT),p.script,{mode:0o755});
 const live=path.join(home.state,'web-feed-boot');fs.mkdirSync(live);fs.writeFileSync(path.join(live,'installer.orig'),p.original);
 const st=fs.statSync(home.p(PACKAGE));fs.writeFileSync(path.join(live,'state.json'),JSON.stringify({phase:'installed',original:hash(p.original),updated:hash(p.active),uid:st.uid,gid:st.gid,mode:st.mode}));
 const candidate=path.join(root,'safe.ipk'),base=path.join(root,'base.ipk');fs.writeFileSync(candidate,p.safeActive);fs.writeFileSync(base,p.safeOriginal);
 return {home,p,candidate,base,expectedHome,apply:ops=>retirement.apply(home,candidate,base,expectedHome,hash(p.active),{ready(){},...ops})};
}
test('phonehome retirement preserves payloads and makes normal feed teardown stay retired',t=>{
 const f=setup(t);retirement.validate(f.p.active,f.p.safeActive);assert.equal(f.apply(),'retired');
 assert.deepEqual(archive(f.p.active)['data.tar.gz'],archive(f.p.safeActive)['data.tar.gz']);
 assert.equal(fs.existsSync(f.home.p(retirement.SCRIPT)),false);
 const old=path.join(f.home.state,'retired-phonehome/old-boot/installer.orig');assert.deepEqual(fs.readFileSync(old),f.p.original);
 assert.equal(boot.restore(f.home),'restored');assert.deepEqual(fs.readFileSync(f.home.p(PACKAGE)),f.p.safeOriginal);
 assert.ok(postinst(archive(f.p.safeOriginal)['control.tar.gz']).includes('ALVIDAA_PHONEHOME_RETIRED_V1'));
});
test('independent retirement restoration preserves exact original files and never executes them',t=>{
 const f=setup(t);f.apply();assert.match(retirement.restore(f.home),/no process started/);
 assert.deepEqual(fs.readFileSync(f.home.p(PACKAGE)),f.p.active);assert.deepEqual(fs.readFileSync(f.home.p(retirement.SCRIPT)),f.p.script);
 assert.equal(fs.statSync(f.home.p(PACKAGE)).mode&0o777,0o640);assert.match(retirement.restore(f.home),/restored/);
});
test('journal-migration interruption is recoverable without deleting historical backups',t=>{
 const f=setup(t);assert.throws(()=>f.apply({afterMove(){throw Error('simulated interruption');}}),/retain retired-phonehome/);
 assert.match(retirement.restore(f.home),/restored/);assert.deepEqual(fs.readFileSync(f.home.p(PACKAGE)),f.p.active);
});
test('unknown scripts, stale state and concurrent edits fail without overwriting them',t=>{
 const f=setup(t);fs.writeFileSync(f.home.p(retirement.SCRIPT),'unrecognized script');assert.throws(()=>f.apply(),/Legacy script changed/);
 fs.writeFileSync(f.home.p(retirement.SCRIPT),f.p.script);f.apply();fs.writeFileSync(f.home.p(PACKAGE),'concurrent installer');
 assert.throws(()=>retirement.restore(f.home),/Concurrent bootstrap/);assert.equal(fs.readFileSync(f.home.p(PACKAGE),'utf8'),'concurrent installer');
 assert.throws(()=>retirement.transform('unknown startup'),/Unknown/);
});
