'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const install=require('./native-settings-theme.js');
function host(factory){
 const nodes=new Map();const head={appendChild(node){nodes.set(node.id,node);node.parentNode=head;},removeChild(node){nodes.delete(node.id);}};
 return {_V_M_:factory?{setting:factory}:{},document:{head,createElement(){return {};},getElementById(id){return nodes.get(id);}},AlvidaaNativeWebBundle:{fontCSS:'/* test font faces */'}};
}
test('settings skin preserves factory identity, route guards, native children and handlers',async()=>{
 const children=[{component:'first-level'},{component:'high-level'}],handler=()=>{},guard=()=>{},init=()=>{};
 const component={name:'settings',methods:{handleKeydown:handler},render(){return {data:{class:['settingContent',{settingMainMove:true}],on:{'key-down':handler}},children};}};
 const originalRender=component.render,other=()=>Promise.resolve({});
 const exported={};Object.defineProperty(exported,'default',{get:()=>component});
 const loader=()=>Promise.resolve(exported),meta={vk:'T'};
 const route={path:'/setting/settings',component:loader,beforeEnter:guard,meta};
 const stock={init,route:[route,{path:'/setting/Subtitle',component:other}]};
 const factory=()=>stock,h=host(factory),theme=install(h);
 assert.equal(h._V_M_.setting(),stock);assert.equal(stock.init,init);assert.equal(route.beforeEnter,guard);assert.equal(route.meta,meta);
 assert.equal(stock.route[1].component,other);assert.equal(await route.component(),exported);
 const node=component.render();assert.equal(node.children,children);assert.equal(node.children.length,2);
 assert.equal(node.data.on['key-down'],handler);assert.equal(component.methods.handleKeydown,handler);
 assert.deepEqual(node.data.class,[['settingContent',{settingMainMove:true}],'fmtv-advanced']);
 const css=h.document.getElementById('alvidaa-settings-style').textContent;
 assert.ok(css.includes('FMTVWeb32'));assert.ok(!/\b(?:display|visibility|position|transform|opacity|width|height|z-index)\s*:/.test(css));
 theme.remove();assert.equal(route.component,loader);assert.equal(component.render,originalRender);assert.equal(h._V_M_.setting,factory);
 assert.equal(h.document.getElementById('alvidaa-settings-style'),undefined);
});
test('late-loaded settings factories keep their calling convention and survive teardown',async()=>{
 const h=host(),theme=install(h);let received;
 const component={render(){return {children:[]};}},stock={route:[{path:'/setting/settings',component:()=>Promise.resolve(component)}]};
 function factory(value){received=[this,value];return stock;}
 h._V_M_.setting=factory;assert.equal(h._V_M_.setting('native'),stock);assert.deepEqual(received,[h._V_M_,'native']);
 await stock.route[0].component();assert.ok(component.render().data.class.includes('fmtv-advanced'));
 theme.remove();assert.equal(h._V_M_.setting,factory);assert.equal(Object.getOwnPropertyDescriptor(h._V_M_,'setting').get,undefined);
});
test('an in-flight local module load cannot reapply the theme after teardown',async()=>{
 let resolve;const promise=new Promise(r=>{resolve=r;});const component={render(){return {children:[]};}},original=component.render;
 const stock={route:[{path:'/setting/settings',component:()=>promise}]},h=host(()=>stock),theme=install(h);
 const pending=stock.route[0].component();theme.remove();resolve({default:component});await pending;
 assert.equal(component.render,original);assert.equal(h.document.getElementById('alvidaa-settings-style'),undefined);
});
test('unknown registry descriptors are left untouched',()=>{
 const h=host();Object.defineProperty(h._V_M_,'setting',{value:()=>({}),configurable:false});
 assert.equal(install(h),null);
});
