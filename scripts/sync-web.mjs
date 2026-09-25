#!/usr/bin/env node
// ============================================================
// AstroKnot Tablet - 从桌面版同步 Web 渲染层到 www/
//
// 数据源（桌面 d:/AstroKnot）:
//   web_version/index.html + AstroKnot.js   纯 Web 版入口（库已本地化）
//   web_version/lib + assets                本地化第三方库 / 资源
//   web-api-shim.js（根目录）               浏览器 window.api 垫片
//   modules/ + style/                       渲染层（web_version 引用但不含在自身内）
//
// 输出: www/（可直接 npx cap sync）
// 注入: modules/systemStorage.js + js/tablet-boot.js（web-api-shim.js 之前加载）
// 用法: node scripts/sync-web.mjs [桌面根目录，默认 ../AstroKnot（并排 clone），退回 d:/AstroKnot]
//       平板仓库自带 www/ 构建产物：独立 clone 后无需桌面版，直接 npx cap sync android；
//       本脚本仅在改补丁/桌面源码更新后重新生成 www/ 时需要
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const PATCHES = path.join(ROOT, 'patches');

function log(msg) { console.log('[sync-web] ' + msg); }
function fail(msg) { console.error('[sync-web] ✗ ' + msg); process.exit(1); }

// 桌面版定位：命令行参数 > ../AstroKnot（并排 clone）> d:/AstroKnot（本机开发默认）
let DESKTOP = process.argv[2] || null;
if (!DESKTOP) {
  const sibling = path.resolve(ROOT, '..', 'AstroKnot');
  DESKTOP = fs.existsSync(sibling) ? sibling : 'd:/AstroKnot';
}
DESKTOP = path.resolve(DESKTOP);

// 桌面版校验：平板仓库现已自带 www/ 构建产物（独立 clone 可直接 cap sync 构建），
// 桌面源码仅在重新生成 www/ 时需要；桌面版不可用且 www/ 完好时降级为警告跳过
function desktopErrText() {
  if (!fs.existsSync(DESKTOP)) return '目录不存在';
  for (const need of ['web_version/index.html', 'web_version/AstroKnot.js', 'web-api-shim.js', 'modules', 'style']) {
    if (!fs.existsSync(path.join(DESKTOP, need))) return '缺少 ' + need;
  }
  return null;
}
{
  const err = desktopErrText();
  if (err) {
    const wwwReady = fs.existsSync(path.join(WWW, 'index.html')) && fs.existsSync(path.join(WWW, 'AstroKnot.js'));
    if (wwwReady) {
      log('⚠ 桌面版不可用（' + DESKTOP + '：' + err + '），跳过重新生成，直接使用仓库内已有 www/');
      log('  独立部署: npx cap sync android → cd android && gradlew installDebug');
      process.exit(0);
    }
    fail('桌面版不可用（' + DESKTOP + '：' + err + '）且 www/ 无构建产物，无法继续');
  }
}

