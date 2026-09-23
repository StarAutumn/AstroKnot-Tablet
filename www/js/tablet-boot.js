// ============================================================
// AstroKnot Tablet - 平板启动补丁
// 在 web-api-shim.js 之前加载，做环境标记与原生壳适配。
// 后续触摸适配（长按菜单/选择模式/捏合）也在此扩展。
// ============================================================
(function () {
  'use strict';

  window.__TABLET__ = true;

  // ---------- Capacitor 原生壳适配 ----------
  var Cap = window.Capacitor;
  if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()) {
    document.addEventListener('DOMContentLoaded', function () {
      // 安卓返回键：优先交给应用内部导航，根页面双击退出（后续接 appState）
      var App = Cap.Plugins && Cap.Plugins.App;
      if (App && App.addListener) {
        try {
          App.addListener('backButton', function () {
            // 骨架阶段：不退出，仅记录。后续接入「浮窗关闭/视图返回」逻辑
            console.log('[tablet] backButton（骨架阶段不退出）');
          });
        } catch (e) { /* 忽略 */ }
      }
    });
  }

  // ---------- 通用触摸基线（骨架阶段最小实现） ----------
  // 平板 WebView 默认长按会触发文本选择/系统菜单，干扰后续自绘长按菜单
  document.addEventListener('contextmenu', function (e) {
    // 桌面版右键菜单依赖 contextmenu 事件；触摸长按也会派发 contextmenu。
    // 这里不阻止，只在后续 touch-adapter 里区分 pointerType 后自行处理。
  }, { passive: true });

  console.log('[tablet] 平板环境已初始化');
})();
