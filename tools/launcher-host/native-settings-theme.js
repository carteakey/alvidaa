/* Presentation only: retain the vendor settings component, children, routes,
 * model bindings, focus handlers, PINs and confirmations. No SDK replacement. */
(function(root){
  'use strict';
  function install(host){
    var registry=host._V_M_,descriptor=registry&&Object.getOwnPropertyDescriptor(registry,'setting');
    if(!registry||(descriptor&&(!descriptor.configurable||!descriptor.writable||descriptor.get||descriptor.set)))return null;
    var current=descriptor&&descriptor.value,wrapped=null,original=null,entries=[],routes=[],disposed=false;
    var prefix='.settingContent.fmtv-advanced.fmtv-advanced';
    function corners(radius){return ['top-left','top-right','bottom-right','bottom-left'].map(function(c){return 'border-'+c+'-radius:'+radius+';';}).join('');}
    var css=prefix+'{background:linear-gradient(135deg,#1c2228,#15191e)!important;color:#f5f5f7;}'+
      prefix+' .firstLevelFrame{background:rgba(255,255,255,.035)!important;}'+
      prefix+' .highLevelContent{background:transparent!important;}'+
      prefix+' .highLevelFrame:before,'+prefix+' .highLevelFrame:after{background-color:rgba(255,255,255,.09)!important;}'+
      prefix+' .edgeshadow{box-shadow:none!important;}'+
      ['.firstText','.highLevelTitle','.item__txt','.s_item_title','.s_double_title_2','.explainTxt','.esntext'].map(function(selector){return prefix+' '+selector+'{font-family:"FMTVWeb32",sans-serif!important;}';}).join('')+
      prefix+' .highLevelTitle{font-weight:700;letter-spacing:-.01em;}'+
      prefix+' #v-focus{background:rgba(255,255,255,.11)!important;box-shadow:inset 0 0 0 2px rgba(255,255,255,.28)!important;'+corners('18px')+'}'+
      prefix+' .v-i-selected{color:#31d5b2;}';
    function ensureStyle(){
      if(disposed||host.document.getElementById('alvidaa-settings-style'))return;
      var style=host.document.createElement('style');style.id='alvidaa-settings-style';
      style.textContent=(!host.document.getElementById('alvidaa-web-styles')&&host.AlvidaaNativeWebBundle?host.AlvidaaNativeWebBundle.fontCSS:'')+css;
      host.document.head.appendChild(style);
    }
    function decorate(component){
      if(disposed||!component)return component;
      if(component.default){decorate(component.default);return component;}
      var options=component.options||component;
      if(typeof options.render!=='function'||entries.some(function(e){return e.options===options;}))return component;
      var before=options.render;
      function render(){
        ensureStyle();var vnode=before.apply(this,arguments);
        if(vnode){vnode.data=vnode.data||{};vnode.data.class=[vnode.data.class,'fmtv-advanced'];}
        return vnode;
      }
      options.render=render;entries.push({options:options,before:before,after:render});
      if(options._Ctor)Object.keys(options._Ctor).forEach(function(key){decorate(options._Ctor[key]);});
      return component;
    }
    function wrap(factory){
      if(typeof factory!=='function')return factory;
      if(original===factory)return wrapped;
      original=factory;
      wrapped=function(){
        var stock=factory.apply(this,arguments);
        (stock&&stock.route||[]).forEach(function(route){
          if(route.path!=='/setting/settings'||routes.some(function(e){return e.route===route;}))return;
          var before=route.component;
          function load(){
            var value=before.apply(this,arguments);
            return value&&typeof value.then==='function'?value.then(decorate):decorate(value);
          }
          if(typeof before==='function'&&!before.options){route.component=load;routes.push({route:route,before:before,after:load});}
          else decorate(before);
        });
        return stock;
      };
      return wrapped;
    }
    function get(){return wrap(current);}
    Object.defineProperty(registry,'setting',{configurable:true,enumerable:descriptor?descriptor.enumerable:true,get:get,set:function(value){current=value;}});
    // A previously loaded factory returns its cached module; decorate that same
    // route object too, rather than replacing a controller already registered.
    if(typeof current==='function'){
      wrap(current)();
      // The router may already have copied the original lazy-loader reference.
      // Resolve that same local module and decorate its exported component;
      // this mounts nothing and leaves all route guards in place.
      routes.forEach(function(entry){
        try{
          var value=entry.before();
          if(value&&typeof value.then==='function')value.then(decorate,function(){});
          else decorate(value);
        }catch{/* Keep native routing available; a later load can retry. */}
      });
    }
    return {remove:function(){
      if(disposed)return;disposed=true;
      routes.forEach(function(e){if(e.route.component===e.after)e.route.component=e.before;});
      entries.forEach(function(e){if(e.options.render===e.after)e.options.render=e.before;});
      var own=Object.getOwnPropertyDescriptor(registry,'setting');
      if(own&&own.get===get){
        if(descriptor)Object.defineProperty(registry,'setting',{configurable:descriptor.configurable,enumerable:descriptor.enumerable,writable:descriptor.writable,value:current});
        else if(current===undefined)delete registry.setting;
        else Object.defineProperty(registry,'setting',{configurable:true,enumerable:true,writable:true,value:current});
      }
      var style=host.document.getElementById('alvidaa-settings-style');if(style&&style.parentNode)style.parentNode.removeChild(style);
    }};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=install;
  else root.AlvidaaNativeSettingsTheme=install(root);
}(typeof self!=='undefined'?self:this));
