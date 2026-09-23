// ============================================================
// AstroKnot Tablet - browser-shim.js  内置浏览器降级为系统浏览器（平板专属）
//
// 背景：桌面内置浏览器用 Electron <webview>（browser-tabs.js createElement('webview')），
//       平板 WebView 里该元素无效 → 窗口打开但页面区永远空白。
//       iframe 替代不可行：主流网站 X-Frame-Options 拒绝嵌入且 WebView 无法检测；
//       跨域注入（executeJavaScript/课表识别/暗色/缩放）也无法复刻。
// 方案：AppRunner.open 的 browser 分支（TRIM_PATCHES）在平板调本垫片
//       __openExternalBrowser(app) → 原生 StoragePerm.openExternal 跳系统浏览器。
//
// 行为：
//   app.defaultUrl 有 http(s) 协议   → 直接打开
//   无协议但像网址（a.b/...）        → 补 https://
//   其他（搜索词）                   → Bing 搜索
//   无 defaultUrl                    → Bing 首页
//   app.importMode（课表导入）       → 不打开，提示回桌面版（识别脚本无法注入系统浏览器）
// 依赖：StoragePermPlugin.openExternal（原生）；加载顺序在 fs-boot 前后皆可
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;

  function toast(msg) {
    import('/modules/module5_SelectAndEdit.js').then(function (m) {
      if (m && typeof m.showToast === 'function') m.showToast(msg);
    }).catch(function () { console.log('[toast]', msg); });
  }

  function normalizeUrl(raw) {
    var u = String(raw || '').trim();
    if (!u) return 'https://www.bing.com';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w-]+(\.[\w-]+)+(\/|$|\?|:)/.test(u)) return 'https://' + u;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(u);
  }

  window.__openExternalBrowser = function (app) {
    // 课表导入依赖 webview 注入识别脚本，应用内 WebView 页暂未提供注入桥
    if (app && app.importMode) {
      toast('平板版暂不支持课表导入，请在桌面版使用');
      return;
    }
    var url = normalizeUrl(app && app.defaultUrl);
    var Perm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm;
    if (!Perm) {
      toast('系统浏览器不可用');
      return;
    }
    // 优先应用内浏览器页（原生 WebView Activity，无 X-Frame-Options 限制），失败降级系统浏览器
    var call = Perm.openInApp
      ? Promise.resolve(Perm.openInApp({ url: url }))
      : Promise.reject(new Error('openInApp 未实现'));
    call.catch(function (e) {
      console.warn('[browser-shim] 应用内浏览器失败，降级系统浏览器:', e);
      if (Perm.openExternal) {
        Promise.resolve(Perm.openExternal({ url: url })).catch(function () {
          toast('打开浏览器失败');
        });
      } else {
        toast('打开浏览器失败');
      }
    });
  };

  console.log('[tablet] 内置浏览器垫片已加载（原生 WebView 应用内页，兜底系统浏览器）');
})();
