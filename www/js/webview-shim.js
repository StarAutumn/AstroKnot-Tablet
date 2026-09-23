// ============================================================
// AstroKnot Tablet - webview-shim.js  Electron <webview> → iframe 适配器（平板专属）
//
// 目标：桌面 BrowserApp 零改动跑在平板上（窗口化布局、多标签、地址栏、
//       书签、历史、搜索、设置全部复用），仅网页渲染层换成 iframe。
// 原理：劫持 document.createElement('webview')，返回挂了 Electron webview
//       API 表面的 iframe（方法 + 事件模拟）。
//
// 起始页：桌面 NEWTAB_URL 是 https://www.bing.com（Bing 拒绝 iframe 必白屏），
//         适配器把 about:blank / bing.com 首页 拦截为内建起始页（srcdoc，同源）：
//         时钟 + 搜索框（提交走原生页，主流搜索引擎全拒绝 iframe）+ 常用网站磁贴
//         （<a> 导航走 iframe，load 事件同步真实 URL 进桌面链路）。
//
// 能力矩阵（相对桌面）：
//   ✓ 多标签/切换、地址栏、自维护后退/前进栈、刷新、起始页
//   ✓ did-navigate/dom-ready/did-start-loading/did-stop-loading/page-title-updated
//     （跨域页面标题用域名兜底）
//   ✓ executeJavaScript：同源（含起始页）可用；跨域 reject
//   ✗ favicon、右键菜单、页内缩放、截图：不派发/空实现
//   ✗ 被网站 X-Frame-Options 拒绝时白屏（无法检测）→ 状态栏「原生」按钮兜底
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;

  function hostOf(u) {
    try { return new URL(u).host || u; } catch (e) { return u; }
  }

  // ── 内建起始页（srcdoc，同源 → contentDocument 可读、可调父页函数）──
  const HOME_TITLE = '起始页';
  const HOME_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + HOME_TITLE + '</title><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%}' +
    'body{font-family:"Segoe UI",system-ui,sans-serif;background:linear-gradient(160deg,#0a1220 0%,#0e1621 55%,#12202e 100%);' +
    'color:#cfe3ee;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;overflow:hidden}' +
    '.clock{font-size:44px;font-weight:300;letter-spacing:2px;color:#e8f4fa}' +
    '.date{font-size:13px;color:#5a7a8f;margin-top:-18px}' +
    '.logo{font-size:15px;color:#5ee8ff;letter-spacing:6px;opacity:.85}' +
    '.search{display:flex;width:min(560px,80%);height:46px;border-radius:23px;background:#1a2634;' +
    'border:1px solid #2a3d52;box-shadow:0 4px 24px rgba(0,0,0,.35);overflow:hidden}' +
    '.search:focus-within{border-color:#5ee8ff;box-shadow:0 0 0 3px rgba(94,232,255,.15)}' +
    '.search input{flex:1;height:100%;background:transparent;border:0;outline:0;color:#e8f4fa;' +
    'font-size:14px;padding:0 20px}' +
    '.search input::placeholder{color:#5a6b7d}' +
    '.search button{width:64px;border:0;background:#0b4551;color:#5ee8ff;font-size:14px;cursor:pointer}' +
    '.search button:hover{background:#0d5666}' +
    '.tiles{display:grid;grid-template-columns:repeat(4,88px);gap:14px}' +
    '.tile{display:flex;flex-direction:column;align-items:center;gap:8px;text-decoration:none;color:#a8c5d8;' +
    'padding:12px 4px;border-radius:12px;background:rgba(26,38,52,.6);border:1px solid #22354a;' +
    'transition:transform .15s,border-color .15s}' +
    '.tile:hover{transform:translateY(-3px);border-color:#5ee8ff;color:#e8f4fa}' +
    '.tile .ic{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;' +
    'font-size:18px;font-weight:700;color:#fff}' +
    '.tile .nm{font-size:12px}' +
    '.tip{font-size:11px;color:#48607a}' +
    '</style></head><body>' +
    '<div class="logo">ASTROKNOT</div>' +
    '<div><div class="clock" id="ck">--:--</div><div class="date" id="dt"></div></div>' +
    '<div class="search"><input id="q" placeholder="搜索（将用原生页打开结果）" autofocus>' +
    '<button id="go">搜索</button></div>' +
    '<div class="tiles">' +
    tile('Bing', '#0d8f8f', 'https://www.bing.com') +
    tile('百度', '#2932e1', 'https://www.baidu.com') +
    tile('GitHub', '#24292f', 'https://github.com') +
    tile('B站', '#fb7299', 'https://www.bilibili.com') +
    tile('知乎', '#0084ff', 'https://www.zhihu.com') +
    tile('微博', '#e6162d', 'https://weibo.com') +
    tile('淘宝', '#ff5000', 'https://www.taobao.com') +
    tile('京东', '#e1251b', 'https://www.jd.com') +
    '</div>' +
    '<div class="tip">磁贴在窗口内打开 · 白屏时点工具栏「原生」· 搜索用原生页</div>' +
    '<script>' +
    'function tk(){var d=new Date();var p=function(n){return (n<10?"0":"")+n};' +
    'document.getElementById("ck").textContent=p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());' +
    'var wd="日一二三四五六"[d.getDay()];' +
    'document.getElementById("dt").textContent=d.getFullYear()+"年"+(d.getMonth()+1)+"月"+d.getDate()+"日 星期"+wd;}' +
    'setInterval(tk,1000);tk();' +
    'function doSearch(){var v=document.getElementById("q").value.trim();if(!v)return;' +
    'var u=/^[\\w-]+(\\.[\\w-]+)+/.test(v)?"https://"+v:"https://www.bing.com/search?q="+encodeURIComponent(v);' +
    'if(window.parent&&window.parent.__tabletNativeOpen){window.parent.__tabletNativeOpen(u);}' +
    'else{location.href=u;}}' +
    'document.getElementById("go").addEventListener("click",doSearch);' +
    'document.getElementById("q").addEventListener("keydown",function(e){if(e.key==="Enter")doSearch();});' +
    // ── 右键/长按捕获 → 桌面 context-menu 事件链路 ──
    'function collect(e){var t=e.target;' +
    'var a=t&&t.closest?t.closest("a"):null;' +
    'var img=t&&t.closest?t.closest("img"):null;' +
    'var sel="";try{sel=String(getSelection()).slice(0,2000)}catch(_){}' +
    'var p={x:e.clientX||0,y:e.clientY||0,ts:Date.now()};' +
    'if(a)p.linkURL=a.href;' +
    'if(img){p.mediaType="image";p.srcURL=img.src;}' +
    'if(sel)p.selectionText=sel;' +
    'window.__astroknotCtxPos=p;return p;}' +
    'document.addEventListener("contextmenu",function(e){e.preventDefault();' +
    'var p=collect(e);if(frameElement&&frameElement._emitContextMenu)frameElement._emitContextMenu(p);},true);' +
    'var lp=null;' +
    'document.addEventListener("touchstart",function(e){if(e.touches.length!==1)return;' +
    'var t=e.touches[0];lp={x:t.clientX,y:t.clientY,target:e.target,timer:setTimeout(function(){' +
    'if(!lp)return;var p=collect({target:lp.target,clientX:lp.x,clientY:lp.clientY});' +
    'if(frameElement&&frameElement._emitContextMenu)frameElement._emitContextMenu(p);lp=null;},550)};},{passive:true});' +
    'document.addEventListener("touchmove",function(e){if(lp&&e.touches.length===1&&' +
    'Math.hypot(e.touches[0].clientX-lp.x,e.touches[0].clientY-lp.y)>12){clearTimeout(lp.timer);lp=null;}},{passive:true});' +
    'document.addEventListener("touchend",function(){if(lp){clearTimeout(lp.timer);lp=null;}},{passive:true});' +
    'document.addEventListener("touchcancel",function(){if(lp){clearTimeout(lp.timer);lp=null;}},{passive:true});' +
    '<\/script></body></html>';

  function tile(name, color, url) {
    // 点击走适配器 loadURL（frameElement 即 shim 实例）：URL/历史/地址栏立即同步，白屏也可点「原生」
    return '<a class="tile" href="' + url + '" onclick="if(frameElement&&frameElement.loadURL){event.preventDefault();frameElement.loadURL(this.href)}">' +
      '<span class="ic" style="background:' + color + '">' + name.charAt(0) + '</span><span class="nm">' + name + '</span></a>';
  }

  function isHomeUrl(u) {
    if (!u) return false;
    const s = String(u).trim();
    return s === 'about:blank' || s === 'about:srcdoc' ||
      /^https?:\/\/(www\.)?bing\.com\/?(\?|$)/i.test(s);
  }

  window.__createWebViewShim = function () {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads');

    let history = [];
    let histIdx = -1;
    let curUrl = '';
    let onHome = false;

    function emit(type, detail) {
      const ev = new Event(type);
      if (detail) Object.assign(ev, detail);
      iframe.dispatchEvent(ev);
    }

    function showHome() {
      // 移除 src 才能让 srcdoc 生效（srcdoc 优先级高于 src，但两者互斥更稳）
      iframe.removeAttribute('src');
      iframe.srcdoc = HOME_HTML;
      curUrl = 'about:blank';
      onHome = true;
      history = history.slice(0, histIdx + 1);
      history.push('about:blank');
      histIdx = history.length - 1;
      emit('did-start-loading');
    }

    function loadInternal(url, opts) {
      const push = !(opts && opts.noPush);
      if (isHomeUrl(url)) { showHome(); return; }
      curUrl = url;
      onHome = false;
      if (push) {
        history = history.slice(0, histIdx + 1);
        history.push(url);
        histIdx = history.length - 1;
      }
      emit('did-start-loading');
      iframe.removeAttribute('srcdoc'); // srcdoc 优先于 src，必须先清
      iframe.setAttribute('src', url);  // 绕过本实例的 src 拦截器
    }

    iframe.addEventListener('load', function () {
      emit('dom-ready');
      // 同源页面（起始页/同源站点）读真实 location 同步 URL；跨域读不到维持 curUrl
      if (!onHome) {
        try {
          const h = iframe.contentWindow && iframe.contentWindow.location.href;
          if (h && h !== 'about:srcdoc' && h !== 'about:blank' && h !== curUrl &&
            h !== 'about:' && !h.startsWith('data:')) {
            curUrl = h;
            history = history.slice(0, histIdx + 1);
            history.push(h);
            histIdx = history.length - 1;
          }
        } catch (e) { /* 跨域 */ }
      }
      emit('did-navigate', { url: curUrl });
      emit('did-stop-loading');
      let title = '';
      try {
        const doc = iframe.contentDocument;
        title = (doc && doc.title) || '';
      } catch (e) { /* 跨域 */ }
      if (!title) title = onHome ? HOME_TITLE : hostOf(curUrl);
      emit('page-title-updated', { title: title });
    });

    // ── Electron webview API 表面 ──
    iframe.loadURL = function (u) { loadInternal(u); };
    iframe.goBack = function () { if (histIdx > 0) { histIdx--; loadInternal(history[histIdx], { noPush: true }); } };
    iframe.goForward = function () { if (histIdx < history.length - 1) { histIdx++; loadInternal(history[histIdx], { noPush: true }); } };
    iframe.canGoBack = function () { return histIdx > 0; };
    iframe.canGoForward = function () { return histIdx < history.length - 1; };
    iframe.reload = function () { if (onHome) showHome(); else if (curUrl) loadInternal(curUrl, { noPush: true }); };
    iframe.stop = function () { /* iframe 无中止语义 */ };
    iframe.clearHistory = function () { history = curUrl ? [curUrl] : []; histIdx = curUrl ? 0 : -1; };
    iframe.getURL = function () { return curUrl; };
    iframe.setUserAgent = function () { /* iframe 不支持 UA 覆盖 */ };
    iframe.setZoomLevel = function () { /* 跨域内容无法缩放 */ };
    iframe.getWebContentsId = function () { throw new Error('tablet: no webContents'); };
    iframe.capturePage = function () {
      return Promise.resolve({ toDataURL: function () { return ''; }, isEmpty: function () { return true; } });
    };
    iframe.executeJavaScript = function (code) {
      return new Promise(function (resolve, reject) {
        try {
          const doc = iframe.contentDocument; // 跨域时为 null
          if (!doc || !iframe.contentWindow) { reject(new Error('cross-origin')); return; }
          resolve(iframe.contentWindow.eval(code));
        } catch (e) { reject(e); }
      });
    };

    // ── 右键菜单支撑（桌面 BrowserContextMenu 依赖）──
    iframe._emitContextMenu = function (params) {
      const p = params || {};
      const ev = new Event('context-menu');
      ev.params = Object.assign({ x: p.x || 0, y: p.y || 0 }, p);
      iframe.dispatchEvent(ev);
    };
    iframe.copy = function () {
      const d = iframe.contentDocument;
      if (!d) throw new Error('cross-origin');
      try { iframe.contentWindow.focus(); } catch (e) { }
      d.execCommand('copy');
    };
    iframe.selectAll = function () {
      const d = iframe.contentDocument;
      if (!d) throw new Error('cross-origin');
      d.execCommand('selectAll');
    };
    iframe.inspectElement = function () { throw new Error('tablet: no devtools'); };

    // createTab 里用 webview.src = url 直接赋值加载 → 拦截并入同一链路
    Object.defineProperty(iframe, 'src', {
      get: function () { return curUrl; },
      set: function (v) { loadInternal(String(v || 'about:blank')); }
    });

    // 初始显示起始页（桌面 setTimeout(0) 后会赋 src=about:blank/bing，走同一拦截）
    showHome();

    return iframe;
  };

  // 起始页搜索框 → 原生页打开（主流搜索引擎全拒绝 iframe）
  window.__tabletNativeOpen = function (url) {
    const Perm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm;
    if (Perm && Perm.openInApp) {
      Promise.resolve(Perm.openInApp({ url: url })).catch(function () { });
    }
  };

  // 原生长按链接桥（MainActivity setOnLongClickListener → HitTestResult）：
  // 跨域 iframe 内长按链接也能弹出桌面右键菜单（无触摸坐标，用屏幕中上部）
  window.__tabletLongPressLink = function (url) {
    const s = (window.__webviewShims || []).find(function (x) { return x.style && x.style.display !== 'none'; });
    if (s && s._emitContextMenu) {
      s._emitContextMenu({
        linkURL: url,
        x: Math.round(window.innerWidth / 2),
        y: Math.round(window.innerHeight * 0.4),
        ts: Date.now()
      });
    }
  };

  // ── createElement 劫持（BrowserApp 照常 createElement('webview')）──
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    if (String(tag).toLowerCase() === 'webview') return window.__createWebViewShim();
    return origCreate.apply(null, arguments);
  };

  // ── 状态栏「原生」按钮：被 X-Frame-Options 拒绝的网站白屏时的兜底 ──
  function injectNativeButton(win) {
    if (win.__tabletNativeBtn) return;
    const bar = win.querySelector('.app-browser-statusbar') ||
      win.querySelector('.app-browser-toolbar') ||
      win.querySelector('.app-browser-content');
    if (!bar) return;
    const btn = document.createElement('button');
    btn.className = 'app-browser-nav-btn';
    btn.title = '网页白屏时用原生页打开（平板专属）';
    btn.textContent = '原生';
    btn.style.cssText = 'color:#5ee8ff;font-size:12px;padding:2px 8px;white-space:nowrap;';
    btn.addEventListener('click', function () {
      // 当前活跃 shim 的 URL 优先，其次地址栏
      let url = '';
      try {
        const active = (window.__webviewShims || []).find(function (s) { return s.style.display !== 'none'; });
        if (active) url = active.getURL();
      } catch (e) { }
      if (!url || url === 'about:blank') {
        const addr = win.querySelector('.app-browser-url-input');
        url = (addr && addr.value) || '';
      }
      if (url && !/^about:blank$/i.test(url) && window.__tabletNativeOpen) window.__tabletNativeOpen(url);
    });
    bar.appendChild(btn);
    win.__tabletNativeBtn = true;
  }

  // 活跃 shim 注册表（「原生」按钮取当前 URL 用）
  const origCreateShim = window.__createWebViewShim;
  window.__webviewShims = [];
  window.__createWebViewShim = function () {
    const s = origCreateShim();
    window.__webviewShims.push(s);
    return s;
  };

  const mo = new MutationObserver(function () {
    document.querySelectorAll('.app-browser-window, [class*="app-browser"]').forEach(function (w) {
      if (w.querySelector && w.querySelector('.app-browser-webview')) injectNativeButton(w);
    });
  });
  function startObserve() { mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) startObserve();
  else document.addEventListener('DOMContentLoaded', startObserve);

  console.log('[tablet] webview→iframe 适配器（含起始页）已加载');
})();