// ---------- 工具 ----------
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cp(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) cp(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ---------- 1. 清空 www ----------
log('清空 www/ …');
rm(WWW);
fs.mkdirSync(WWW, { recursive: true });

// ---------- 2. 拷贝 ----------
log('拷贝 web_version 库与资源 …');
cp(path.join(DESKTOP, 'web_version', 'AstroKnot.js'), path.join(WWW, 'AstroKnot.js'));
cp(path.join(DESKTOP, 'web_version', 'lib'), path.join(WWW, 'lib'));
cp(path.join(DESKTOP, 'web_version', 'assets'), path.join(WWW, 'assets'));
// TinyMCE 运行时按 base_url=lib/ 动态加载 plugins/models/skins/themes/icons/langs，
// web_version 把它们收在 lib/tinymce/ 下，提升到 lib/ 平级才能命中
log('提升 lib/tinymce/* → lib/（匹配 TinyMCE base_url）…');
const TINYMCE_SUBDIRS = ['plugins', 'models', 'skins', 'themes', 'icons', 'langs'];
for (const sub of TINYMCE_SUBDIRS) {
  const src = path.join(DESKTOP, 'web_version', 'lib', 'tinymce', sub);
  if (fs.existsSync(src)) cp(src, path.join(WWW, 'lib', sub));
}
log('拷贝 web-api-shim.js …');
cp(path.join(DESKTOP, 'web-api-shim.js'), path.join(WWW, 'web-api-shim.js'));
log('拷贝 modules/ …');
cp(path.join(DESKTOP, 'modules'), path.join(WWW, 'modules'));
log('拷贝 style/ …');
cp(path.join(DESKTOP, 'style'), path.join(WWW, 'style'));
// xterm（IDE 终端）：web_version/lib 缺失，桌面根 lib/ 有本地版
if (fs.existsSync(path.join(DESKTOP, 'lib', 'xterm'))) {
  log('拷贝 lib/xterm（web_version 缺失，取自桌面根 lib/）…');
  cp(path.join(DESKTOP, 'lib', 'xterm'), path.join(WWW, 'lib', 'xterm'));
}
// mathlive：web_version/lib 缺失（桌面走 CDN），离线 App 必须本地化
if (!fs.existsSync(path.join(WWW, 'lib', 'mathlive.min.js'))) {
  log('下载 mathlive 到 lib/mathlive.min.js …');
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/mathlive/dist/mathlive.min.js');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(path.join(WWW, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(WWW, 'lib', 'mathlive.min.js'), Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    log('⚠ mathlive 下载失败（' + e.message + '），公式编辑器将不可用');
  }
}
// lunar-javascript：桌面 index.html head 走 CDN（web head 无此标签），
// 缺失时点任务栏时钟 → renderCalendar 逐日调 Solar.fromYmd 抛 TypeError → 日历弹窗打不开
if (!fs.existsSync(path.join(WWW, 'lib', 'lunar.js'))) {
  log('下载 lunar-javascript 到 lib/lunar.js …');
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/lunar-javascript/lunar.js');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(path.join(WWW, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(WWW, 'lib', 'lunar.js'), Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    log('⚠ lunar 下载失败（' + e.message + '），日历/农历/纪念日将不可用');
  }
}
// ---------- 2.5 平板裁剪补丁（桌面源码不动，仅裁剪 www/ 副本） ----------
// 原则: 每条补丁锚点必须唯一命中，未命中/多命中即报错退出（桌面代码重构后不会静默失效）
log('应用平板裁剪补丁（华丽模式 / 帧率锁）…');
const TRIM_PATCHES = [
  {
    file: 'modules/module1_Textures.js',
    desc: '银河全景纹理 → 2×2 占位（原 8192×4096 逐星绘制平板耗时 130s+，极简模式本不可见）',
    from: 'appState.panoramaTexture = createPanoramaTexture(1.0);',
    to: [
      '// [tablet-trim] 华丽模式银河纹理已裁剪: 2×2 占位替代 8192×4096 生成',
      'appState.panoramaTexture = (() => {',
      '  const c = document.createElement("canvas");',
      '  c.width = c.height = 2;',
      '  const g = c.getContext("2d");',
      '  g.fillStyle = "#010118";',
      '  g.fillRect(0, 0, 2, 2);',
      '  return new THREE.CanvasTexture(c);',
      '})();',
    ].join('\n'),
  },
  {
    file: 'modules/UI/Theme.js',
    desc: '设置恢复强制极简（防持久化 simple3D:false 开机切华丽）',
    from: "if (typeof saved.simple3D === 'boolean') appState.simple3D = saved.simple3D;",
    to: "if (typeof saved.simple3D === 'boolean') appState.simple3D = true; // [tablet-trim] 强制极简",
  },
  {
    file: 'modules/UI/Theme.js',
    desc: '启动模式 3d_full → 极简',
    from: "} else if (mode === '3d_full') {\n    appState.simple3D = false;\n  }",
    to: "} else if (mode === '3d_full') {\n    appState.simple3D = true; // [tablet-trim] 华丽模式已裁剪\n  }",
  },
  {
    file: 'modules/UI/Keyboard.js',
    desc: 'F2 不再切换华丽/极简',
    from: '      toggleSimple3DMode(!appState.simple3D);',
    to: '      // [tablet-trim] 华丽模式已裁剪，F2 不再切换',
  },
  {
    file: 'modules/UI/Toolbar/settings-popup.js',
    desc: '设置面板华丽开关置灰锁定',
    from: '<input type="checkbox" id="simple3DCheck">',
    to: '<input type="checkbox" id="simple3DCheck" checked disabled>',
  },
  {
    file: 'modules/Guide/index.js',
    desc: '移除教程完成后的 F2 提示',
    from: 'function _showF2Hint() {',
    to: 'function _showF2Hint() { return; // [tablet-trim] 华丽模式已裁剪，无 F2 提示',
  },
  {
    file: 'modules/module14_Animation.js',
    desc: '3D 主循环帧率锁 90 → 50（平板省电）',
    from: 'const _TARGET_INTERVAL = 1000 / 90;',
    to: 'const _TARGET_INTERVAL = 1000 / 50; // [tablet-trim] 平板锁 50fps',
  },
  {
    file: 'modules/richEditor/tree-panel.js',
    desc: '树状面板帧率锁 90 → 50',
    from: 'const _TARGET_INTERVAL = 1000 / 90;',
    to: 'const _TARGET_INTERVAL = 1000 / 50; // [tablet-trim] 平板锁 50fps',
  },
  {
    file: 'modules/module7_SceneInit.js',
    desc: 'WebGL pixelRatio 上限 1.5 → 1.0（降低平板 GPU 填充率压力）',
    from: 'appState.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));',
    to: 'appState.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0)); // [tablet-trim] 平板锁 1.0',
  },
  {
    file: 'modules/Guide/GuideCore.js',
    desc: '教程完成标记换键名（旧键 astroknot_guide_completed_v1.0.0 在平板 WebView DOM Storage 中损坏：写入后重启必丢，新键空间实测可正常持久化）',
    from: "const GUIDE_BASE_KEY = 'astroknot_guide_completed';",
    to: "const GUIDE_BASE_KEY = 'astroknot_guide_done'; // [tablet-trim] 绕开平板 WebView 损坏的旧键",
  },
  {
    file: 'modules/Guide/GuideCore.js',
    desc: '教程步骤标记换键名（与 completed 同批损坏区）',
    from: "const GUIDE_STEP_BASE_KEY = 'astroknot_guide_current_step';",
    to: "const GUIDE_STEP_BASE_KEY = 'astroknot_guide_step2'; // [tablet-trim] 绕开平板 WebView 损坏的旧键",
  },
  {
    file: 'modules/versionGraph/versionStore.js',
    desc: '版本存储环境门槛放行 __TABLET__（配合 js/version-shim.js 实现版本时间线）',
    from: "let _isElectron = typeof window !== 'undefined' && window.__ELECTRON__ && window.api;",
    to: "let _isElectron = typeof window !== 'undefined' && (window.__ELECTRON__ || window.__TABLET__) && window.api; // [tablet-trim] 平板启用版本存储（localStorage 垫片）",
  },
  {
    file: 'modules/module11_QuickNotes.js',
    desc: '快速笔记环境门槛放行 __TABLET__（配合 js/notes-fs-shim.js 实现文件层快速笔记）',
    from: "export async function loadQuickNotes() {\n  const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ && window.api;",
    to: "export async function loadQuickNotes() {\n  const isElectron = typeof window !== 'undefined' && (window.__ELECTRON__ || (window.__TABLET__ && window.api && window.api.loadQuickNotes)) && window.api; // [tablet-trim] 平板启用文件层快速笔记",
  },
  {
    file: 'modules/module11_QuickNotes.js',
    desc: '快速笔记旧数据迁移门槛放行 __TABLET__（localStorage → quicknotes/ 文件层）',
    from: "    let notes = JSON.parse(legacyJson);\n    if (!Array.isArray(notes) || notes.length === 0) return;\n\n    const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ && window.api;",
    to: "    let notes = JSON.parse(legacyJson);\n    if (!Array.isArray(notes) || notes.length === 0) return;\n\n    const isElectron = typeof window !== 'undefined' && (window.__ELECTRON__ || (window.__TABLET__ && window.api && window.api.loadQuickNotes)) && window.api; // [tablet-trim] 平板启用文件层快速笔记",
  },
  {
    file: 'modules/module11_QuickNotes.js',
    desc: '快速笔记保存门槛放行 __TABLET__（增删改落盘 quicknotes/）',
    from: "async function _doSaveQuickNotes() {\n  const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ && window.api;",
    to: "async function _doSaveQuickNotes() {\n  const isElectron = typeof window !== 'undefined' && (window.__ELECTRON__ || (window.__TABLET__ && window.api && window.api.loadQuickNotes)) && window.api; // [tablet-trim] 平板启用文件层快速笔记",
  },
  {
    file: 'modules/UI/Toolbar/settings-popup.js',
    desc: '隐藏平板无效的设置控件（华丽特效/渲染锁定项/Electron 专属）',
    from: '  <div class="settings-body" style="flex:1; overflow-y:auto;">',
    to: [
      '  <style>',
      '  /* [tablet-trim] 平板裁剪：华丽模式专属控件（天空/泛光/圆环/流星/粒子）、',
      '     平板强制锁定项（Bloom/像素比/粒子密度/简洁开关）、Electron 专属项（窗口模式/3D华丽启动/本地图片背景/文件位置页） */',
      '  #settingsPopup div:has(> .sky-speed-slider), #settingsPopup div:has(> .sky-speed-value),',
      '  #settingsPopup div:has(> .sky-brightness-slider), #settingsPopup div:has(> .sky-brightness-value),',
      '  #settingsPopup div:has(> .sky-saturation-slider), #settingsPopup div:has(> .sky-saturation-value),',
      '  #settingsPopup div:has(> .glow-slider), #settingsPopup div:has(> .glow-value),',
      '  #settingsPopup div:has(> .surface-glow-slider), #settingsPopup div:has(> .surface-glow-value),',
      '  #settingsPopup div:has(> label > .ring-visibility-check),',
      '  #settingsPopup div:has(> .ring-glow-slider), #settingsPopup div:has(> .ring-glow-value),',
      '  #settingsPopup div:has(> .ring-speed-slider), #settingsPopup div:has(> .ring-speed-value),',
      '  #settingsPopup div:has(> .line-glow-slider), #settingsPopup div:has(> .line-glow-value),',
      '  #settingsPopup div:has(> label > .particle-visibility-check),',
      '  #settingsPopup div:has(> label > .meteor-visibility-check),',
      '  #settingsPopup div:has(> .bloom-slider), #settingsPopup div:has(> .bloom-value),',
      '  #settingsPopup div:has(> .pixelratio-select),',
      '  #settingsPopup div:has(> .particle-density-select), #settingsPopup div:has(> .particle-density-select) + div,',
      '  #settingsPopup div:has(> label > #simple3DCheck),',
      '  #settingsPopup div:has(> #startupWindowModeSelect),',
      '  #settingsPopup div:has(> #dockLayoutModeSelect),',
      '  #settingsPopup .settings-tab[data-tab="savepath"],',
      '  #startupModeSelect option[value="3d_full"],',
      '  #startPageBackgroundSelect option[value="custom"] { display: none !important; }',
      '  </style>',
      '  <div class="settings-body" style="flex:1; overflow-y:auto;">',
    ].join('\n'),
  },
  {
    file: 'AstroKnot.js',
    desc: '入口补挂 window.WindowManager（web 精简入口缺此 import，IDE/AppRunner 窗口管理依赖）',
    from: "import { initDock } from './modules/UI/Dock.js';",
    to: "import { initDock } from './modules/UI/Dock.js';\nimport './modules/UI/window-manager.js'; // [tablet-trim] 挂载 window.WindowManager（IDE 打开依赖）",
  },
  {
    file: 'modules/UI/Dock.js',
    desc: '应用库面板初始化放行平板（挂载 window.AppRunner，IDE 打开依赖）',
    from: '  if (!window.__ELECTRON__ || !window.api) return;',
    to: '  if ((!window.__ELECTRON__ && !window.__TABLET__) || !window.api) return; // [tablet-trim] 平板放行（IDE 新分支依赖 window.AppRunner）',
  },
  // ── 桌面图标模式 + 应用库侧边栏（js/desktop-ui-touch.js 触控适配配套） ──
  {
    file: 'modules/module0_AppState.js',
    desc: '平板默认启用桌面图标模式（dockLayoutMode=desktop）',
    from: "    this.dockLayoutMode = 'sidebar';  // 'sidebar' | 'desktop'  应用栏布局模式",
    to: "    this.dockLayoutMode = (typeof window !== 'undefined' && window.__TABLET__) ? 'desktop' : 'sidebar';  // 'sidebar' | 'desktop'  应用栏布局模式 [tablet-trim] 平板默认桌面图标",
  },
  {
    file: 'modules/UI/Theme.js',
    desc: '平板忽略已保存的 dockLayoutMode，强制桌面图标模式（历史设置里存的 sidebar 会顶掉默认值）',
    from: '  if (saved.dockLayoutMode) appState.dockLayoutMode = saved.dockLayoutMode;',
    to: '  if (saved.dockLayoutMode && !window.__TABLET__) appState.dockLayoutMode = saved.dockLayoutMode; // [tablet-trim] 平板强制桌面图标（js/desktop-ui-touch.js 触控）',
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '平板桌面图标模式下保留应用库侧边栏（左缘点按呼出，桌面端此模式下隐藏）',
    from: [
      '    const dockPanel = document.getElementById(\'dockPanel\');',
      '    if (dockPanel) dockPanel.style.display = isDesktop ? \'none\' : \'\';',
    ].join('\n'),
    to: [
      '    const dockPanel = document.getElementById(\'dockPanel\');',
      '    // [tablet-trim] 平板保留应用库侧边栏（左缘点按呼出，见 js/desktop-ui-touch.js）',
      '    if (dockPanel && !window.__TABLET__) dockPanel.style.display = isDesktop ? \'none\' : \'\';',
    ].join('\n'),
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '平板双渲染：桌面图标 + 侧边栏应用列表并存（桌面端二选一）',
    from: [
      '    if (this._isDesktopMode()) {',
      '      this._renderDesktop(container, apps);',
      '    } else {',
      '      this._renderSidebar(container, apps);',
      '    }',
    ].join('\n'),
    to: [
      '    if (this._isDesktopMode()) {',
      '      this._renderDesktop(container, apps);',
      '      // [tablet-trim] 平板双渲染：侧边栏应用列表同步保留（左缘呼出，js/desktop-ui-touch.js 触控）',
      '      if (window.__TABLET__) {',
      '        const side = document.getElementById(\'dockAppItems\');',
      '        if (side) { side.innerHTML = \'\'; this._renderSidebar(side, apps); }',
      '      }',
      '    } else {',
      '      this._renderSidebar(container, apps);',
      '    }',
    ].join('\n'),
  },
  {
    file: 'modules/module0_AppState.js',
    desc: '平板默认启用网格排列（dockGridMode=grid，图标一格一个不重叠）',
    from: "    this.dockGridMode = 'free';    // 'free' | 'grid'  桌面图标排列方式（仅 desktop 模式生效）",
    to: "    this.dockGridMode = (typeof window !== 'undefined' && window.__TABLET__) ? 'grid' : 'free';    // 'free' | 'grid'  桌面图标排列方式（仅 desktop 模式生效） [tablet-trim] 平板强制网格",
  },
  {
    file: 'modules/UI/Theme.js',
    desc: '平板忽略已保存的 dockGridMode，强制网格排列',
    from: '  if (saved.dockGridMode) appState.dockGridMode = saved.dockGridMode;',
    to: '  if (saved.dockGridMode && !window.__TABLET__) appState.dockGridMode = saved.dockGridMode; // [tablet-trim] 平板强制网格（一格一个图标）',
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '平板网格吸附带碰撞检测（free 时代旧位置可能映射同一格，_snapToGrid 会重叠）',
    from: [
      '        const left = parseFloat(icon.style.left) || 16;',
      '        const top = parseFloat(icon.style.top) || 16;',
      '        const snapped = _snapToGrid(left, top);',
    ].join('\n'),
    to: [
      '        const left = parseFloat(icon.style.left) || 16;',
      '        const top = parseFloat(icon.style.top) || 16;',
      '        // [tablet-trim] 平板带碰撞吸附：free 时代旧位置可能挤到同一格，逐个去重防重叠',
      '        const key0 = icon.dataset.source === \'app\' ? \'app:\' + icon.dataset.appId : \'ext:\' + icon.dataset.appId;',
      '        const snapped = window.__TABLET__ ? _snapToGridWithCollision(left, top, key0) : _snapToGrid(left, top);',
    ].join('\n'),
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '平板渲染后统一网格吸附（_init 时 apps 为空吸附空跑，refresh 渲染后无人吸附）',
    from: [
      '    // 追加外部程序图标（由 Dock.js 提供）',
      '    let hasExternal = false;',
      '    if (typeof window._renderExternalAppsToDesktop === \'function\') {',
      '      hasExternal = window._renderExternalAppsToDesktop(container, positions);',
      '    }',
    ].join('\n'),
    to: [
      '    // 追加外部程序图标（由 Dock.js 提供）',
      '    let hasExternal = false;',
      '    if (typeof window._renderExternalAppsToDesktop === \'function\') {',
      '      hasExternal = window._renderExternalAppsToDesktop(container, positions);',
      '    }',
      '',
      '    // [tablet-trim] 平板网格布局：渲染后统一带碰撞吸附（一格一个图标，幂等）',
      '    if (window.__TABLET__ && appState.dockGridMode === \'grid\') {',
      '      for (const icon of container.children) {',
      '        if (!icon.classList.contains(\'desktop-icon\')) continue;',
      '        const left = parseFloat(icon.style.left) || 8;',
      '        const top = parseFloat(icon.style.top) || 8;',
      '        const gkey = icon.dataset.source === \'app\' ? \'app:\' + icon.dataset.appId : \'ext:\' + icon.dataset.appId;',
      '        const sn = _snapToGridWithCollision(left, top, gkey);',
      '        icon.style.left = sn.left + \'px\';',
      '        icon.style.top = sn.top + \'px\';',
      '        if (icon.dataset.appId) _saveDesktopIconPosition(gkey, { left: sn.left, top: sn.top });',
      '      }',
      '    }',
    ].join('\n'),
  },
  {
    file: 'modules/UI/Dock.js',
    desc: '平板跳过无 path 的损坏外部快捷方式（脏数据会渲染成 appId=undefined 的幽灵图标）',
    from: [
      '  for (const item of items) {',
      '    const el = document.createElement(\'div\');',
      "    el.className = 'desktop-icon' + (selectedPaths.has(item.path) ? ' selected' : '');",
      '    el.dataset.path = item.path;',
      '    el.dataset.appId = item.path;',
      "    el.dataset.source = 'external';",
    ].join('\n'),
    to: [
      '  for (const item of items) {',
      '    if (window.__TABLET__ && !item.path) continue; // [tablet-trim] 跳过损坏条目（无 path 点不开）',
      '    const el = document.createElement(\'div\');',
      "    el.className = 'desktop-icon' + (selectedPaths.has(item.path) ? ' selected' : '');",
      '    el.dataset.path = item.path;',
      '    el.dataset.appId = item.path;',
      "    el.dataset.source = 'external';",
    ].join('\n'),
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '平板双渲染：选中态同步到侧边栏列表（_updateSelectedClass 桌面端只刷图标层）',
    from: [
      '  _updateSelectedClass() {',
      '    const container = this._getItemsContainer();',
      '    if (!container) return;',
      '    for (const child of container.children) {',
      '      child.classList.toggle(\'selected\', child.dataset.appId === this._selectedId);',
      '    }',
      '  }',
    ].join('\n'),
    to: [
      '  _updateSelectedClass() {',
      '    const container = this._getItemsContainer();',
      '    if (!container) return;',
      '    for (const child of container.children) {',
      '      child.classList.toggle(\'selected\', child.dataset.appId === this._selectedId);',
      '    }',
      '    // [tablet-trim] 平板双渲染：侧边栏列表选中态同步',
      '    if (window.__TABLET__) {',
      '      const side = document.getElementById(\'dockAppItems\');',
      '      if (side && side !== container) {',
      '        for (const child of side.children) {',
      '          child.classList.toggle(\'selected\', child.dataset.appId === this._selectedId);',
      '        }',
      '      }',
      '    }',
      '  }',
    ].join('\n'),
  },
  // ── 「打开文件所在位置」应用内定位（open-location-shim 配套） ──
  {
    file: 'modules/AppLibrary/file-manager/index.js',
    desc: '平板应用内定位：构造时读取 __fmStartPath 初始路径（open-location-shim 注入）+ 暴露实例',
    from: [
      '    this._loadDirTree();',
      '    this._navigateTo(\'\');',
      '  }',
    ].join('\n'),
    to: [
      '    this._loadDirTree();',
      '    // [tablet-trim] 平板应用内定位：__fmStartPath 由 open-location-shim 注入；实例暴露给复用导航',
      '    window.__fmInstance = this;',
      '    var __fmStart = typeof window.__fmStartPath === \'string\' ? window.__fmStartPath : \'\';',
      '    window.__fmStartPath = null;',
      '    this._navigateTo(__fmStart);',
      '  }',
    ].join('\n'),
  },
  // ── 启动首页（StartPage 平板适配）──
  // 注意：www/AstroKnot.js 来自 web_version（精简入口，无 StartPage import），
  // 不同于桌面版 AstroKnot.js，补丁锚点必须按 web_version/AstroKnot.js 写
  {
    file: 'AstroKnot.js',
    desc: '平板等预载完成后再恢复项目 + 启动必显首页（实测本 WebView 内联 module TLA 不阻塞后续脚本，index.html 门闩失效，故在入口显式等待）',
    from: 'initProjects();',
    to: [
      '// [tablet-trim] 平板：index.html 门闩（TLA）在本 WebView 不阻塞后续 module 求值，',
      '// 显式等 __storageReady 后再恢复项目；恢复完成派发事件刷新开始首页最近项目列表',
      'if (window.__TABLET__ && window.__storageReady) {',
      '  window.__storageReady.then(function () {',
      '    if (!window.appState || window.appState.projects.length > 0) return;',
      '    initProjects();',
      '    if (window.appState.projects.length > 0) {',
      "      window.dispatchEvent(new CustomEvent('astroknot-projects-loaded'));",
      '    }',
      '  });',
      '} else {',
      '  initProjects();',
      '}',
      '// [tablet-trim] 平板启动必显开始首页（桌面仅无项目时显示；web 精简入口原本无 StartPage）',
      'if (window.__TABLET__) {',
      "  import('./modules/StartPage/index.js').then(function (m) { m.showStartPage(); });",
      '}',
    ].join('\n'),
  },
  {
    file: 'AstroKnot.js',
    desc: '平板闪屏等 startPage 显示后再撤（startPage 要等文件层预载+动态 import，按桌面双帧节奏先撤闪屏会露出桌面主页面一瞬；8s 兜底防卡死）',
    from: [
      '// ── 启动闪屏：首帧渲染完成后渐变消失 ──',
      'requestAnimationFrame(function () {',
      '  requestAnimationFrame(function () {',
      "    const splash = document.getElementById('appSplash');",
      '    if (splash) {',
      "      splash.classList.add('hidden');",
      '      // 停止涟漪动画以释放资源',
      '      if (window._splashRippleStop) window._splashRippleStop();',
      "      setTimeout(function () { splash.remove(); }, 600);",
      '    }',
      '  });',
      '});',
    ].join('\n'),
    to: [
      '// ── 启动闪屏：首帧渲染完成后渐变消失 ──',
      '// [tablet-trim] 平板：startPage 要等文件层预载 + 动态 import 才显示（远慢于双帧 rAF），',
      '// 按桌面节奏先撤闪屏会露出桌面主页面一瞬，改为等 startPage 显示后再撤（8s 兜底防卡死）',
      'function _hideAppSplash() {',
      '  requestAnimationFrame(function () {',
      '    requestAnimationFrame(function () {',
      "      const splash = document.getElementById('appSplash');",
      '      if (splash) {',
      "        splash.classList.add('hidden');",
      '        // 停止涟漪动画以释放资源',
      '        if (window._splashRippleStop) window._splashRippleStop();',
      "        setTimeout(function () { splash.remove(); }, 600);",
      '      }',
      '    });',
      '  });',
      '}',
      'if (window.__TABLET__) {',
      '  var _splashWaitBegin = Date.now();',
      '  (function _waitStartPage() {',
      "    var sp = document.getElementById('startPage');",
      "    if ((sp && sp.style.display === 'flex') || Date.now() - _splashWaitBegin > 8000) {",
      '      _hideAppSplash();',
      '      return;',
      '    }',
      '    setTimeout(_waitStartPage, 60);',
      '  })();',
      '} else {',
      '  _hideAppSplash();',
      '}',
    ].join('\n'),
  },
  {
    file: 'modules/StartPage/index.js',
    desc: '平板隐藏「打开项目」按钮（依赖 Electron 文件夹选择器；项目打开走最近项目列表）',
    from: "    if (newProjectBtn && !newProjectBtn.hasAttribute('data-bound')) {",
    to: [
      "    // [tablet-trim] 平板隐藏「打开项目」按钮（依赖 Electron 文件夹选择器）",
      "    if (window.__TABLET__ && openProjectBtn) {",
      "      openProjectBtn.style.display = 'none';",
      "    }",
      "    if (newProjectBtn && !newProjectBtn.hasAttribute('data-bound')) {",
    ].join('\n'),
  },
  {
    file: 'modules/StartPage/index.js',
    desc: '平板退出按钮走 @capacitor/app 原生 exitApp（web closeApp 是空壳，桌面 Electron 不受影响）',
    from: [
      "        closeBtn.addEventListener('click', () => {",
      '            if (window.api?.closeApp) {',
      '                window.api.closeApp();',
      '            }',
      '        });',
    ].join('\n'),
    to: [
      "        closeBtn.addEventListener('click', () => {",
      "            // [tablet-trim] 平板退出走 @capacitor/app 原生 exitApp（finishAffinity；原 StoragePerm 为误写的自定义插件名，实际不存在）",
      "            const capExit = window.__TABLET__ && window.Capacitor?.Plugins?.App;",
      "            if (capExit?.exitApp) { capExit.exitApp(); return; }",
      '            if (window.api?.closeApp) {',
      '                window.api.closeApp();',
      '            }',
      '        });',
    ].join('\n'),
  },
  {
    file: 'web-api-shim.js',
    desc: 'closeApp 空壳 → @capacitor/app 原生 exitApp（修菜单关闭按钮/退出确认框失灵：原兜底落到空壳导致无反应；桌面 Electron 走 preload 不用本垫片）',
    from: "    closeApp: function () {},",
    to: [
      "    closeApp: function () {",
      "        // [tablet-trim] 平板走 @capacitor/app 原生 exitApp（统一所有退出入口）",
      "        const capApp = window.__TABLET__ && window.Capacitor?.Plugins?.App;",
      "        if (capApp?.exitApp) { capApp.exitApp(); return; }",
      "    },",
    ].join('\n'),
  },
  {
    file: 'AstroKnot.js',
    desc: '平板启用版本时间线自动提交（initVersionAutoSave 仅桌面完整入口 AstroKnot.js:129 调用，web 精简入口缺失 → 保存事件无人监听，时间线不产生节点）',
    from: [
      '// ── 新手引导：首次启动自动弹出 ──',
      'startGuideIfNeeded();',
    ].join('\n'),
    to: [
      '// ── 新手引导：首次启动自动弹出 ──',
      'startGuideIfNeeded();',
      "// [tablet-trim] 平板启用版本自动提交：监听 astroknot-project-saved 事件自动 commit（web 精简入口原本无此初始化）",
      "import('./modules/versionGraph/versionAutoSave.js').then(function (m) { m.initVersionAutoSave(); });",
    ].join('\n'),
  },
  {
    file: 'web-api-shim.js',
    desc: 'saveProject 返回 path 置空（原 download/<名>.astroknot 被 module9:328 写进 folderPath，污染版本图 versionKey 导致时间线失灵；folderPath 交 project-fs-shim doSaveAll 维护为 projects/<名>；备份下载行为保留）',
    from: "        return { success: true, path: 'download/' + safeName + '.astroknot' };",
    to: [
      "        // [tablet-trim] path 置空：原返回 download/<名>.astroknot 会被 module9 写进 folderPath，",
      "        // versionKey=folderPath 随之错位（数据在 projects/<名>/.versiongraph 而读 download/...）→ 时间线失灵。",
      "        // folderPath 由 project-fs-shim doSaveAll 维护为 projects/<名>；.astroknot 备份下载行为保留",
      "        return { success: true, path: null };",
    ].join('\n'),
  },
  {
    file: 'modules/module9_FileIO.js',
    desc: '保存成功 toast 兜底（saveProject path 置空后避免显示「项目已保存到: null」）',
    from: '      showToast(`项目已保存到: ${result.path}`);',
    to: "      showToast(`项目已保存到: ${result.path || '本地（.astroknot 备份已下载）'}`); // [tablet-trim] path 置空后兜底",
  },
  // ── 项目文件化存储（fs-boot/fs-core/system-storage-fs/project-fs-shim 配套） ──
  {
    file: 'modules/module2_TreeData.js',
    desc: '项目持久化切文件层：projects/<项目名>/project.json（桌面同构布局）',
    from: [
      'function _persistToLocalStorage() {',
      '  if (window.__ELECTRON__) return;',
    ].join('\n'),
    to: [
      'function _persistToLocalStorage() {',
      '  if (window.__ELECTRON__) return;',
      '  // [tablet-trim] 平板文件化：项目数据写入 AstroKnot-Data/projects/<项目名>/',
      '  if (window.__TABLET__ && window.ProjectFsShim && window.ProjectFsShim.isReady()) {',
      '    window.ProjectFsShim.projectSaveAll(appState.projects, appState.currentProjectId);',
      '    return;',
      '  }',
    ].join('\n'),
  },
  {
    file: 'modules/module2_TreeData.js',
    desc: '项目恢复切文件层：预载清单序列化进 localStorage 同款解析链路（复用 Vector3/Set/Map 类型重建）',
    from: '    const raw = localStorage.getItem(_WEB_PROJECTS_KEY);',
    to: [
      '    // [tablet-trim] 平板文件化：fs-boot 预载清单序列化为同款 JSON（复用下方类型重建，勿直接 return 跳过）',
      '    const raw = (window.__TABLET__ && window.ProjectFsShim && window.ProjectFsShim.isReady())',
      '      ? JSON.stringify(window.ProjectFsShim.getProjects())',
      '      : localStorage.getItem(_WEB_PROJECTS_KEY);',
    ].join('\n'),
  },
  {
    file: 'modules/module2_TreeData.js',
    desc: '软删除走文件回收站（fs-boot 失败时会摘除该接口自动回退 localStorage）',
    from: '        if (window.__ELECTRON__ && window.api?.moveProjectToTrash) {',
    to: '        if ((window.__ELECTRON__ || window.__TABLET__) && window.api?.moveProjectToTrash) { // [tablet-trim] 平板放行文件回收站',
  },
  {
    file: 'modules/AppLibrary/trash/index.js',
    desc: '回收站 App 列表走文件层',
    from: '      if (window.__ELECTRON__ && window.api?.listTrash) {',
    to: '      if ((window.__ELECTRON__ || window.__TABLET__) && window.api?.listTrash) { // [tablet-trim] 平板放行文件回收站',
  },
  {
    file: 'modules/AppLibrary/trash/index.js',
    desc: '回收站 App 恢复走文件层',
    from: '      if (window.__ELECTRON__ && window.api?.restoreFromTrash) {',
    to: '      if ((window.__ELECTRON__ || window.__TABLET__) && window.api?.restoreFromTrash) { // [tablet-trim] 平板放行文件回收站',
  },
  {
    file: 'modules/AppLibrary/trash/index.js',
    desc: '回收站 App 永久删除走文件层',
    from: '          if (window.__ELECTRON__ && window.api?.permanentlyDeleteTrashItem) {',
    to: '          if ((window.__ELECTRON__ || window.__TABLET__) && window.api?.permanentlyDeleteTrashItem) { // [tablet-trim] 平板放行文件回收站',
  },
  {
    file: 'modules/AppLibrary/trash/index.js',
    desc: '回收站 App 清空走文件层',
    from: '          if (window.__ELECTRON__ && window.api?.emptyTrash) {',
    to: '          if ((window.__ELECTRON__ || window.__TABLET__) && window.api?.emptyTrash) { // [tablet-trim] 平板放行文件回收站',
  },
  {
    file: 'modules/2DView/Core.js',
    desc: '2D/3D 切换按钮启动即纠正文字（静态 HTML 占位是 🌦 天气符号，3D 模式下应为 ⑂ 2D）',
    from: '  appState.show2DView = show2DView;\n  appState.hide2DView = hide2DView;',
    to: '  appState.show2DView = show2DView;\n  appState.hide2DView = hide2DView;\n  updateModeBtnText(); // [tablet-trim] 首次进入即纠正按钮文字（静态 HTML 🌦 为占位符）',
  },
  {
    file: 'modules/richEditor/core/init.js',
    desc: 'TinyMCE 资源离线化①：语言包/skin/content CSS 指向本地 lib/（原 CDN 断网即初始化失败）',
    from: [
      "language_url: 'https://cdn.tiny.cloud/1/gpl/tinymce/7/langs/zh_CN.js',",
      "    skin_url: 'https://cdn.jsdelivr.net/npm/tinymce@7/skins/ui/oxide-dark',",
      "    content_css: 'https://cdn.jsdelivr.net/npm/tinymce@7/skins/content/dark/content.min.css',",
    ].join('\n'),
    to: [
      "language_url: 'lib/langs/zh_CN.js', // [tablet-trim] 离线化：本地语言包",
      "    skin_url: 'lib/skins/ui/oxide-dark', // [tablet-trim] 离线化：本地 skin",
      "    content_css: 'lib/skins/content/dark/content.min.css', // [tablet-trim] 离线化：本地 content CSS",
    ].join('\n'),
  },
  {
    file: 'modules/richEditor/core/init.js',
    desc: 'TinyMCE 资源离线化②：icons/theme/plugins 指向本地 lib/',
    from: [
      "icons_url: 'https://cdn.jsdelivr.net/npm/tinymce@7/icons/default/icons.min.js',",
      "    theme_url: 'https://cdn.jsdelivr.net/npm/tinymce@7/themes/silver/theme.min.js',",
      "    plugin_base_url: 'https://cdn.jsdelivr.net/npm/tinymce@7/plugins/',",
    ].join('\n'),
    to: [
      "icons_url: 'lib/icons/default/icons.min.js', // [tablet-trim] 离线化：本地图标",
      "    theme_url: 'lib/themes/silver/theme.min.js', // [tablet-trim] 离线化：本地主题",
      "    plugin_base_url: 'lib/plugins/', // [tablet-trim] 离线化：本地插件",
    ].join('\n'),
  },
  {
    file: 'modules/AppLibrary/AppManager.js',
    desc: 'GitHub 导入：平板走 zip 下载+原生解压（github-zip-read.js），桌面仍走 Electron gitCloneAndRead（importFromGithub 处，锚=// 6. 注释）',
    from: [
      "      // 6. 执行 git clone 并读取文件",
      "      log('info', '开始克隆仓库（使用 git clone --depth 1）...');",
      "      progress(0, 100, '正在克隆...');",
      "      ",
      "      const startTime = Date.now();",
      "      const result = await window.api.gitCloneAndRead(cloneUrl);",
    ].join('\n'),
    to: [
      "      // 6. 执行 git clone 并读取文件",
      "      log('info', '开始克隆仓库（使用 git clone --depth 1）...');",
      "      progress(0, 100, '正在克隆...');",
      "      ",
      "      const startTime = Date.now();",
      "      // [tablet-trim] 平板：WebView 无 git，改走 git trees API + raw 下载（github-read-shim.js，CORS 友好）",
      "      const result = (window.__TABLET__ && window.__githubReadFiles)",
      "        ? await window.__githubReadFiles(parsed.owner, parsed.repo, parsed.ref || meta.defaultBranch)",
      "        : await window.api.gitCloneAndRead(cloneUrl);",
    ].join('\n'),
  },
  {
    file: 'modules/AppLibrary/AppManager.js',
    desc: 'GitHub 更新：平板走 zip 下载+原生解压（updateFromGithub 处，锚=// 3. 注释）',
    from: [
      "      // 3. 执行 git clone 并读取文件",
      "      log('info', '开始克隆仓库（使用 git clone --depth 1）...');",
      "      progress(0, 100, '正在克隆...');",
      "      ",
      "      const startTime = Date.now();",
      "      const result = await window.api.gitCloneAndRead(cloneUrl);",
    ].join('\n'),
    to: [
      "      // 3. 执行 git clone 并读取文件",
      "      log('info', '开始克隆仓库（使用 git clone --depth 1）...');",
      "      progress(0, 100, '正在克隆...');",
      "      ",
      "      const startTime = Date.now();",
      "      // [tablet-trim] 平板：WebView 无 git，改走 git trees API + raw 下载（github-read-shim.js，CORS 友好）",
      "      const result = (window.__TABLET__ && window.__githubReadFiles)",
      "        ? await window.__githubReadFiles(owner, repo, app.ref)",
      "        : await window.api.gitCloneAndRead(cloneUrl);",
    ].join('\n'),
  },
  // （2026-09-12）浏览器窗口化回归桌面路径：AppRunner.js 不再拦截 browser 分支，
  // BrowserApp 走 WindowManager 窗口原样复用（webview-shim.js 把 <webview> 换成 iframe 适配器）
  {
    file: 'modules/Guide/GuideCore.js',
    desc: '新手引导平板触控化：步骤文案覆写（鼠标/键盘→长按/捏合/摇杆）+ 摇杆键盘事件桥（window→document，否则 keyboardNav 步骤检测器收不到合成键）',
    from: [
      "    type: 'modal',",
      "    btnText: '开始探索 ✨',",
      "  },",
      "];",
    ].join('\n'),
    to: [
      "    type: 'modal',",
      "    btnText: '开始探索 ✨',",
      "  },",
      "];",
      "",
      "// [tablet-trim] 平板：引导步骤文案触控化（桌面文案含鼠标/键盘操作描述，平板无键鼠）",
      "if (window.__TABLET__) {",
      "  (function () {",
      "    var T = {",
      "      welcome: {",
      "        html: `<p style=\"font-size:15px;line-height:1.7;color:#cde;\"><strong>AstroKnot</strong> 是一款 <span style=\"color:#0ff;\">3D 知识图谱编辑器</span>，接下来我将带你<strong style=\"color:#aef0ff;\">一步步实际操作</strong>，快速上手。</p><p style=\"font-size:13px;color:#9ab;margin-top:8px;\">每个步骤需要你 <span style=\"color:#ff0;\">按照提示完成操作</span> 后才会自动进入下一步。</p><p style=\"font-size:12px;color:#8aa;margin-top:8px;\">随时可点「跳过」退出。</p>`,",
      "      },",
      "      rotate: {",
      "        title: '✋ 旋转视角',",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：单指按住深色背景区域，拖动手指</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">单指拖动背景 = 旋转视角。你会看到发光球体（节点）围绕中心转动。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你完成操作...</p>`,",
      "        hint3D: '👆 单指拖动旋转',",
      "      },",
      "      keyboardNav: {",
      "        title: '🎮 虚拟摇杆飞行',",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：用屏幕左下角的虚拟摇杆移动视角</strong></p><div style=\"display:grid;grid-template-columns:1fr;gap:6px;margin:10px 0;font-size:13px;color:#cde;\"><div>🕹️ <span style=\"color:#9ab;\">左摇杆向四个方向推动 = 前后左右飘移</span></div><div>⬆️ <span style=\"color:#9ab;\">右侧「⬆」按钮 = 上升</span></div><div>⬇️ <span style=\"color:#9ab;\">右侧「⬇」按钮 = 下降</span></div></div><p style=\"font-size:12px;color:#8af;margin-top:8px;\" id=\"guideKeyProgress\">⏳ 已尝试: <strong style=\"color:#0ff;\">0</strong> / 6 个方向</p>`,",
      "        hint3D: '🎮 用摇杆移动和升降',",
      "      },",
      "      zoom: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：双指捏合缩放</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">双指张开 = 靠近（放大）；双指捏拢 = 远离（缩小）。试试把画面调整到你舒服的距离。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你完成操作...</p>`,",
      "      },",
      "      clickNode: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：点击场景中任意一个发光球体</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">选中后节点外圈会变亮变白，表示它已被选中。你可以对选中节点进行后续操作。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你点击节点...</p>`,",
      "        hint3D: '👆 点击这个发光球',",
      "      },",
      "      rightClick: {",
      "        title: '📋 打开节点菜单',",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：长按场景中任意节点（约半秒）</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">节点菜单包含：重命名、新建子节点、添加连线、编辑、删除、移动等所有操作入口。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你长按节点...</p>`,",
      "        hint3D: '长按节点打开菜单',",
      "      },",
      "      createChild: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：长按节点 → 点击「新建子节点」</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">在弹出的输入框中输入子节点名称（比如 \"学习笔记\"），然后确认。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你创建新节点...</p>`,",
      "        hint3D: '长按 → 新建子节点',",
      "      },",
      "      connection: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：① 长按节点 → 点击「添加连线」<br><span style=\"padding-left:4.2em;\">② 点击另一个节点完成连线</span></strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">弹出输入框后可填写连线标签（可选），确认完成。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你完成连线...</p>`,",
      "        hint3D: '长按→添加连线→点目标',",
      "      },",
      "      deleteConnection: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作（任选一种删除刚建的连线）：</strong></p><div style=\"font-size:13px;color:#cde;line-height:1.8;margin-top:4px;\"><p style=\"margin:4px 0;\"><span style=\"color:#0ff;\">方法一</span>：长按已连接的节点 → 点击「🗑️ 删除连线」→ 点击目标节点</p><p style=\"margin:8px 0 0 0;\"><span style=\"color:#0ff;\">方法二</span>：点击场景中任一连线标签 → 弹出菜单 →「🗑️ 删除此连线」</p></div><p style=\"font-size:12px;color:#8af;margin-top:10px;\">⏳ 等待你删除刚创建的连线...</p>`,",
      "        hint3D: '长按节点→删除连线→点目标',",
      "      },",
      "      switchTo2D: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：点击任务栏中的「⑂ 2D」按钮</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">2D 模式以思维导图方式排列节点，更适合梳理层级结构和批量操作。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 点击「⑂ 2D」切换到 2D 视图...</p>`,",
      "      },",
      "      navigate2D: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：在 2D 画布上 <span style=\"color:#ff0;\">双指捏合</span> 缩放，<br><span style=\"padding-left:4.2em;\">或用左侧虚拟摇杆平移</span></strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">试试放大缩小，或者移动画布位置。2D 模式下你可以看到完整的层级结构。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你缩放或移动 2D 画布...</p>`,",
      "      },",
      "      collapseChildren2D: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：长按任意有子节点的节点 → 点击「折叠/展开子节点」</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">折叠后子节点暂时隐藏，画布更清爽。再次相同操作即可恢复展开。2D / 3D 视图均可用。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 点击「折叠/展开子节点」完成操作...</p>`,",
      "      },",
      "      dragNode2D: {",
      "        title: '👆 拖拽定位节点（2D 视图）',",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：在 2D 画布中 <span style=\"color:#ff0;\">长按任意节点（约半秒）</span>，拖到新位置</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">拖拽父节点时其所有后代节点会同步跟随移动。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 拖拽任意节点即可完成...</p>`,",
      "      },",
      "      multiSelect2D: {",
      "        title: '⬚ 2D 框选多个节点',",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：在空白处 <span style=\"color:#ff0;\">直接拖动</span>，框选多个节点</strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">框选完成后 <span style=\"color:#ff0;\">长按框选区内的空白处</span> 弹出多选菜单 →「新建群组」可把框选内容成组。</p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">多选后可以批量执行：对齐、新建群组、批量移动、删除等。长按节点卡片拖动则可以移动节点。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 等待你选中 ≥2 个节点...</p>`,",
      "      },",
      "      nodeMoved3D: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：① 长按任意节点 → 点击「移动节点」<br><span style=\"padding-left:4.2em;\">② 按住节点拖拽到新位置</span><br><span style=\"padding-left:4.2em;\">③ 点击底部 ✅「确定」保存</span></strong></p><p style=\"font-size:12px;color:#9ab;margin-top:6px;\">进入移动模式后，节点高亮代表可拖拽。点击 ❌「取消」可恢复原位。</p><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 拖拽节点并确定后完成...</p>`,",
      "        hint3D: '长按→移动节点→拖拽→确定',",
      "      },",
      "      shortcuts: {",
      "        title: '✅ 触控手势速览',",
      "        html: `<div style=\"font-size:13px;line-height:2;color:#cde;\"><table style=\"width:100%;border-collapse:collapse;\"><tr><td style=\"color:#0ff;width:150px;\">长按节点</td><td>打开节点菜单（同桌面右键）</td></tr><tr><td style=\"color:#0ff;\">空白处拖动</td><td>2D 框选多个节点</td></tr><tr><td style=\"color:#0ff;\">长按后拖动</td><td>移动节点 / 群组拖动 / 卡片拉伸</td></tr><tr><td style=\"color:#0ff;\">长按框选区空白</td><td>多选菜单（新建群组 / 对齐）</td></tr><tr><td style=\"color:#0ff;\">长按群组矩形</td><td>群组菜单（命名 / 配色 / 删除）</td></tr><tr><td style=\"color:#0ff;\">双击节点</td><td>打开富文本编辑器</td></tr><tr><td style=\"color:#0ff;\">单指拖动背景</td><td>旋转视角</td></tr><tr><td style=\"color:#0ff;\">双指捏合</td><td>缩放视距 / 2D 缩放</td></tr><tr><td style=\"color:#0ff;\">左摇杆 / ⬆⬇</td><td>移动 / 升降</td></tr><tr><td style=\"color:#0ff;\">长按桌面图标</td><td>应用菜单，拖动可换位</td></tr><tr><td style=\"color:#0ff;\">点屏幕左缘</td><td>呼出应用库侧边栏</td></tr></table></div>`,",
      "      },",
      "      openSettings: {",
      "        html: `<p style=\"font-size:14px;line-height:1.7;color:#cde;\"><strong style=\"color:#0ff;\">📌 操作：<br><span style=\"padding-left:1em;\">点击 AstroKnot 菜单左下角的 <span style=\"color:#ff0;\">⚙️ 设置</span> 按钮</span></strong></p><div style=\"margin-top:10px;padding:8px 12px;background:rgba(0,255,255,0.06);border-radius:10px;border-left:3px solid rgba(0,255,255,0.4);\"><p style=\"font-size:12px;color:#9ab;margin:0;line-height:1.8;\"><strong style=\"color:#0ff;\">设置面板包含以下可调项：</strong></p><table style=\"width:100%;font-size:11px;color:#8aa;border-collapse:collapse;margin-top:4px;\"><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">🖥️ 显示</td><td>渲染性能等显示选项</td></tr><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">📝 编辑器</td><td>字体大小、浅色模式、页面视图</td></tr><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">📐 2D 视图</td><td>节点默认尺寸、节点间距</td></tr><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">🎨 主题</td><td>全局主题色定制</td></tr><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">🚀 启动</td><td>启动时自动加载项目等选项</td></tr><tr><td style=\"color:#b088ff;white-space:nowrap;padding:2px 6px 2px 0;\">📖 使用帮助</td><td>完整操作手册（下一步将带你打开）</td></tr></table></div><p style=\"font-size:12px;color:#8af;margin-top:8px;\">⏳ 请点击 <span style=\"color:#ff0;\">⚙️</span> 按钮打开设置面板...</p>`,",
      "      },",
      "    };",
      "    for (var gi = 0; gi < STEPS.length; gi++) {",
      "      var ov = T[STEPS[gi].id];",
      "      if (!ov) continue;",
      "      if (ov.title) STEPS[gi].title = ov.title;",
      "      if (ov.html) STEPS[gi].html = ov.html;",
      "      if (ov.hint3D !== undefined) STEPS[gi].hint3D = ov.hint3D;",
      "    }",
      "    // 摇杆合成键盘事件桥：合成事件派发到 window（target=window 不流经 document），",
      "    // 引导 keyboardNav 检测器监听 document 捕获且按 e.code 匹配 → 桥补 code 后转发；",
      "    // 仅转发带 __vk 标记的摇杆事件，物理键盘原生事件天然流经 document，不桥不重复",
      "    window.addEventListener('keydown', function (e) {",
      "      if (!e.__vk) return;",
      "      var CODE = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', ' ': 'Space', Control: 'ControlLeft' };",
      "      var f = new KeyboardEvent(e.type, { key: e.key, code: CODE[e.key] || '', bubbles: true, cancelable: true });",
      "      f.__vk = true;",
      "      document.dispatchEvent(f);",
      "    }, true);",
      "  })();",
      "}",
    ].join('\n'),
  },
  {
    file: 'modules/Guide/GuideCore.js',
    desc: '教程「2D 自动排列」检测补强：布局已是树状时排列不改位置（changedCount 恒 <3 卡步），点击排列菜单项即视为完成',
    from: [
      "      case 'autoArrange2D': {",
      '        if (st && st.positions2D) {',
      '          const initPositions = new Map();',
      '          for (const [id, pos] of st.positions2D.entries()) {',
      '            if (pos) initPositions.set(id, { x: pos.x, y: pos.y });',
      '          }',
      '          detector.poll(',
      '            () => {',
      '              if (!st.positions2D) return false;',
      '              let changedCount = 0;',
      '              for (const [id, pos] of st.positions2D.entries()) {',
      '                const initPos = initPositions.get(id);',
      '                if (initPos && pos) {',
      "                  if (Math.abs(pos.x - initPos.x) > 2 || Math.abs(pos.y - initPos.y) > 2) changedCount++;",
      '                }',
      '              }',
      '              return changedCount >= 3;',
      '            },',
      '            () => setTimeout(onComplete, 500),',
      "            'autoArrange2D'",
      '          );',
      '        }',
      '        break;',
      '      }',
    ].join('\n'),
    to: [
      "      case 'autoArrange2D': {",
      '        if (st && st.positions2D) {',
      '          const initPositions = new Map();',
      '          for (const [id, pos] of st.positions2D.entries()) {',
      '            if (pos) initPositions.set(id, { x: pos.x, y: pos.y });',
      '          }',
      '          // [tablet-trim] 平板：布局已是树状时「自动排列」不改变节点位置（changedCount 恒 <3 永久卡步），',
      '          // 排列菜单项被点击本身即视为完成（捕获阶段监听，仅本步骤检测期间挂载，onCleanup 移除）',
      '          let _arrangeClicked = false;',
      '          if (window.__TABLET__) {',
      '            const _mark = () => { _arrangeClicked = true; };',
      "            const _btns = ['arrangeTreeBtn', 'arrangeAllLayersBtn']",
      '              .map((id) => document.getElementById(id)).filter(Boolean);',
      "            _btns.forEach((b) => b.addEventListener('click', _mark, true));",
      '            detector.onCleanup(() => _btns.forEach((b) => b.removeEventListener(\'click\', _mark, true)));',
      '          }',
      '          detector.poll(',
      '            () => {',
      '              if (!st.positions2D) return false;',
      '              let changedCount = 0;',
      '              for (const [id, pos] of st.positions2D.entries()) {',
      '                const initPos = initPositions.get(id);',
      '                if (initPos && pos) {',
      "                  if (Math.abs(pos.x - initPos.x) > 2 || Math.abs(pos.y - initPos.y) > 2) changedCount++;",
      '                }',
      '              }',
      '              return changedCount >= 3 || _arrangeClicked;',
      '            },',
      '            () => setTimeout(onComplete, 500),',
      "            'autoArrange2D'",
      '          );',
      '        }',
      '        break;',
      '      }',
    ].join('\n'),
  },
  {
    file: 'modules/Guide/GuideCore.js',
    desc: '教程「3D 按 2D 排列」检测补强：3D 布局已与 2D 一致时同样不改位置会卡步，点击排列菜单项即视为完成',
    from: [
      "      case 'arrange3D2D': {",
      '        if (st && st.positions) {',
      '          const initPositions = new Map();',
      '          for (const [id, pos] of st.positions.entries()) {',
      '            if (pos) initPositions.set(id, pos.clone());',
      '          }',
      '          detector.poll(',
      '            () => {',
      '              if (!st.positions) return false;',
      '              let changedCount = 0;',
      '              for (const [id, pos] of st.positions.entries()) {',
      '                const initPos = initPositions.get(id);',
      '                if (initPos && pos && pos.distanceTo(initPos) > 0.3) changedCount++;',
      '              }',
      '              return changedCount >= 3;',
      '            },',
      '            () => setTimeout(onComplete, 500),',
      "            'arrange3D2D'",
      '          );',
      '        }',
      '        break;',
      '      }',
    ].join('\n'),
    to: [
      "      case 'arrange3D2D': {",
      '        if (st && st.positions) {',
      '          const initPositions = new Map();',
      '          for (const [id, pos] of st.positions.entries()) {',
      '            if (pos) initPositions.set(id, pos.clone());',
      '          }',
      '          // [tablet-trim] 平板：3D 布局已与 2D 一致时排列不改变位置（同 autoArrange2D 卡步问题），',
      '          // 点击「3D 按 2D 布局排列」菜单项即视为完成',
      '          let _arrangeClicked = false;',
      '          if (window.__TABLET__) {',
      '            const _mark = () => { _arrangeClicked = true; };',
      "            const _btn = document.getElementById('arrange3D2DBtn');",
      "            if (_btn) _btn.addEventListener('click', _mark, true);",
      "            detector.onCleanup(() => { if (_btn) _btn.removeEventListener('click', _mark, true); });",
      '          }',
      '          detector.poll(',
      '            () => {',
      '              if (!st.positions) return false;',
      '              let changedCount = 0;',
      '              for (const [id, pos] of st.positions.entries()) {',
      '                const initPos = initPositions.get(id);',
      '                if (initPos && pos && pos.distanceTo(initPos) > 0.3) changedCount++;',
      '              }',
      '              return changedCount >= 3 || _arrangeClicked;',
      '            },',
      '            () => setTimeout(onComplete, 500),',
      "            'arrange3D2D'",
      '          );',
      '        }',
      '        break;',
      '      }',
    ].join('\n'),
  },
  {
    file: 'modules/Guide/index.js',
    desc: '平板跳过 F2 提示（华丽 3D 已禁用，F2 无意义）',
    from: "function _showF2Hint() {",
    to: "function _showF2Hint() {\n  if (window.__TABLET__) return; // [tablet-trim] 平板：华丽 3D 已禁用，F2 提示不适用",
  },
  // ── 慢双击重命名全量移除（触摸屏 300-1500ms 双击间隔极易误触）──
  // 重命名仍可走：2D card 铅笔按钮 / 右键菜单 / 树面板内联编辑；桌面端不受影响
  {
    file: 'modules/2DView/interaction/mouse-events.js',
    desc: '移除 2D 节点慢双击重命名',
    from: "if (!isCard && appState.selectedNodeIds.has(hit.id) && _last2DClickedId === hit.id",
    to: "if (false && !isCard && appState.selectedNodeIds.has(hit.id) && _last2DClickedId === hit.id // [tablet-trim] 慢双击重命名已移除（触摸误触）",
  },
  {
    file: 'modules/VisualComponents/nodes/interaction.js',
    desc: '移除 3D 标签慢双击重命名',
    from: "if (appState.selectedNodeIds.has(nodeId) && _lastLabelClickId === nodeId",
    to: "if (false && appState.selectedNodeIds.has(nodeId) && _lastLabelClickId === nodeId // [tablet-trim] 慢双击重命名已移除（触摸误触）",
  },
  {
    file: 'modules/module2_TreeData.js',
    desc: '移除项目列表慢双击重命名',
    from: "if (appState.currentProjectId === id && _lastProjectClickId === id",
    to: "if (false && appState.currentProjectId === id && _lastProjectClickId === id // [tablet-trim] 慢双击重命名已移除（触摸误触）",
  },
  {
    file: 'modules/LayerManager/index.js',
    desc: '移除图层面板慢双击重命名',
    from: "if (appState.currentLayerId === layer.id && _lastClickedLayerId === layer.id",
    to: "if (false && appState.currentLayerId === layer.id && _lastClickedLayerId === layer.id // [tablet-trim] 慢双击重命名已移除（触摸误触）",
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '移除应用库 Dock 慢双击重命名',
    from: "if (this._selectedId === appId && this._lastClickedId === appId\n            && now - this._lastClickTime > 300",
    to: "if (false && this._selectedId === appId && this._lastClickedId === appId // [tablet-trim] 慢双击重命名已移除（触摸误触）\n            && now - this._lastClickTime > 300",
  },
  {
    file: 'modules/AppLibrary/AppPanel.js',
    desc: '移除桌面图标慢双击重命名',
    from: "if (this._selectedId === appId && this._lastClickedId === appId\n          && now - this._lastClickTime > 300",
    to: "if (false && this._selectedId === appId && this._lastClickedId === appId // [tablet-trim] 慢双击重命名已移除（触摸误触）\n          && now - this._lastClickTime > 300",
  },
  {
    file: 'modules/module11_QuickNotes.js',
    desc: '移除快速笔记慢双击重命名',
    from: "if (appState.currentQuickNoteId === noteId && _lastQNoteClickId === noteId",
    to: "if (false && appState.currentQuickNoteId === noteId && _lastQNoteClickId === noteId // [tablet-trim] 慢双击重命名已移除（触摸误触）",
  },
];
for (const p of TRIM_PATCHES) {
  const fp = path.join(WWW, p.file);
  if (!fs.existsSync(fp)) fail('裁剪补丁目标不存在: ' + p.file);
  // 统一规范化为 LF：桌面源文件存在 CRLF（如 GuideCore.js），锚点按 LF 拼接必然失配
  const src = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  const hits = src.split(p.from).length - 1;
  if (hits === 0) fail('裁剪补丁锚点未命中（桌面代码可能已重构）: ' + p.file + ' :: ' + p.from.slice(0, 60));
  if (hits > 1) fail('裁剪补丁锚点不唯一（' + hits + ' 处）: ' + p.file + ' :: ' + p.from.slice(0, 60));
  fs.writeFileSync(fp, src.replace(p.from, p.to));
  log('  ✓ ' + p.desc);
}

