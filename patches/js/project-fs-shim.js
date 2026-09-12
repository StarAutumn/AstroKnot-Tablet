// ============================================================
// AstroKnot Tablet - project-fs-shim.js  项目布局层垫片（平板专属）
//
// 目标: 平板项目数据从 localStorage「单键大 JSON」迁移到与桌面完全一致的
//   文件夹布局（AstroKnot-Data/projects/<项目名>/project.json + nodes/ +
//   trash/ 回收站），可与桌面互相拷贝导入导出。
//
// 写入（移植桌面 main/ipc-file/project-data.js _writeProjectToDisk）:
//   projects/<项目名>/project.json   项目核心（含节点级数据的扁平结构，
//                                    额外保留 id 供平板标识项目）
//   projects/<项目名>/nodes/<节点id>/content.html
//   projects/<项目名>/nodes/<安全名_id前8位>/overlays/  （manifest.json + 媒体文件）
//   projects/<项目名>/nodes/<安全名_id前8位>/sandbox/   （节点 VFS 落盘）
// 读取（移植 _readProjectData，节点文件夹名解析比桌面更稳）:
//   project.json 为准 + nodes/ 扫描补缺（兼容桌面导出的文件夹）
// 回收站（移植 main/ipc-file/trash.js 5 个 IPC 语义）:
//   trash/<项目名>/.trash-meta.json + 项目文件夹
//
// 性能: projectSaveAll 防抖 600ms 合并 + 串行写队列；IDE 会话中的节点
//   跳过 sandbox 重写（防旧 VFS 覆盖 IDE 磁盘编辑）。
// ============================================================
(function () {
  'use strict';

  var fsc = window.FSCore;
  var PROJECTS = 'projects';
  var TRASH = 'trash';

  // ── 预载结果（fs-boot 在 __storageReady 前调用 init 填充） ──
  var projectList = [];   // [{id, name, folderPath, data}] data 为 module2 可恢复格式
  var currentId = null;
  var ready = false;
  var failed = false;

  // ── 写队列与防抖 ──
  var saveTimer = 0;
  var pendingSave = null;
  var writeChain = Promise.resolve();

  // ════════════════════════════════════════════════════════════
  //  桌面同款辅助
  // ════════════════════════════════════════════════════════════

  function sanitizeNodeFolderName(name) {
    return String(name || '未命名').replace(/[<>:"\\/|?*]/g, '_').slice(0, 50) || '未命名';
  }
  function getNodeFolderName(node) {
    return sanitizeNodeFolderName(node && node.name) + '_' + String(node && node.id || '').slice(0, 8);
  }
  /** 项目文件夹名（桌面用 projectName 直接拼路径，此处防路径分隔符） */
  function sanitizeProjectFolderName(name) {
    return String(name || 'knowledge_graph').replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'knowledge_graph';
  }
  function collectTreeNodeIds(tree) {
    var nodes = [];
    (function walk(node) {
      if (!node) return;
      if (node.id !== '__VIRTUAL_ROOT__') nodes.push(node);
      if (node.children) node.children.forEach(walk);
    })(tree);
    return nodes;
  }
  function nowIso() { return new Date().toISOString(); }

  // ════════════════════════════════════════════════════════════
  //  序列化：module2 内存结构 → 桌面 projectData 扁平结构
  // ════════════════════════════════════════════════════════════

  function serializePositions(pos) {
    var out = {};
    if (!pos) return out;
    if (typeof pos.forEach === 'function' || pos instanceof Map) {
      pos.forEach(function (v, k) { out[k] = { x: v.x, y: v.y, z: v.z }; });
    } else if (Array.isArray(pos)) {
      for (var i = 0; i < pos.length; i++) { var kv = pos[i]; out[kv[0]] = { x: kv[1].x, y: kv[1].y, z: kv[1].z }; }
    } else {
      for (var k in pos) { var v = pos[k]; out[k] = { x: v.x, y: v.y, z: v.z }; }
    }
    return out;
  }
  function serializePositions2D(p2d) {
    var out = {};
    if (!p2d) return out;
    if (p2d instanceof Map || typeof p2d.forEach === 'function') {
      p2d.forEach(function (v, k) { out[k] = { x: v.x, y: v.y }; });
    } else if (Array.isArray(p2d)) {
      for (var i = 0; i < p2d.length; i++) { var kv = p2d[i]; out[kv[0]] = { x: kv[1].x, y: kv[1].y }; }
    } else {
      for (var k in p2d) { var v = p2d[k]; out[k] = { x: v.x, y: v.y }; }
    }
    return out;
  }
  function serializeCollapsed(c) {
    if (!c) return [];
    if (typeof c.forEach === 'function' && !Array.isArray(c)) { var a = []; c.forEach(function (v) { a.push(v); }); return a; }
    return Array.from(c);
  }
  function serializeLayers(layers) {
    return (layers || []).map(function (l) {
      return {
        id: l.id,
        name: l.name,
        order: l.order,
        nodeIds: l.nodeIds ? (l.nodeIds instanceof Set ? Array.from(l.nodeIds) : (typeof l.nodeIds.forEach === 'function' ? (function () { var a = []; l.nodeIds.forEach(function (v) { a.push(v); }); return a; })() : Array.from(l.nodeIds))) : [],
        positions2D: serializePositions2D(l.positions2D),
      };
    });
  }
  function serializeTreeEdgeLabels(tel) {
    if (!tel) return {};
    if (tel instanceof Map || typeof tel.forEach === 'function') {
      var out = {}; tel.forEach(function (v, k) { out[k] = v; }); return out;
    }
    return tel;
  }

  /**
   * appState.projects 项目对象（web 内存格式）→ 桌面 projectData（扁平）
   * 与桌面 module9_FileIO.saveAllProjects 构造的 projectData 同构
   */
  function buildProjectData(proj) {
    var d = proj.data || {};
    return {
      id: proj.id,
      projectName: proj.name || 'knowledge_graph',
      methodsTree: d.methodsTree || null,
      crossEdges: d.crossEdges || [],
      positions: serializePositions(d.positions),
      positions2D: serializePositions2D(d.positions2D),
      collapsed2D: serializeCollapsed(d.collapsed2D),
      layers: serializeLayers(d.layers),
      currentLayerId: d.currentLayerId || null,
      layer3DSpacing: d.layer3DSpacing != null ? d.layer3DSpacing : 4,
      nodeRichContents: d.nodeRichContents || {},
      overlayImages: d.nodeOverlayImages || d.overlayImages || {},
      nodeHtmlSources: d.nodeHtmlSources || {},
      nodeFileSystems: d.nodeFileSystems || {},
      nodeSandboxHistories: d.nodeSandboxHistories || {},
      nodeActiveModes: d.nodeActiveModes || {},
      treeEdgeLabels: serializeTreeEdgeLabels(d.treeEdgeLabels),
      cameraView: d.cameraView || { position: { x: 0, y: 4.5, z: 8 }, target: { x: 0, y: 0.2, z: 0 } },
    };
  }

  // ════════════════════════════════════════════════════════════
  //  写盘：移植桌面 _writeProjectToDisk（+ 扁平 project.json）
  // ════════════════════════════════════════════════════════════

  function extractDataUriExt(dataUri) {
    var m = String(dataUri || '').match(/^data:(?:image|video|audio)\/([\w+]+);/);
    if (!m) return 'bin';
    var ext = m[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    return ext;
  }
  function dataUriBase64(dataUri) {
    var parts = String(dataUri || '').split(',');
    return parts[1] || '';
  }
  var MIME_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', flac: 'audio/flac',
  };

  /** 移植桌面 helpers.js saveOverlays */
  function saveOverlays(overlaysDir, overlays) {
    return fsc.ensureDir(overlaysDir).then(function () {
      var manifest = [];
      var imgIdx = 0, vidIdx = 0, audIdx = 0, excIdx = 0, docIdx = 0;
      var jobs = [];
      var pad = function (n) { return String(n).padStart(3, '0'); };

      (overlays || []).forEach(function (overlay) {
        var item = Object.assign({}, overlay);

        if ((item.type === 'image' || !item.type) && item.src && String(item.src).startsWith('data:')) {
          imgIdx++;
          var f1 = 'overlay_' + pad(imgIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc.writeBase64(overlaysDir + '/' + f1, dataUriBase64(item.src)));
          item.src = f1;
        } else if (item.type === 'video' && item.src && String(item.src).startsWith('data:')) {
          vidIdx++;
          var f2 = 'video_' + pad(vidIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc.writeBase64(overlaysDir + '/' + f2, dataUriBase64(item.src)));
          item.src = f2;
        } else if (item.type === 'audio' && item.src && String(item.src).startsWith('data:')) {
          audIdx++;
          var f3 = 'audio_' + pad(audIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc.writeBase64(overlaysDir + '/' + f3, dataUriBase64(item.src)));
          item.src = f3;
        }

        if (item.type === 'document' && item.src && String(item.src).startsWith('data:')) {
          docIdx++;
          var f4 = 'doc_' + pad(docIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc.writeBase64(overlaysDir + '/' + f4, dataUriBase64(item.src)));
          item.src = f4;
        }

        if (item.type === 'excel' && item.univerSnapshot) {
          excIdx++;
          var f5 = 'excel_' + pad(excIdx) + '.json';
          jobs.push(fsc.writeText(overlaysDir + '/' + f5, JSON.stringify(item.univerSnapshot)));
          item.univerSnapshotFile = f5;
          delete item.univerSnapshot;
        }

        if (item.type === 'slideshow' && item.slides) {
          var slideIdx = 0;
          item.slides = item.slides.map(function (slide) {
            var s = Object.assign({}, slide);
            if (s.src && String(s.src).startsWith('data:')) {
              slideIdx++;
              var f6 = 'slide_' + pad(slideIdx) + '.' + extractDataUriExt(s.src);
              jobs.push(fsc.writeBase64(overlaysDir + '/' + f6, dataUriBase64(s.src)));
              s.src = f6;
            }
            return s;
          });
        }

        manifest.push(item);
      });

      return Promise.all(jobs).then(function () {
        return fsc.writeText(overlaysDir + '/manifest.json', JSON.stringify(manifest, null, 2));
      });
    });
  }

  /** 移植桌面 helpers.js loadOverlays（视频/音频桌面还原为 astroknot-local:// 绝对路径，平板无绝对路径语义 → 保持文件名由上层按磁盘文件回退） */
  function loadOverlays(overlaysDir) {
    return fsc.stat(overlaysDir + '/manifest.json').then(function (st) {
      if (!st || st.isDir) return null;
      return fsc.readText(overlaysDir + '/manifest.json').then(function (raw) {
        var manifest = JSON.parse(raw);
        var jobs = [];
        var resolveMedia = function (item) {
          var src = String(item.src || '');
          if ((item.type === 'image' || !item.type) && src && !src.startsWith('data:') && !src.startsWith('http')) {
            jobs.push(fsc.readBase64(overlaysDir + '/' + src).then(function (b64) {
              var ext = (src.split('.').pop() || '').toLowerCase();
              item.src = 'data:' + (MIME_MAP[ext] || 'application/octet-stream') + ';base64,' + b64;
            }).catch(function () {}));
          } else if ((item.type === 'video' || item.type === 'audio') && src && !src.startsWith('data:') && !src.startsWith('http')) {
            // 桌面读回 astroknot-local:// 本地路径；平板 WebView 无对应协议注册，
            // 保留文件名（overlay 保留在磁盘，重保存时仍按文件回写）
            item.srcType = 'file';
          }
          if (item.type === 'excel' && item.univerSnapshotFile) {
            jobs.push(fsc.readText(overlaysDir + '/' + item.univerSnapshotFile).then(function (raw2) {
              item.univerSnapshot = JSON.parse(raw2);
            }).catch(function () {}));
          }
        };
        manifest.forEach(resolveMedia);
        return Promise.all(jobs).then(function () { return manifest; });
      });
    });
  }

  /** VFS 树 → sandbox 磁盘（移植桌面 _writeFileSystemToDisk；跳过 node_modules 已在上层保证） */
  function writeFileSystemToDisk(vfs, dirPath) {
    if (!vfs || !vfs.children) return Promise.resolve();
    var jobs = [];
    vfs.children.forEach(function (child) {
      var p = fsc.join(dirPath, child.name);
      if (child.type === 'file') {
        if (child.isBinary && child.content) jobs.push(fsc.writeBase64(p, child.content));
        else jobs.push(fsc.writeText(p, child.content || ''));
      } else if (child.type === 'directory') {
        jobs.push(fsc.ensureDir(p).then(function () { return writeFileSystemToDisk(child, p); }));
      }
    });
    return Promise.all(jobs);
  }

  /** sandbox 磁盘 → VFS 树（移植 _readFileSystemFromDiskBinary，skipNodeModules） */
  var BINARY_EXTENSIONS = ['png','jpg','jpeg','gif','bmp','ico','webp','tiff','tif','svg','mp3','wav','ogg','flac','aac','m4a','wma','mp4','webm','avi','mov','mkv','wmv','flv','zip','gz','tar','rar','7z','bz2','woff','woff2','ttf','otf','eot','pdf','exe','dll','so','dylib','bin','dat','psd','ai','sketch','xd'];
  var LANG_MAP = { html:'html', htm:'html', css:'css', scss:'scss', less:'less', js:'javascript', mjs:'javascript', ts:'typescript', tsx:'typescript', jsx:'javascript', json:'json', md:'markdown', py:'python', xml:'xml', svg:'xml', yaml:'yaml', yml:'yaml', txt:'plaintext', sql:'sql' };
  function readFileSystemFromDisk(dirPath, skipNodeModules) {
    return fsc.stat(dirPath).then(function (st) {
      if (!st || !st.isDir) return null;
      return fsc.listDir(dirPath).then(function (items) {
        var jobs = [];
        var children = [];
        items.forEach(function (entry) {
          if (skipNodeModules && entry.isDir && entry.name === 'node_modules') return;
          var p = fsc.join(dirPath, entry.name);
          if (entry.isDir) {
            jobs.push(readFileSystemFromDisk(p, skipNodeModules).then(function (sub) {
              if (sub) children.push(sub);
            }));
          } else {
            var ext = (entry.name.split('.').pop() || '').toLowerCase();
            if (BINARY_EXTENSIONS.indexOf(ext) >= 0) {
              jobs.push(fsc.readBase64(p).then(function (b64) {
                children.push({ type: 'file', name: entry.name, content: b64, language: LANG_MAP[ext] || 'plaintext', isBinary: true });
              }));
            } else {
              jobs.push(fsc.readText(p).then(function (txt) {
                children.push({ type: 'file', name: entry.name, content: txt, language: LANG_MAP[ext] || 'plaintext', isBinary: false });
              }));
            }
          }
        });
        return Promise.all(jobs).then(function () {
          children.sort(function (a, b) {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return { type: 'directory', name: fsc.basename(dirPath), children: children };
        });
      });
    });
  }

  /** IDE 会话中的节点（ide-fs-shim 维护）→ 跳过 sandbox 重写 */
  function isIdeActive(nodeId) {
    return !!(window.FSCore && window.FSCore.ideActiveNodes && window.FSCore.ideActiveNodes.has(nodeId));
  }

  /**
   * 生成 project.md（移植桌面 helpers.js generateProjectMd，人类可读摘要）
   * 与桌面输出逐字段一致，桌面/平板项目文件夹可互换
   */
  function generateProjectMd(projectCore, nodeRichContents, overlayImages) {
    var projectName = projectCore.projectName || '知识图谱';
    var md = '# 🌳 ' + projectName + '\n\n';
    md += '> 由 AstroKnot 自动生成 · 仅供阅读，请勿手动编辑\n\n';

    var allNodes = [];
    (function collectNodes(node) {
      if (!node) return;
      if (node.id !== '__VIRTUAL_ROOT__') allNodes.push(node);
      if (node.children) node.children.forEach(collectNodes);
    })(projectCore.methodsTree);

    md += '## 📋 节点概览\n\n';
    md += '| ID | 名称 | 步骤 | 3D位置 | 内容 |\n';
    md += '|----|------|------|--------|------|\n';
    var positions = projectCore.positions || {};
    allNodes.forEach(function (node) {
      var pos = positions[node.id] || {};
      var tags = [];
      if (nodeRichContents && nodeRichContents[node.id]) tags.push('📝');
      if (overlayImages && overlayImages[node.id] && overlayImages[node.id].length > 0) tags.push('🖼️');
      md += '| `' + node.id + '` | ' + (node.name || '') + ' | ' + (node.isStepFlow ? '✅' : '❌')
        + ' | (' + (pos.x || 0) + ', ' + (pos.y || 0) + ', ' + (pos.z || 0) + ') | ' + (tags.join(' ') || '—') + ' |\n';
    });

    var crossEdges = projectCore.crossEdges || [];
    if (crossEdges.length > 0) {
      md += '\n## 🔗 跨层连线\n\n';
      md += '| 来源 | 目标 | 颜色 | 标签 |\n';
      md += '|------|------|------|------|\n';
      crossEdges.forEach(function (edge) {
        md += '| `' + edge.sourceId + '` | `' + edge.targetId + '` | ' + (edge.customColor || '') + ' | ' + (edge.label || '') + ' |\n';
      });
    }

    var layers = projectCore.layers || [];
    if (layers.length > 0) {
      md += '\n## 📚 图层\n\n';
      layers.forEach(function (layer) {
        md += '- **' + layer.name + '** (' + ((layer.nodeIds || []).length) + ' 个节点)\n';
      });
    }
    return md;
  }

  /**
   * 项目数据写入指定目录（project.json + nodes/ + project.md），移植桌面 _writeProjectToDisk
   * project.json 字段与桌面完全一致（桌面实测 12 字段）：节点级大字段
   * （nodeRichContents/overlayImages/nodeFileSystems）落 nodes/ 文件夹，
   * 平板运行时字段（id/layer3DSpacing/nodeActiveModes）不落盘
   * @param {string} savePath - 根内虚拟路径（如 projects/我的项目）
   * @param {Object} projectData - 桌面扁平 projectData
   */
  function writeProjectToDisk(savePath, projectData) {
    var nodesDir = fsc.join(savePath, 'nodes');
    var nodeRichContents = projectData.nodeRichContents || {};
    var overlayImages = projectData.overlayImages || {};
    var nodeFileSystems = projectData.nodeFileSystems || {};
    var flatCore = Object.assign({}, projectData);
    ['savePath', 'id', 'nodeRichContents', 'overlayImages', 'nodeFileSystems',
      'nodeActiveModes', 'layer3DSpacing'].forEach(function (k) { delete flatCore[k]; });

    // 收集当前节点，建立 nodeId → node 映射（桌面同款）
    var currentNodes = collectTreeNodeIds(flatCore.methodsTree);
    var nodeMap = new Map(currentNodes.map(function (n) { return [n.id, n]; }));
    [nodeRichContents, overlayImages, nodeFileSystems].forEach(function (src) {
      Object.keys(src).forEach(function (id) {
        if (!nodeMap.has(id)) nodeMap.set(id, { id: id, name: '未知节点' });
      });
    });
    var currentFolderNames = new Set(Array.from(nodeMap.values()).map(getNodeFolderName));

    return fsc.ensureDir(savePath).then(function () {
      return fsc.ensureDir(nodesDir);
    }).then(function () {
      return fsc.writeText(fsc.join(savePath, 'project.json'), JSON.stringify(flatCore, null, 2));
    }).then(function () {
      // 清理已不存在节点的文件夹（桌面同款；桌面 project.json 无 id 字段不影响）
      return fsc.listDir(nodesDir).then(function (items) {
        var rmJobs = [];
        items.forEach(function (entry) {
          if (entry.isDir && !currentFolderNames.has(entry.name)) {
            rmJobs.push(fsc.rmrf(fsc.join(nodesDir, entry.name)));
          }
        });
        return Promise.all(rmJobs);
      });
    }).then(function () {
      // content.html → nodes/<nodeId>/content.html（桌面同款）
      var jobs = [];
      Object.keys(nodeRichContents).forEach(function (nodeId) {
        var nodeDir = fsc.join(nodesDir, nodeId);
        jobs.push(fsc.ensureDir(nodeDir).then(function () {
          return fsc.writeText(fsc.join(nodeDir, 'content.html'), String(nodeRichContents[nodeId] == null ? '' : nodeRichContents[nodeId]));
        }));
      });
      return Promise.all(jobs);
    }).then(function () {
      // overlays → nodes/<安全名_id8>/overlays/（桌面同款）
      var jobs = [];
      Object.keys(overlayImages).forEach(function (nodeId) {
        var overlays = overlayImages[nodeId];
        if (!overlays || !overlays.length) return;
        var node = nodeMap.get(nodeId);
        var folderName = node ? getNodeFolderName(node) : sanitizeNodeFolderName('未知节点') + '_' + nodeId.slice(0, 8);
        jobs.push(saveOverlays(fsc.join(nodesDir, folderName, 'overlays'), overlays));
      });
      return Promise.all(jobs);
    }).then(function () {
      // sandbox → nodes/<安全名_id8>/sandbox/（桌面同款；IDE 会话节点跳过防覆盖）
      var jobs = [];
      Object.keys(nodeFileSystems).forEach(function (nodeId) {
        var fileSystem = nodeFileSystems[nodeId];
        if (!fileSystem) return;
        if (isIdeActive(nodeId)) {
          console.log('[project-fs] 节点 IDE 会话中，跳过 sandbox 重写:', nodeId);
          return;
        }
        var node = nodeMap.get(nodeId);
        var folderName = node ? getNodeFolderName(node) : sanitizeNodeFolderName('未知节点') + '_' + nodeId.slice(0, 8);
        var sandboxDir = fsc.join(nodesDir, folderName, 'sandbox');
        jobs.push(fsc.rmrf(sandboxDir).then(function () {
          return writeFileSystemToDisk(fileSystem, sandboxDir);
        }));
      });
      return Promise.all(jobs);
    }).then(function () {
      // project.md（桌面同款人类可读摘要，最后生成与桌面一致）
      return fsc.writeText(fsc.join(savePath, 'project.md'), generateProjectMd(flatCore, nodeRichContents, overlayImages));
    });
  }

  // ════════════════════════════════════════════════════════════
  //  读盘：移植桌面 _readProjectData（文件夹名解析增强）
  // ════════════════════════════════════════════════════════════

  /**
   * 读取项目文件夹 → 桌面扁平 data（含 nodeRichContents/overlayImages/nodeFileSystems）
   * @returns {Promise<Object|null>} null = 无效项目文件夹
   */
  function readProjectData(folderPath) {
    return fsc.stat(fsc.join(folderPath, 'project.json')).then(function (st) {
      if (!st || st.isDir) return null;
      return fsc.readText(fsc.join(folderPath, 'project.json')).then(function (raw) {
        var projectCore = JSON.parse(raw);
        var nodesDir = fsc.join(folderPath, 'nodes');

        // id8 → fullId 映射（兼容桌面 nodes/<安全名_id8>/ 文件夹命名）
        var idBy8 = new Map();
        var fullIds = new Set();
        collectTreeNodeIds(projectCore.methodsTree).forEach(function (n) {
          fullIds.add(n.id);
          if (!idBy8.has(n.id.slice(0, 8))) idBy8.set(n.id.slice(0, 8), n.id);
        });
        function resolveNodeId(folderName) {
          if (fullIds.has(folderName)) return folderName;             // nodes/<fullId>/content.html
          var m = folderName.match(/_([^_]+)$/);                       // <安全名_id8>
          if (m && idBy8.has(m[1])) return idBy8.get(m[1]);
          var legacy = folderName.match(/_(.+)$/);                     // 桌面解析规则兜底
          return legacy ? legacy[1] : folderName;
        }

        var nodeRichContents = projectCore.nodeRichContents || {};
        var overlayImages = projectCore.overlayImages || {};
        var nodeFileSystems = projectCore.nodeFileSystems || {};

        return fsc.listDir(nodesDir).then(function (items) {
          var jobs = [];
          items.forEach(function (entry) {
            if (!entry.isDir) return;
            var folderName = entry.name;
            var nodeDir = fsc.join(nodesDir, folderName);
            var nodeId = resolveNodeId(folderName);

            jobs.push(fsc.stat(fsc.join(nodeDir, 'content.html')).then(function (st2) {
              if (!st2 || st2.isDir) return;
              return fsc.readText(fsc.join(nodeDir, 'content.html')).then(function (content) {
                nodeRichContents[nodeId] = content;
              });
            }));
            jobs.push(fsc.stat(fsc.join(nodeDir, 'overlays', 'manifest.json')).then(function (st3) {
              if (!st3 || st3.isDir) return;
              return loadOverlays(fsc.join(nodeDir, 'overlays')).then(function (overlays) {
                if (overlays && overlays.length) overlayImages[nodeId] = overlays;
              });
            }));
            jobs.push(fsc.stat(fsc.join(nodeDir, 'sandbox')).then(function (st4) {
              if (!st4 || !st4.isDir) return;
              return readFileSystemFromDisk(fsc.join(nodeDir, 'sandbox'), true).then(function (tree) {
                if (tree && tree.children && tree.children.length) {
                  tree.name = '/';
                  nodeFileSystems[nodeId] = tree;
                }
              });
            }));
          });
          return Promise.all(jobs).then(function () {
            var data = Object.assign({}, projectCore, {
              nodeRichContents: nodeRichContents,
              overlayImages: overlayImages,
              nodeFileSystems: nodeFileSystems,
            });
            return data;
          });
        });
      });
    }).catch(function (e) {
      console.warn('[project-fs] 读取项目失败:', folderPath, e);
      return null;
    });
  }

  /** 桌面扁平 data → module2 可恢复格式（_restoreFromLocalStorage 输入形状） */
  function toWebProjectEntry(data, folderPath, folderName) {
    // id 优先取 project.json 内记录（平板自写项目）；导入的桌面项目用
    // folderPath 稳定哈希生成（跨重启不变，currentId 不失效）
    var projId = data.id || ('proj_h' + Math.abs(hashStr(folderPath)).toString(36));
    return {
      id: projId,
      name: data.projectName || folderName,
      folderPath: folderPath,
      data: {
        methodsTree: data.methodsTree || { id: '__VIRTUAL_ROOT__', name: '(虚拟根)', desc: '', children: [] },
        crossEdges: data.crossEdges || [],
        // positions 以数组对传递 → _restoreFromLocalStorage 转回 Map<Vector3>
        positions: Object.entries(data.positions || {}),
        positions2D: data.positions2D || {},
        collapsed2D: data.collapsed2D || [],
        nodeRichContents: data.nodeRichContents || {},
        nodeOverlayImages: data.overlayImages || {},
        nodeHtmlSources: data.nodeHtmlSources || {},
        nodeFileSystems: data.nodeFileSystems || {},
        nodeActiveModes: data.nodeActiveModes || {},
        nodeSandboxHistories: data.nodeSandboxHistories || {},
        layers: (data.layers || []).map(function (l) {
          return {
            id: l.id, name: l.name, order: l.order,
            nodeIds: Array.isArray(l.nodeIds) ? l.nodeIds : Array.from(l.nodeIds || []),
            positions2D: l.positions2D instanceof Map ? Object.fromEntries(l.positions2D) : (l.positions2D || {}),
          };
        }),
        currentLayerId: data.currentLayerId || null,
        layer3DSpacing: data.layer3DSpacing != null ? data.layer3DSpacing : 4,
        treeEdgeLabels: data.treeEdgeLabels || {},
        cameraView: data.cameraView || { position: { x: 0, y: 4.5, z: 8 }, target: { x: 0, y: 0.2, z: 0 } },
      },
    };
  }
  function hashStr(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return h;
  }

  // ════════════════════════════════════════════════════════════
  //  启动预载：扫 projects/*/project.json
  // ════════════════════════════════════════════════════════════

  function init() {
    if (!fsc.isReady() || !fsc.available()) {
      failed = true;
      ready = true;
      console.warn('[project-fs] fs-core 不可用，项目层保持 localStorage 模式');
      return Promise.resolve(false);
    }
    return fsc.listDir(PROJECTS).then(function (items) {
      var dirs = items.filter(function (it) { return it.isDir; });
      var jobs = dirs.map(function (dir) {
        var folderPath = fsc.join(PROJECTS, dir.name);
        return readProjectData(folderPath).then(function (data) {
          if (!data) return null;
          var entry = toWebProjectEntry(data, folderPath, dir.name);
          entry._savedAt = 0; // 由 project.json mtime 补充
          return fsc.stat(fsc.join(folderPath, 'project.json')).then(function (st) {
            entry._savedAt = (st && st.mtime) || 0;
            return entry;
          });
        });
      });
      return Promise.all(jobs);
    }).then(function (entries) {
      projectList = entries.filter(Boolean);
      // 同 id 去重（项目改名后遗留的旧文件夹）：保留 mtime 最新的
      var byId = new Map();
      projectList.forEach(function (e) {
        var prev = byId.get(e.id);
        if (!prev || (e._savedAt || 0) > (prev._savedAt || 0)) byId.set(e.id, e);
      });
      projectList = Array.from(byId.values());
      // 按 project.json mtime 降序（桌面 listProjects 同款）
      projectList.sort(function (a, b) { return (b._savedAt || 0) - (a._savedAt || 0); });
      // currentId 由键值层（systemStorageFs）预载后提供
      var ssf = window.SystemStorageFs;
      if (ssf && ssf.isReady()) {
        var raw = ssf.get('astroknot_web_projects_current');
        if (raw) currentId = String(raw).replace(/^"|"$/g, '');
      }
      ready = true;
      console.log('[project-fs] 项目层预载完成:', projectList.length, '个项目, currentId =', currentId);
      return true;
    }).catch(function (e) {
      failed = true;
      ready = true;
      console.warn('[project-fs] 预载失败，项目层保持 localStorage 模式:', e);
      return false;
    });
  }

  // ════════════════════════════════════════════════════════════
  //  保存接口（module2 _persistToLocalStorage 调用）
  // ════════════════════════════════════════════════════════════

  /** 防抖保存全部项目（module2 同步调用，内部异步串行写盘） */
  function projectSaveAll(projects, projCurrentId) {
    if (failed || !fsc.isReady()) return;
    pendingSave = {
      projects: (projects || []).map(function (p) { return { id: p.id, name: p.name, data: p.data }; }),
      currentId: projCurrentId || null,
    };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }

  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    var args = pendingSave;
    pendingSave = null;
    if (!args) return;
    writeChain = writeChain.then(function () {
      return doSaveAll(args.projects, args.currentId);
    }).catch(function (e) {
      console.warn('[project-fs] 保存失败:', e);
    });
    return writeChain;
  }

  function doSaveAll(projects, projCurrentId) {
    var _t0 = performance.now();
    // 更新 currentId 文件（键值层文件化）
    var ssf = window.SystemStorageFs;
    if (ssf && ssf.isReady() && !ssf.isFailed()) {
      ssf.set('astroknot_web_projects_current', projCurrentId || '');
    }
    currentId = projCurrentId || currentId;

    var liveList = (window.appState && window.appState.projects) || [];
    var jobs = [];
    projects.forEach(function (p) {
      if (!p.data || !p.data.methodsTree) return;
      // 防复活：快照里的项目在 flush 时刻已从内存清单移除（如刚被删除）
      // → 跳过写盘，否则延迟落盘会把已移入回收站的项目文件夹写回 projects/
      if (!liveList.some(function (x) { return x.id === p.id; })) {
        console.log('[project-fs] 跳过已不在内存清单的项目（防复活）:', p.name);
        return;
      }
      var folderName = sanitizeProjectFolderName(p.name);
      var savePath = fsc.join(PROJECTS, folderName);
      jobs.push(
        writeProjectToDisk(savePath, buildProjectData(p)).then(function () {
          // 同步内存中的 folderPath（供 IDE sandbox 定位/回收站 rename）；
          // 仅当旧值为我们 projects/ 内的路径或为空时更新（防覆盖外部路径）
          var live = (window.appState && window.appState.projects || []).find(function (x) { return x.id === p.id; });
          if (live && (!live.folderPath || String(live.folderPath).indexOf(PROJECTS + '/') === 0)) {
            live.folderPath = savePath;
          }
          var entry = projectList.find(function (x) { return x.id === p.id; });
          if (entry) { entry.folderPath = savePath; entry.name = p.name; }
          else projectList.unshift({ id: p.id, name: p.name, folderPath: savePath, data: null });
        }).catch(function (e) {
          console.warn('[project-fs] 项目写盘失败:', p.name, e);
        })
      );
    });
    return Promise.all(jobs).then(function () {
      console.log('[perf] doSaveAll 项目数=' + jobs.length + ' 耗时=' + Math.round(performance.now() - _t0) + 'ms');
    });
  }

  /** module2 _restoreFromLocalStorage 平板分支：取预载项目清单 */
  function takeProjects() {
    return projectList.map(function (entry) {
      // 深拷贝一层避免 initProjects 多次 push 引用复用
      return JSON.parse(JSON.stringify(entry));
    });
  }

  /**
   * 注册外部导入的项目（桌面同步导入等）进文件层清单。
   * folderPath 已存在 → 仅更新名称并复用其 id（覆盖导入语义）；
   * 否则 unshift 新清单项（data 为 null，打开时走 folderPath 懒加载）。
   * 返回项目 id 供调用方同步进 appState.projects。
   */
  function registerExternalProject(name, folderPath) {
    var exist = projectList.find(function (x) { return x.folderPath === folderPath; });
    if (exist) { exist.name = name; return exist.id; }
    var id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    projectList.unshift({ id: id, name: name, folderPath: folderPath, data: null });
    return id;
  }

  // ════════════════════════════════════════════════════════════
  //  回收站 5 接口 + 项目文件夹删除（桌面 IPC 同名同语义）
  // ════════════════════════════════════════════════════════════

  function moveProjectToTrash(payload) {
    var folderPath = payload && payload.folderPath;
    var projectId = payload && payload.projectId;
    var projectName = (payload && payload.projectName) || '未命名项目';
    var projectData = payload && payload.projectData;
    var _t0 = performance.now();
    var _lap = function () { var d = performance.now() - _t0; _t0 = performance.now(); return Math.round(d); };
    // 安全防护：仅当 folderPath 指向本应用 projects/ 内才允许「整体 rename」。
    // folderPath 为 null/外部路径时绝不能落进 fsc.stat('')（那会命中存储根，
    // 把整个 AstroKnot-Data rename/拷贝进回收站）。
    var isManaged = typeof folderPath === 'string' && folderPath.indexOf(PROJECTS + '/') === 0;
    return fsc.ensureDir(TRASH).then(function () {
      return fsc.listDir(TRASH);
    }).then(function (items) {
      var listDirMs = _lap();
      var existing = new Set(items.map(function (it) { return it.name; }));
      var targetName = sanitizeProjectFolderName(projectName);
      if (existing.has(targetName)) targetName = targetName + '_' + Date.now();
      var targetPath = fsc.join(TRASH, targetName);
      var ensureWritten = !isManaged
        ? projectData
          ? // 未保存/无有效路径项目：用内存数据直接写进回收站
            writeProjectToDisk(targetPath, projectData)
          : Promise.reject(new Error('未保存项目缺少 projectData，无法移入回收站'))
        : fsc.stat(folderPath).then(function (st) {
            var wasSaved = !!(st && st.isDir);
            if (!wasSaved) {
              // folderPath 记录已失效（文件夹不在磁盘）→ 用内存数据写入
              if (projectData) return writeProjectToDisk(targetPath, projectData);
              return Promise.reject(new Error('项目文件夹不存在且缺少 projectData'));
            }
            // 已落盘项目：整个文件夹移入回收站
            return fsc.rename(folderPath, targetPath).catch(function (re) {
              console.warn('[project-fs] rename 失败，退化复制删除:', re && re.message);
              return copyDir(folderPath, targetPath).then(function () { return fsc.rmrf(folderPath); });
            });
          });
      return ensureWritten.then(function () {
        var moveMs = _lap();
        var meta = {
          projectId: projectId || null,
          projectName: projectName,
          originalPath: folderPath || null,
          deletedAt: nowIso(),
          wasUnsaved: !isManaged,
        };
        return fsc.writeText(fsc.join(targetPath, '.trash-meta.json'), JSON.stringify(meta, null, 2))
          .then(function () {
            console.log('[perf] moveProjectToTrash 方式=' + (isManaged ? (moveMs > 1500 ? 'rename/复制?' : 'rename') : '数据写入') +
              ' 建目录列目录=' + listDirMs + 'ms 移动=' + moveMs + 'ms 元数据=' + _lap() + 'ms → ' + targetPath);
            return { success: true, trashPath: targetPath };
          });
      });
    }).catch(function (e) {
      console.error('[project-fs] moveProjectToTrash 错误:', e);
      return { success: false, error: e.message };
    });
  }

  function listTrash() {
    var _t0 = performance.now();
    // trash 目录不存在时 readdir reject → listDir 返回 []，无需 ensureDir（省 2 次桥调用）
    return fsc.listDir(TRASH).then(function (items) {
      var jobs = items.filter(function (it) { return it.isDir; }).map(function (dir) {
        var itemPath = fsc.join(TRASH, dir.name);
        return fsc.readText(fsc.join(itemPath, '.trash-meta.json')).then(function (raw) {
          return JSON.parse(raw);
        }).catch(function () { return {}; }).then(function (meta) {
          return {
            trashPath: itemPath,
            folderName: dir.name,
            projectName: meta.projectName || dir.name,
            projectId: meta.projectId || null,
            originalPath: meta.originalPath || null,
            deletedAt: meta.deletedAt || null,
            wasUnsaved: meta.wasUnsaved || false,
          };
        });
      });
      return Promise.all(jobs);
    }).then(function (list) {
      list.sort(function (a, b) { return String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')); });
      console.log('[perf] listTrash 项数=' + list.length + ' 耗时=' + Math.round(performance.now() - _t0) + 'ms');
      return { success: true, items: list };
    }).catch(function (e) {
      console.error('[project-fs] listTrash 错误:', e);
      return { success: false, error: e.message, items: [] };
    });
  }

  function restoreFromTrash(payload) {
    var trashPath = payload && payload.trashPath;
    if (!trashPath || trashPath.indexOf(TRASH + '/') !== 0) {
      return Promise.resolve({ success: false, error: '回收站项目不存在' });
    }
    return fsc.stat(trashPath).then(function (st) {
      if (!st || !st.isDir) return { success: false, error: '回收站项目不存在' };
      return fsc.readText(fsc.join(trashPath, '.trash-meta.json')).catch(function () { return '{}'; }).then(function (raw) {
        var meta = {};
        try { meta = JSON.parse(raw) || {}; } catch (e) { /* 无 meta */ }
        var name = sanitizeProjectFolderName(meta.projectName || fsc.basename(trashPath));
        var restorePath = fsc.join(PROJECTS, name);
        var ensureUnique = function () {
          return fsc.stat(restorePath).then(function (s2) {
            if (!s2) return restorePath;
            restorePath = fsc.join(PROJECTS, name + '_' + Date.now());
            return restorePath;
          });
        };
        return ensureUnique().then(function (target) {
          return fsc.rename(trashPath, target).catch(function () {
            return copyDir(trashPath, target).then(function () { return fsc.rmrf(trashPath); });
          }).then(function () {
            return fsc.remove(fsc.join(target, '.trash-meta.json'));
          }).then(function () {
            console.log('[project-fs] 已恢复到:', target);
            return { success: true, folderPath: target, projectName: meta.projectName || fsc.basename(target) };
          });
        });
      });
    }).catch(function (e) {
      console.error('[project-fs] restoreFromTrash 错误:', e);
      return { success: false, error: e.message };
    });
  }

  function permanentlyDeleteTrashItem(payload) {
    var trashPath = payload && payload.trashPath;
    if (!trashPath) return Promise.resolve({ success: false });
    return fsc.rmrf(trashPath).then(function () { return { success: true }; })
      .catch(function (e) { return { success: false, error: e.message }; });
  }

  function emptyTrash() {
    return fsc.ensureDir(TRASH).then(function () {
      return fsc.listDir(TRASH);
    }).then(function (items) {
      var jobs = items.filter(function (it) { return it.isDir; }).map(function (dir) {
        return fsc.rmrf(fsc.join(TRASH, dir.name));
      });
      return Promise.all(jobs).then(function () { return { success: true, count: jobs.length }; });
    }).catch(function (e) {
      return { success: false, error: e.message };
    });
  }

  /** 永久删除项目（module2 永久删除分支调用） */
  function deleteProjectFolder(folderPath) {
    if (!folderPath) return Promise.resolve({ success: false, error: '路径为空' });
    return fsc.rmrf(folderPath).then(function () { return { success: true }; })
      .catch(function (e) { return { success: false, error: e.message }; });
  }
  function deleteSandboxTmpFolder(nodeId) {
    return fsc.rmrf(fsc.join('sandbox-tmp', nodeId)).then(function () { return { success: true }; })
      .catch(function (e) { return { success: false, error: e.message }; });
  }

  /** 递归复制目录（rename 失败的兜底） */
  function copyDir(from, to) {
    return fsc.ensureDir(to).then(function () {
      return fsc.listDir(from).then(function (items) {
        var jobs = items.map(function (it) {
          var src = fsc.join(from, it.name);
          var dst = fsc.join(to, it.name);
          if (it.isDir) return copyDir(src, dst);
          return fsc.stat(src).then(function (st) {
            if (st && st.size > 10 * 1024 * 1024) return null; // 大文件跳过（与 IDE 导入规则一致）
            return fsc.readBase64(src).then(function (b64) { return fsc.writeBase64(dst, b64); });
          });
        });
        return Promise.all(jobs);
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  //  挂载 window.api（web-api-shim 之后加载，Object.assign 防覆盖）
  // ════════════════════════════════════════════════════════════

  if (!window.api) window.api = {};
  Object.assign(window.api, {
    moveProjectToTrash: moveProjectToTrash,
    listTrash: listTrash,
    restoreFromTrash: restoreFromTrash,
    permanentlyDeleteTrashItem: permanentlyDeleteTrashItem,
    emptyTrash: emptyTrash,
    deleteProjectFolder: deleteProjectFolder,
    deleteSandboxTmpFolder: deleteSandboxTmpFolder,
    readProjectFromFolder: function (folderPath) {
      return readProjectData(folderPath).then(function (data) {
        if (!data) return { success: false, error: '项目文件夹不存在或缺少 project.json' };
        return { success: true, data: data, folderName: fsc.basename(folderPath), folderPath: folderPath };
      });
    },
    loadProjectFromFolder: function (folderPath) {
      return window.api.readProjectFromFolder(folderPath);
    },
  });

  window.ProjectFsShim = {
    init: init,
    flushSave: flushSave,
    projectSaveAll: projectSaveAll,
    takeProjects: takeProjects,
    registerExternalProject: registerExternalProject,
    isReady: function () { return ready && !failed; },
    get currentId() { return currentId; },
    getProjects: function () { return projectList; },
    readProjectData: readProjectData,
    writeProjectToDisk: writeProjectToDisk,
    buildProjectData: buildProjectData,
    toWebProjectEntry: toWebProjectEntry,
    sanitizeProjectFolderName: sanitizeProjectFolderName,
    getNodeFolderName: getNodeFolderName,
  };

  console.log('[project-fs] 项目布局层垫片已加载');
})();
