/* 晓霖自我支持工作台 · 跨设备云同步（客户端加密 + WorkBuddy 云数据库）
 * - 笔记在本机用「保险箱密码」加密后再上传，云端只存密文，后台也看不到内容。
 * - 手机 / 电脑输入同一个密码，即可读写同一份数据。
 * - 失败（断网 / 非授权域名）自动降级为本地存储，绝不丢数据。
 */
(function () {
  'use strict';

  // publicConfig：仅这四个字段允许出现在前端代码中（来自 WorkBuddy 云后端激活结果）。
  var PUBLIC_CONFIG = {
    endpoint: 'https://xiaolin-self-support.app.workbuddy.host',
    publishableKey: 'wbpk_3bf4cNloHYrK6k10OQcs9N_sQxcCSkaJwVk3is549SIQY0kdwaURaD5',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
  };

  var APP_SALT = 'xiaolin-self-support-vault-salt-v1';
  var KEY_CACHE = 'xiaolinVaultDerivedKey';   // 本机缓存的派生密钥（含 vaultId），方便同设备免重复输密码
  var META_PREFIX = 'xiaolinVaultRec:';       // 每个日期本地最后同步时间戳

  var cloud = null;
  var cryptoKey = null;
  var vaultId = null;
  var ready = false;

  // ---------------- 工具 ----------------
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function parseTs(s) {
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  // ---------------- 加密 ----------------
  function deriveKey(passphrase) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: enc.encode(APP_SALT), iterations: 100000, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }
  function deriveVaultId(passphrase) {
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(passphrase + ':' + APP_SALT)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('').slice(0, 48);
    });
  }
  function encryptText(plain) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, new TextEncoder().encode(plain))
      .then(function (ct) { return { ciphertext: bufToB64(ct), iv: bufToB64(iv) }; });
  }
  function decryptText(ciphertext, iv) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, cryptoKey, b64ToBuf(ciphertext))
      .then(function (pt) { return new TextDecoder().decode(pt); });
  }
  function exportKey() {
    return crypto.subtle.exportKey('raw', cryptoKey).then(bufToB64);
  }
  function importKey(rawB64) {
    return crypto.subtle.importKey('raw', b64ToBuf(rawB64), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // ---------------- 云客户端 ----------------
  function initCloud() {
    if (cloud) return true;
    if (typeof WorkBuddyCloud === 'undefined') return false;
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
    return true;
  }

  // ---------------- 本地读取 / 写入 ----------------
  function storePrefixes() {
    return window.__storePrefixes || { day: 'xiaolinSelfSupportDay:', note: 'xiaolinCalendarStickyNote:' };
  }
  function recordForDate(dateKey, asOf) {
    var p = storePrefixes();
    var raw = localStorage.getItem(p.day + dateKey);
    var workbench;
    try { workbench = raw ? JSON.parse(raw) : {}; } catch (e) { workbench = {}; }
    var sticky = localStorage.getItem(p.note + dateKey) || '';
    return { workbench: workbench, sticky: sticky, updatedAt: asOf || 0 };
  }
  function meaningful(r) {
    var wb = r.workbench || {};
    var hasWb = Object.keys(wb).some(function (k) { return k !== 'savedAt' && String(wb[k] == null ? '' : wb[k]).trim() !== ''; });
    var hasSticky = String(r.sticky || '').trim() !== '';
    return hasWb || hasSticky;
  }
  function writeLocalFromRecord(dateKey, r) {
    var p = storePrefixes();
    if (Object.keys(r.workbench || {}).length) {
      if (!r.workbench.savedAt) r.workbench.savedAt = new Date(r.updatedAt || Date.now()).toISOString();
      localStorage.setItem(p.day + dateKey, JSON.stringify(r.workbench));
    }
    if (String(r.sticky || '').trim()) localStorage.setItem(p.note + dateKey, r.sticky);
    else localStorage.removeItem(p.note + dateKey);
    localStorage.setItem(META_PREFIX + dateKey, String(r.updatedAt || Date.now()));
  }
  function localDates() {
    var p = storePrefixes();
    var set = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k.indexOf(p.day) === 0) set[k.slice(p.day.length)] = true;
      else if (k.indexOf(p.note) === 0) set[k.slice(p.note.length)] = true;
    }
    return Object.keys(set);
  }

  // ---------------- 云端读写 ----------------
  function pushDate(dateKey) {
    if (!ready) return Promise.resolve();
    var rec = recordForDate(dateKey, Date.now());
    localStorage.setItem(META_PREFIX + dateKey, String(rec.updatedAt));
    if (!meaningful(rec)) {
      // 本地无内容 → 删除云端记录，保持两边一致
      return cloud.database.from('vault_notes')
        .delete().eq('vault_id', vaultId).eq('date_key', dateKey)
        .then(function () {}, function () {});
    }
    return encryptText(JSON.stringify(rec)).then(function (enc) {
      return cloud.database.from('vault_notes').upsert({
        vault_id: vaultId, date_key: dateKey, ciphertext: enc.ciphertext, iv: enc.iv, updated_at: new Date(rec.updatedAt).toISOString()
      }, { onConflict: 'vault_id,date_key' }).select();
    }).then(function (res) {
      if (res && res.error) throw res.error;
      setStatus('已同步 ' + dateKey, true);
      return res;
    }).catch(function (err) { handleCloudError(err); });
  }

  function syncAll() {
    if (!ready) return Promise.resolve();
    if (!navigator.onLine) { setStatus('离线 · 仅本地', false); return Promise.resolve(); }
    return cloud.database.from('vault_notes').select('*').eq('vault_id', vaultId).limit(2000)
      .then(function (res) {
        if (res && res.error) throw res.error;
        var rows = (res && res.data) || [];
        var now = Date.now();
        var cloudMap = {};
        rows.forEach(function (r) { cloudMap[r.date_key] = r; });
        var promises = [];
        var changed = false;

        // 云端 → 本地（解密 + last-write-wins）
        rows.forEach(function (row) {
          promises.push(decryptText(row.ciphertext, row.iv).then(function (json) {
            var cloudRec = JSON.parse(json);
            var localMeta = Number(localStorage.getItem(META_PREFIX + row.date_key) || '0');
            if (!localMeta) localMeta = now; // 旧本地数据视为较新，优先保留并回传
            var cloudTs = parseTs(row.updated_at);
            if (cloudTs >= localMeta) {
              writeLocalFromRecord(row.date_key, cloudRec);
              changed = true;
            }
          }).catch(function () { /* 解密失败跳过该行 */ }));
        });

        // 本地 → 云端（补齐云端没有的日期，或本地更新的日期）
        localDates().forEach(function (dateKey) {
          var meta = Number(localStorage.getItem(META_PREFIX + dateKey) || '0');
          if (!meta) meta = now;
          var cloudRow = cloudMap[dateKey];
          var cloudTs = cloudRow ? parseTs(cloudRow.updated_at) : 0;
          if (!cloudRow || meta > cloudTs) {
            var rec = recordForDate(dateKey, meta);
            if (meaningful(rec)) {
              promises.push(encryptText(JSON.stringify(rec)).then(function (enc) {
                return cloud.database.from('vault_notes').upsert({
                  vault_id: vaultId, date_key: dateKey, ciphertext: enc.ciphertext, iv: enc.iv, updated_at: new Date(rec.updatedAt).toISOString()
                }, { onConflict: 'vault_id,date_key' }).select();
              }).then(function (r) { if (r && r.error) throw r.error; }, function (err) { handleCloudError(err); }));
            } else if (cloudRow) {
              promises.push(cloud.database.from('vault_notes').delete().eq('vault_id', vaultId).eq('date_key', dateKey).catch(function () {}));
            }
          }
        });

        return Promise.all(promises).then(function () {
          if (changed && typeof window.__rerenderAll === 'function') window.__rerenderAll();
          setStatus('已同步', true);
        });
      }).catch(function (err) { handleCloudError(err); });
  }

  function handleCloudError(err) {
    var msg = (err && (err.message || err.code)) || '未知错误';
    if (msg.indexOf('401') >= 0 || (err && err.code && String(err.code).indexOf('CREDENTIAL') >= 0)) {
      setStatus('此域名未启用同步 · 仅本地', false);
    } else if (!navigator.onLine) {
      setStatus('离线 · 仅本地', false);
    } else {
      setStatus('同步失败：' + msg + ' · 已用本地', false);
    }
  }

  // ---------------- 解锁 / 启动 ----------------
  function unlock(passphrase) {
    return deriveKey(passphrase).then(function (k) {
      cryptoKey = k;
      return deriveVaultId(passphrase);
    }).then(function (vid) {
      vaultId = vid;
      ready = true;
      return exportKey();
    }).then(function (rawKey) {
      localStorage.setItem(KEY_CACHE, JSON.stringify({ key: rawKey, vaultId: vaultId }));
      setStatus('保险箱已解锁', true);
      return syncAll();
    });
  }

  function start() {
    buildUI();
    if (typeof WorkBuddyCloud === 'undefined') { setStatus('同步组件未加载 · 仅本地', false); return; }
    initCloud();
    var cached = localStorage.getItem(KEY_CACHE);
    if (cached) {
      try {
        var obj = JSON.parse(cached);
        importKey(obj.key).then(function (k) {
          cryptoKey = k; vaultId = obj.vaultId; ready = true;
          setStatus('保险箱已解锁', true);
          syncAll();
        }).catch(function () { showPassphraseModal(); });
        return;
      } catch (e) { /* 落到重新输入 */ }
    }
    showPassphraseModal();
  }

  // ---------------- UI ----------------
  function buildUI() {
    var style = document.createElement('style');
    style.textContent = '#vaultPill{position:fixed;right:14px;bottom:14px;z-index:9999;font:13px/1.4 system-ui,sans-serif;' +
      'background:#2b2a27;color:#f7f2eb;padding:9px 13px;border-radius:20px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2);max-width:70vw;}' +
      '#vaultPill.off{background:#9d705d;}#vaultPill.ok{background:#6f7d66;}' +
      '.vault-modal-mask{position:fixed;inset:0;background:rgba(20,18,16,.55);display:flex;align-items:center;justify-content:center;z-index:10000;}' +
      '.vault-modal{background:#fffdf9;border-radius:18px;padding:22px;width:min(90vw,360px);box-shadow:0 20px 50px rgba(0,0,0,.3);}' +
      '.vault-modal h3{margin:0 0 6px;font-size:18px;color:#23211f;}' +
      '.vault-modal p{margin:0 0 14px;color:#7b756f;font-size:13px;line-height:1.6;}' +
      '.vault-modal input{width:100%;border:1px solid #ded6cc;border-radius:12px;padding:12px;font-size:15px;box-sizing:border-box;margin-bottom:12px;}' +
      '.vault-modal button{width:100%;border:none;background:#6f7d66;color:#fff;padding:12px;border-radius:12px;font-size:15px;cursor:pointer;}' +
      '.vault-modal .tip{margin-top:10px;font-size:12px;color:#9d705d;}';
    document.head.appendChild(style);

    var pill = document.createElement('div');
    pill.id = 'vaultPill';
    pill.className = 'off';
    pill.textContent = '同步：未连接';
    pill.onclick = showPassphraseModal;
    document.body.appendChild(pill);
  }
  function setStatus(text, ok) {
    var pill = document.getElementById('vaultPill');
    if (!pill) return;
    pill.textContent = '同步：' + text;
    pill.className = ok ? 'ok' : 'off';
  }
  function showPassphraseModal() {
    var mask = document.getElementById('vaultModalMask');
    if (mask) return;
    var wrap = document.createElement('div');
    wrap.id = 'vaultModalMask';
    wrap.className = 'vault-modal-mask';
    wrap.innerHTML = '<div class="vault-modal">' +
      '<h3>设置同步保险箱</h3>' +
      '<p>设置一个密码。手机和电脑输入<b>同一个密码</b>，就能看到同一份笔记。' +
      '笔记会先在本地加密再上传，连后台都看不到内容。</p>' +
      '<input id="vaultPwd" type="password" placeholder="输入保险箱密码" autocomplete="off" />' +
      '<button id="vaultPwdBtn">开启同步</button>' +
      '<div class="tip">⚠️ 密码只存在你脑子里，忘记将无法恢复已同步的内容。</div>' +
      '</div>';
    document.body.appendChild(wrap);
    var input = wrap.querySelector('#vaultPwd');
    var btn = wrap.querySelector('#vaultPwdBtn');
    setTimeout(function () { input.focus(); }, 50);
    function go() {
      var v = input.value;
      if (!v || v.length < 4) { input.style.borderColor = '#9d705d'; return; }
      btn.disabled = true; btn.textContent = '正在开启…';
      unlock(v).then(function () {
        wrap.remove();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '开启同步';
        input.style.borderColor = '#9d705d';
      });
    }
    btn.onclick = go;
    input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  // 防抖保存（避免连续输入狂打云端）
  var pushTimers = {};
  function debouncedPush(dateKey) {
    if (!ready) return;
    clearTimeout(pushTimers[dateKey]);
    pushTimers[dateKey] = setTimeout(function () { pushDate(dateKey); }, 800);
  }

  // 暴露给 index.html 的钩子
  window.__vault = {
    start: start,
    pushDate: function (dateKey) { debouncedPush(dateKey); },
    syncAll: syncAll
  };

  window.addEventListener('online', function () { if (ready) syncAll(); });
})();