log('拷贝 patches/ → www/（patches 内目录结构映射到 www 根）…');
if (fs.existsSync(PATCHES)) {
  for (const name of fs.readdirSync(PATCHES)) {
    cp(path.join(PATCHES, name), path.join(WWW, name));
  }
}

// ---------- 3. 合成 index.html = web_version 的 head（本地化库）+ 桌面版 body（最新 DOM） ----------
// 原因: web_version/index.html 的 body 落后于桌面版（缺新增按钮等元素），
//       直接用会导致 modules 新代码 getElementById 为 null 而崩溃
log('合成 index.html（web head + 桌面 body）…');
const webHtml = fs.readFileSync(path.join(DESKTOP, 'web_version', 'index.html'), 'utf8');
const deskHtml = fs.readFileSync(path.join(DESKTOP, 'index.html'), 'utf8');
const HEAD_END = '</head>';
const webHeadIdx = webHtml.indexOf(HEAD_END);
const deskHeadIdx = deskHtml.indexOf(HEAD_END);
if (webHeadIdx < 0 || deskHeadIdx < 0) fail('index.html 未找到 </head> 锚点');
const head = webHtml.slice(0, webHeadIdx);                 // 含本地化库引用 + importmap
const body = deskHtml.slice(deskHeadIdx + HEAD_END.length); // 含 <body> … 全部 DOM 与脚本
let html = head + HEAD_END + body;
// 注入 tablet-boot（web-api-shim.js 之前；systemStorage 桌面 body 已自带）
const anchor = '<script src="web-api-shim.js"></script>';
if (!html.includes(anchor)) fail('桌面 index.html body 未找到 web-api-shim.js 引用锚点');
html = html.replace(anchor,
  '<script src="lib/lunar.js"></script>\n    ' +
  '<script src="js/tablet-boot.js"></script>\n    ' +
  anchor + '\n    <script src="js/version-shim.js"></script>\n    <script src="js/virtual-joystick.js"></script>\n    <script src="js/touch-gestures.js"></script>\n    <script src="js/desktop-ui-touch.js"></script>\n    <script src="js/ide-fs-shim.js"></script>' +
  // 文件化存储垫片链：必须在 body 内 modules/systemStorage.js 之前加载，
  // 这样 SystemStorage.install() 检测到 systemStorageReadSync → _isElectron()=true
  // → 全部 app 前缀键自动走文件层（键值层零业务补丁）
  '\n    <script src="js/fs-core.js"></script>' +
  '\n    <script src="js/system-storage-fs.js"></script>' +
  '\n    <script src="js/project-fs-shim.js"></script>' +
  '\n    <script src="js/open-location-shim.js"></script>' +
  // 日记/快速笔记文件层垫片：diaries/ + quicknotes/（桌面 diary.js/quick-notes.js 同构），依赖 fs-core
  '\n    <script src="js/notes-fs-shim.js"></script>' +
  '\n    <script src="js/fm-shim.js"></script>' +
  // GitHub 免 git 导入垫片：git trees API + raw 下载（CORS 友好），依赖 fs-core（写 apps/）+ ide-fs-shim（window.api 基座）
  '\n    <script src="js/github-read-shim.js"></script>' +
  // 桌面同步垫片（配对码模式）：依赖 fs-core（写 projects/）+ project-fs-shim（清单注册）
  '\n    <script src="js/desksync-shim.js"></script>' +
  // 内置浏览器降级垫片：Electron <webview> 不可用 → 跳系统浏览器
  '\n    <script src="js/browser-shim.js"></script>' +
  // webview→iframe 适配器：BrowserApp 窗口化复用（劫持 createElement('webview')），必须在 browser 模块执行前加载
  '\n    <script src="js/webview-shim.js"></script>' +
  '\n    <script src="js/fs-boot.js"></script>');
