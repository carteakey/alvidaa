#!/usr/bin/env node
'use strict';
/* Offline icon-lift snapshot generator for no-worker deployments
 * (50U7DSE / 09.62N first, any artCache-lane build after).
 *
 * The upstream Free My TV design "lifts" every shelf logo: the icon's
 * background is measured and taken away, the remaining logo is cropped and
 * rendered over the tile's brand gradient (web/home.js lift()). On TV that
 * analysis runs in the feed worker's native-image processor, because Cobalt
 * has no canvas readback. This tool runs the worker's own image pipeline
 * (native-feed-images.cjs + the native-image binary) against icons pulled
 * read-only from the TV, and emits exactly what the runtime polls every
 * second: a snapshot.json whose media entries carry the lifted-logo
 * references, plus the media files to stage under the artCache lane.
 *
 * The snapshot carries no feed data (cache stays empty, keyConfigured
 * false): prefs live in the runtime's storage/context, not here, so a
 * static snapshot never resets them. Stage outputs, then restart the
 * launcher once: upstream's lifted[] cache must be cold for the first
 * face() render to consult the snapshot (a hot snapshot only helps after a
 * remount).
 *
 * WebP icons are converted to PNG first (the on-TV worker cannot decode
 * WebP; this offline pass can, so every tile gets the same treatment).
 *
 * Usage:
 *   build-icon-snapshot-50u7dse.cjs context.json icon-dir native-image \
 *     media-dir snapshot.json
 *   context.json: the runtime's /APPS/free-my-tv/context.json, pulled from
 *     the TV (apps + icon URLs)
 *   icon-dir: the storeAppIcon files (pulled read-only, named by UUID)
 *   native-image: a native-image build for THIS host (the same Go source
 *     that ships to the TV)
 *   media-dir: created; stage it under
 *     /APPS/hisenseUI_applications/UI/art/cache/free-my-tv/media/
 *   snapshot.json: stage at /APPS/free-my-tv/snapshot.json (mode 0644)
 */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createMedia}=require('./native-feed-images.cjs');
const URI_BASE='file:///hisenseUI/var/local/artCache/free-my-tv/media/';
const STORE_APP_ICON='file:///hisenseUI/var/local/storeAppIcon/';
async function main(){
  const [contextFile,iconRoot,processor,mediaDir,outFile]=process.argv.slice(2);
  assert.ok(contextFile&&iconRoot&&processor&&mediaDir&&outFile,
    'Usage: build-icon-snapshot-50u7dse.cjs context.json icon-dir native-image media-dir snapshot.json');
  const context=JSON.parse(fs.readFileSync(contextFile,'utf8'));
  assert.equal(context.version,1,'context must come from the runtime');
  assert.ok(Array.isArray(context.apps)&&context.apps.length>0&&context.apps.length<=512,'no apps in context');
  const apps=[];
  const seen=new Set();
  for(const app of context.apps){
    if(typeof app.icon!=='string')continue;
    assert.ok(app.icon.startsWith(STORE_APP_ICON),'unexpected icon namespace: '+app.icon);
    const relative=app.icon.slice(STORE_APP_ICON.length);
    assert.ok(relative&&!relative.includes('%')&&!relative.split('/').includes('..'),'unsafe icon reference');
    if(seen.has(app.icon))continue;
    seen.add(app.icon);
    apps.push({id:app.id,title:app.title,icon:app.icon});
  }
  assert.ok(apps.length>0,'no shelf icons to lift');
  const media=createMedia({directory:mediaDir,iconRoot:path.resolve(iconRoot),
    uriBase:URI_BASE,processor:path.resolve(processor)});
  const render=await media.update({apps},{});
  media.collect();
  const lifted=Object.values(render.media).filter(value=>value&&value.lift).length;
  const raw=Object.keys(render.media).filter(key=>key.startsWith(STORE_APP_ICON)).length;
  assert.ok(raw===apps.length,'icon pipeline dropped entries: '+raw+'/'+apps.length);
  assert.ok(lifted>0,'no logos were lifted');
  const snapshot={version:1,cache:{},error:'',keyConfigured:false,
    images:render.images,media:render.media,imageFailures:render.imageFailures};
  fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});
  fs.writeFileSync(outFile,JSON.stringify(snapshot));
  console.log('Lifted '+lifted+'/'+apps.length+' shelf logos; media entries: '+
    Object.keys(render.media).length+'; failures: '+render.imageFailures);
  console.log('Stage '+mediaDir+' under the artCache free-my-tv/media/ lane and '+
    outFile+' at /APPS/free-my-tv/snapshot.json, then restart the launcher once.');
}
main().catch(error=>{console.error(error.message);process.exit(1);});
