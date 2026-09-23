// ============================================================
// AstroKnot Tablet - notes-fs-shim.js — 日记 + 快速笔记 文件层垫片
//
// 桌面语义（main/ipc-file/diary.js + quick-notes.js + helpers.js）：
//   日记: <数据根>/diaries/<YYYY-MM>/<YYYY-MM-DD>.html
//         <数据根>/diaries/diary-index.json（[{date,title,updatedAt,createdAt}]，2空格缩进）
//   快速笔记: <数据根>/quicknotes/quicknotes.json（清单 [{id,title,folder}]，2空格缩进）
//             quicknotes/<安全名_id前8位>/content.html | drawdata.json | mode.json
//               | filesystem.json | sandbox_history.json | overlays/(manifest.json + 媒体)
//   保存时清理孤儿文件夹（qnote_ 前缀或含 _qnote_）与重命名前的旧目录
// 加载顺序：web-api-shim.js 之后（合并进 window.api）；FSCore 就绪前惰性等待
// ============================================================
(function () {
  'use strict';

  function fsc() { return window.FSCore; }

  /** 等 FSCore 加载并就绪（本垫片加载早于 fs-core.js，需容忍 FSCore 尚未定义） */
  function waitReady() {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      var timer = setInterval(function () {
        var core = fsc();
        if (core && core.isReady()) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 15000) { clearInterval(timer); reject(new Error('FSCore 初始化超时')); }
      }, 50);
    });
  }

  // ── 日记（桌面 diary.js 同构） ──

  function isValidDiaryDate(dateStr) {
    return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  }
  function diaryFilePath(dateStr) {
    return 'diaries/' + dateStr.substring(0, 7) + '/' + dateStr + '.html';
  }
  function readDiaryIndex() {
    return fsc().readText('diaries/diary-index.json').then(function (raw) {
      if (!raw) return [];
      try { var d = JSON.parse(raw); return Array.isArray(d) ? d : []; }
      catch (_) { return []; }
    }).catch(function () { return []; });
  }
  function writeDiaryIndex(index) {
    return fsc().writeText('diaries/diary-index.json', JSON.stringify(index, null, 2));
  }
  function extractTitle(content) {
    try {
      var text = String(content || '').replace(/<[^>]*>/g, '').trim();
      return text.substring(0, 30);
    } catch (_) { return ''; }
  }

  var diaryApi = {
    listDiaries: function () {
      return waitReady().then(readDiaryIndex).then(function (index) {
        return { success: true, diaries: index };
      }).catch(function (e) {
        console.error('[tablet-notes] listDiaries 失败:', e);
        return { success: false, error: e.message, diaries: [] };
      });
    },

    readDiary: function (dateStr) {
      return waitReady().then(function () {
        if (!isValidDiaryDate(dateStr)) return { success: false, error: 'Invalid date format' };
        return fsc().stat(diaryFilePath(dateStr)).then(function (st) {
          if (!st || st.isDir) return { success: true, content: '', exists: false };
          return fsc().readText(diaryFilePath(dateStr)).then(function (content) {
            return { success: true, content: content, exists: true };
          });
        });
      }).catch(function (e) {
        console.error('[tablet-notes] readDiary 失败:', e);
        return { success: false, error: e.message };
      });
    },

    saveDiary: function (dateStr, content) {
      return waitReady().then(function () {
        if (!isValidDiaryDate(dateStr)) return { success: false, error: 'Invalid date format' };
        return fsc().writeText(diaryFilePath(dateStr), content || '').then(function () {
          return readDiaryIndex().then(function (index) {
            var now = new Date().toISOString();
            var title = extractTitle(content);
            var entry = null;
            for (var i = 0; i < index.length; i++) { if (index[i].date === dateStr) { entry = index[i]; break; } }
            if (entry) { entry.title = title; entry.updatedAt = now; }
            else { index.push({ date: dateStr, title: title, updatedAt: now, createdAt: now }); }
            return writeDiaryIndex(index);
          });
        }).then(function () { return { success: true }; });
      }).catch(function (e) {
        console.error('[tablet-notes] saveDiary 失败:', e);
        return { success: false, error: e.message };
      });
    },

    deleteDiary: function (dateStr) {
      return waitReady().then(function () {
        if (!isValidDiaryDate(dateStr)) return { success: false, error: 'Invalid date format' };
        return fsc().remove(diaryFilePath(dateStr)).then(function () {
          return readDiaryIndex().then(function (index) {
            var filtered = index.filter(function (e) { return e.date !== dateStr; });
            return writeDiaryIndex(filtered);
          });
        }).then(function () { return { success: true }; });
      }).catch(function (e) {
        console.error('[tablet-notes] deleteDiary 失败:', e);
        return { success: false, error: e.message };
      });
    },
  };

  // ── 快速笔记（桌面 quick-notes.js 同构） ──

  var QN_ROOT = 'quicknotes';

  function sanitizeNodeFolderName(name) {
    return String(name || '未命名').replace(/[<>:"\\/|?*]/g, '_').slice(0, 50) || '未命名';
  }
  function getNodeFolderName(note) {
    return sanitizeNodeFolderName(note.title || '未命名') + '_' + String(note.id).slice(0, 8);
  }
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
  function pad3(n) { return String(n).padStart(3, '0'); }

  /** 移植桌面 helpers.js saveOverlays（data: URI 提取为二进制/JSON 文件 + manifest.json） */
  function saveOverlays(overlaysDir, overlays) {
    return fsc().ensureDir(overlaysDir).then(function () {
      var manifest = [];
      var imgIdx = 0, vidIdx = 0, audIdx = 0, excIdx = 0, docIdx = 0;
      var jobs = [];

      (overlays || []).forEach(function (overlay) {
        var item = Object.assign({}, overlay);

        if ((item.type === 'image' || !item.type) && item.src && String(item.src).startsWith('data:')) {
          imgIdx++;
          var f1 = 'overlay_' + pad3(imgIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc().writeBase64(overlaysDir + '/' + f1, dataUriBase64(item.src)));
          item.src = f1;
        } else if (item.type === 'video' && item.src && String(item.src).startsWith('data:')) {
          vidIdx++;
          var f2 = 'video_' + pad3(vidIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc().writeBase64(overlaysDir + '/' + f2, dataUriBase64(item.src)));
          item.src = f2;
        } else if (item.type === 'audio' && item.src && String(item.src).startsWith('data:')) {
          audIdx++;
          var f3 = 'audio_' + pad3(audIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc().writeBase64(overlaysDir + '/' + f3, dataUriBase64(item.src)));
          item.src = f3;
        }

        if (item.type === 'document' && item.src && String(item.src).startsWith('data:')) {
          docIdx++;
          var f4 = 'doc_' + pad3(docIdx) + '.' + extractDataUriExt(item.src);
          jobs.push(fsc().writeBase64(overlaysDir + '/' + f4, dataUriBase64(item.src)));
          item.src = f4;
        }

        if (item.type === 'excel' && item.univerSnapshot) {
          excIdx++;
          var f5 = 'excel_' + pad3(excIdx) + '.json';
          jobs.push(fsc().writeText(overlaysDir + '/' + f5, JSON.stringify(item.univerSnapshot)));
          item.univerSnapshotFile = f5;
          delete item.univerSnapshot;
        }

        if (item.type === 'slideshow' && item.slides) {
          var slideIdx = 0;
          item.slides = item.slides.map(function (slide) {
            var s = Object.assign({}, slide);
            if (s.src && String(s.src).startsWith('data:')) {
              slideIdx++;
              var f6 = 'slide_' + pad3(slideIdx) + '.' + extractDataUriExt(s.src);
              jobs.push(fsc().writeBase64(overlaysDir + '/' + f6, dataUriBase64(s.src)));
              s.src = f6;
            }
            return s;
          });
        }

        manifest.push(item);
      });

      return Promise.all(jobs).then(function () {
        return fsc().writeText(overlaysDir + '/manifest.json', JSON.stringify(manifest, null, 2));
      });
    });
  }

  /** 移植桌面 helpers.js loadOverlays（视频/音频桌面还原为 astroknot-local:// 绝对路径，
   *  平板 WebView 无对应协议注册 → 保留文件名由上层按磁盘文件回退，同 project-fs-shim） */
  function loadOverlays(overlaysDir) {
    return fsc().stat(overlaysDir + '/manifest.json').then(function (st) {
      if (!st || st.isDir) return null;
      return fsc().readText(overlaysDir + '/manifest.json').then(function (raw) {
        var manifest = JSON.parse(raw);
        var jobs = [];
        var readAsDataUri = function (dir, src) {
          return fsc().readBase64(dir + '/' + src).then(function (b64) {
            var ext = (src.split('.').pop() || '').toLowerCase();
            return 'data:' + (MIME_MAP[ext] || 'application/octet-stream') + ';base64,' + b64;
          });
        };
        (manifest || []).forEach(function (item) {
          var src = String(item.src || '');
          if ((item.type === 'image' || !item.type) && src && !src.startsWith('data:') && !src.startsWith('http')) {
            jobs.push(readAsDataUri(overlaysDir, src).then(function (uri) { item.src = uri; }).catch(function () {}));
          } else if (item.type === 'document' && src && !src.startsWith('data:') && !src.startsWith('http')) {
            // 桌面：bufferToDataUri + srcType='dataUrl'
            jobs.push(readAsDataUri(overlaysDir, src).then(function (uri) {
              item.src = uri; item.srcType = 'dataUrl';
            }).catch(function () {}));
          } else if ((item.type === 'video' || item.type === 'audio') && src && !src.startsWith('data:') && !src.startsWith('http')) {
            item.srcType = 'file';
          }
          if (item.type === 'excel' && item.univerSnapshotFile) {
            jobs.push(fsc().readText(overlaysDir + '/' + item.univerSnapshotFile).then(function (raw2) {
              item.univerSnapshot = JSON.parse(raw2);
              delete item.univerSnapshotFile;
            }).catch(function () {}));
          }
          if (item.type === 'slideshow' && item.slides) {
            item.slides.forEach(function (slide) {
              var ssrc = String(slide.src || '');
              if (ssrc && !ssrc.startsWith('data:') && !ssrc.startsWith('http')) {
                jobs.push(readAsDataUri(overlaysDir, ssrc).then(function (uri) { slide.src = uri; }).catch(function () {}));
              }
            });
          }
        });
        return Promise.all(jobs).then(function () { return manifest; });
      });
    });
  }

  function rmrfIfExists(p) {
    return fsc().stat(p).then(function (st) {
      if (st) return fsc().rmrf(p);
      return false;
    }).catch(function () { return false; });
  }
  function removeIfExists(p) {
    return fsc().stat(p).then(function (st) {
      if (st && !st.isDir) return fsc().remove(p);
      return false;
    }).catch(function () { return false; });
  }

  var quickNotesApi = {
    loadQuickNotes: function (data) {
      return waitReady().then(function () {
        return fsc().stat(QN_ROOT + '/quicknotes.json').then(function (st) {
          if (!st || st.isDir) return { success: true, notes: [], path: QN_ROOT };
          return fsc().readText(QN_ROOT + '/quicknotes.json').then(function (raw) {
            var metadata = JSON.parse(raw);
            if (!Array.isArray(metadata)) metadata = [];
            var notes = [];
            var jobs = metadata.map(function (entry) {
              var noteDirName = entry.folder || entry.id;
              var noteDir = QN_ROOT + '/' + noteDirName;
              return fsc().stat(noteDir).then(function (st2) {
                if (!st2 || !st2.isDir) return;
                var note = { id: entry.id, title: entry.title || '', folder: entry.folder || '' };
                return fsc().readText(noteDir + '/content.html').then(function (c) {
                  note.content = c;
                }).catch(function () { note.content = ''; })
                  .then(function () {
                    return fsc().readText(noteDir + '/drawdata.json').then(function (raw3) {
                      try { note.drawData = JSON.parse(raw3); } catch (_) { note.drawData = null; }
                    }).catch(function () { note.drawData = null; });
                  })
                  .then(function () {
                    return loadOverlays(noteDir + '/overlays').then(function (overlays) {
                      note.overlayImages = (overlays && overlays.length > 0) ? overlays : [];
                    });
                  })
                  .then(function () {
                    return fsc().readText(noteDir + '/mode.json').then(function (raw3) {
                      try { note.activeMode = JSON.parse(raw3).activeMode || 'text'; }
                      catch (_) { note.activeMode = 'text'; }
                    }).catch(function () { note.activeMode = 'text'; });
                  })
                  .then(function () {
                    return fsc().readText(noteDir + '/filesystem.json').then(function (raw3) {
                      try { note.fileSystem = JSON.parse(raw3); } catch (_) { note.fileSystem = null; }
                    }).catch(function () { /* 无代码文件系统 */ });
                  })
                  .then(function () {
                    return fsc().readText(noteDir + '/sandbox_history.json').then(function (raw3) {
                      try { note.sandboxHistory = JSON.parse(raw3); } catch (_) { note.sandboxHistory = null; }
                    }).catch(function () { /* 无沙盒历史 */ });
                  })
                  .then(function () { notes.push(note); });
              }).catch(function () { /* 单条加载失败跳过 */ });
            });
            return Promise.all(jobs).then(function () {
              return { success: true, notes: notes, path: QN_ROOT };
            });
          });
        });
      }).catch(function (e) {
        console.error('[tablet-notes] loadQuickNotes 失败:', e);
        return { success: false, error: e.message };
      });
    },

    saveQuickNotes: function (data) {
      return waitReady().then(function () {
        var notes = (data && data.notes) || [];
        var currentIds = {};
        var currentFolders = {};
        notes.forEach(function (n) {
          currentIds[n.id] = true;
          currentFolders[getNodeFolderName(n)] = true;
        });

        // 孤儿文件夹清理（桌面同款：qnote_ 前缀或含 _qnote_ 的目录不属当前笔记即删除）
        return fsc().listDir(QN_ROOT).then(function (items) {
          var orphanJobs = [];
          items.forEach(function (it) {
            if (!it.isDir) return;
            var isQuickNoteFolder = it.name.indexOf('qnote_') === 0 || it.name.indexOf('_qnote_') >= 0;
            if (!isQuickNoteFolder) return;
            if (currentIds[it.name] || currentFolders[it.name]) return;
            orphanJobs.push(fsc().rmrf(QN_ROOT + '/' + it.name));
          });
          return Promise.all(orphanJobs).then(function () {
            // 逐条落盘
            var noteJobs = notes.map(function (note) {
              var folderName = getNodeFolderName(note);
              var noteDir = QN_ROOT + '/' + folderName;
              var cleanup = Promise.resolve();
              // 旧格式目录（目录名 = 笔记 id）迁移清理
              if (note.id !== folderName) {
                cleanup = cleanup.then(function () { return rmrfIfExists(QN_ROOT + '/' + note.id); });
              }
              // 重命名后旧 folder 目录清理
              if (note.folder && note.folder !== folderName) {
                cleanup = cleanup.then(function () { return rmrfIfExists(QN_ROOT + '/' + note.folder); });
              }
              return cleanup.then(function () {
                return fsc().writeText(noteDir + '/content.html', note.content || '');
              }).then(function () {
                if (note.drawData) return fsc().writeText(noteDir + '/drawdata.json', JSON.stringify(note.drawData));
                return removeIfExists(noteDir + '/drawdata.json');
              }).then(function () {
                if (note.overlayImages && note.overlayImages.length > 0) {
                  return saveOverlays(noteDir + '/overlays', note.overlayImages);
                }
                return rmrfIfExists(noteDir + '/overlays');
              }).then(function () {
                if (note.activeMode === 'code') {
                  return fsc().writeText(noteDir + '/mode.json', JSON.stringify({ activeMode: 'code' }));
                }
                return removeIfExists(noteDir + '/mode.json');
              }).then(function () {
                if (note.fileSystem) return fsc().writeText(noteDir + '/filesystem.json', JSON.stringify(note.fileSystem));
                return removeIfExists(noteDir + '/filesystem.json');
              }).then(function () {
                if (note.sandboxHistory) return fsc().writeText(noteDir + '/sandbox_history.json', JSON.stringify(note.sandboxHistory));
                return removeIfExists(noteDir + '/sandbox_history.json');
              }).then(function () {
                return { id: note.id, title: note.title || '', folder: folderName };
              }).catch(function (e) {
                console.error('[tablet-notes] 保存笔记失败:', note.id, e);
                return { id: note.id, title: note.title || '', folder: folderName };
              });
            });
            return Promise.all(noteJobs).then(function (metadata) {
              return fsc().writeText(QN_ROOT + '/quicknotes.json', JSON.stringify(metadata, null, 2));
            }).then(function () { return { success: true, path: QN_ROOT }; });
          });
        });
      }).catch(function (e) {
        console.error('[tablet-notes] saveQuickNotes 失败:', e);
        return { success: false, error: e.message };
      });
    },
  };

  window.api = Object.assign(window.api || {}, diaryApi, quickNotesApi);

  console.log('[tablet] 日记/快速笔记文件层垫片已加载（diaries/ + quicknotes/，桌面同构）');
})();