// StartPage 样式：web_version 的 head 落后于桌面版（桌面 index.html 已加此 link，
// web head 没有），平板启动首页依赖它，缺失会导致首页布局错乱
const startPageCssAnchor = '<link rel="stylesheet" href="modules/Guide/style.css">';
if (!html.includes(startPageCssAnchor)) fail('index.html 未找到 Guide/style.css 锚点（StartPage 样式注入）');
html = html.replace(startPageCssAnchor,
  startPageCssAnchor + '\n    <link rel="stylesheet" href="modules/StartPage/style.css">');
// 删除启动首页流光飘带（8 条 blur 飘带性能开销大），只保留底层 #startPage::before/::after
// 动态渐变背景；JS 侧 applyStartPageBackground 的 ribbonsEl 有 null 守卫，DOM 删掉即安全
const ribbonsHtml = [
  '        <!-- 流光飘带效果 -->',
  '        <div class="start-page-ribbons">',
  '            <div class="ribbon ribbon-1"></div>',
  '            <div class="ribbon ribbon-2"></div>',
  '            <div class="ribbon ribbon-3"></div>',
  '            <div class="ribbon ribbon-4"></div>',
  '            <div class="ribbon ribbon-5"></div>',
  '            <div class="ribbon ribbon-6"></div>',
  '            <div class="ribbon ribbon-7"></div>',
  '            <div class="ribbon ribbon-8"></div>',
  '        </div>',
  '        ',
].join('\n');
if (!html.includes(ribbonsHtml)) fail('index.html 未找到流光飘带 DOM 块锚点（删除启动首页飘带）');
html = html.replace(ribbonsHtml, '');
// 存储门闩：内联 module 顶层 await 按文档序阻塞后续 module（AstroKnot.js
// 及其全部 import 的顶层求值），杜绝业务模块在预载/迁移完成前读空数据
const moduleAnchor = '<script type="module" src="AstroKnot.js"></script>';
if (!html.includes(moduleAnchor)) fail('桌面 index.html body 未找到 AstroKnot.js module 引用锚点');
html = html.replace(moduleAnchor,
  '<script type="module">\n' +
  '      // [tablet-trim] 存储门闩：等文件化存储预载/迁移完成（fs-boot 发布）\n' +
  '      if (window.__storageReady) {\n' +
  '        window.__latchWaited = true;\n' +
  '        await window.__storageReady;\n' +
  '        window.__latchReleased = true;\n' +
  '      } else {\n' +
  '        window.__latchMissing = true;\n' +
  '      }\n' +
  '    </script>\n' +
  '    ' + moduleAnchor);
const indexPath = path.join(WWW, 'index.html');
fs.writeFileSync(indexPath, html);

// ---------- 4. CDN 资源本地化 ----------
// 4a. Univer 各 preset 的 index.css（web_version/lib/univer 缺失）
const UNIVER_PRESETS = ['preset-sheets-core', 'preset-sheets-sort', 'preset-sheets-filter',
  'preset-sheets-conditional-formatting', 'preset-sheets-data-validation', 'preset-sheets-drawing',
  'preset-sheets-hyper-link', 'preset-sheets-find-replace', 'preset-sheets-thread-comment'];
// 4b. pdfjs-dist（importmap 残留的最后一个 CDN）
const pdfUrls = [
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs', 'lib/pdfjs/pdf.min.mjs'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs', 'lib/pdfjs/pdf.worker.min.mjs']
];
(async () => {
  for (const preset of UNIVER_PRESETS) {
    const rel = 'lib/univer/' + preset + '/index.css';
    const dest = path.join(WWW, rel);
    if (fs.existsSync(dest)) continue;
    try {
      const url = 'https://unpkg.com/@univerjs/' + preset + '@0.25.0/lib/index.css';
      log('下载 ' + url + ' …');
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      log('⚠ Univer CSS ' + preset + ' 下载失败（' + e.message + '）');
    }
  }
  for (const [url, rel] of pdfUrls) {
    const dest = path.join(WWW, rel);
    if (fs.existsSync(dest)) continue;
    try {
      log('下载 ' + url + ' …');
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      log('⚠ pdfjs 下载失败（' + e.message + '），保留 CDN 引用，联网时可用');
    }
  }
  // 全部成功才替换 importmap
  const allOk = pdfUrls.every(([, rel]) => fs.existsSync(path.join(WWW, rel)));
  if (allOk) {
    html = fs.readFileSync(indexPath, 'utf8');
    html = html
      .replace('"pdfjs-dist": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"',
               '"pdfjs-dist": "./lib/pdfjs/pdf.min.mjs"')
      .replace('"pdfjs-dist/build/pdf.worker.mjs": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs"',
               '"pdfjs-dist/build/pdf.worker.mjs": "./lib/pdfjs/pdf.worker.min.mjs"');
    fs.writeFileSync(indexPath, html);
    log('pdfjs-dist 已本地化');
  }
  done();
})();

// ---------- 5. 报告 ----------
function done() {
  let files = 0;
  (function count(p) {
    for (const name of fs.readdirSync(p)) {
      const full = path.join(p, name);
      if (fs.statSync(full).isDirectory()) count(full);
      else files++;
    }
  })(WWW);
  log('完成 ✓  www/ 共 ' + files + ' 个文件');
  log('下一步: npm install → npx cap add android（首次）→ npm run dev 浏览器验证');
}
