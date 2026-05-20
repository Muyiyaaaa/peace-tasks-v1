/**
 * 和平精英 · 趣味任务 - 核心逻辑
 */
(function() {
  'use strict';

  // ─── 常量 ─────────────────────────────────────────────────
  const _cfg = typeof CONFIG !== 'undefined' ? CONFIG : {};
  const GIST_ID  = _cfg.gist?.id || '';
  const GIST_PAT = _cfg.gist?.token || '';
  const GIST_FILE = _cfg.gist?.file || 'peace_task.json';
  const LOCK_MS  = _cfg.game?.lockDuration || 5 * 60 * 1000;
  const POLL_MS  = _cfg.game?.pollInterval || 5000;
  const HAS_GIST = !!GIST_ID;
  const STORAGE_PREFIX = 'pea_';
  const AUTH_REQUIRED = _cfg.auth?.required !== false; // 默认需要认证

  // ─── 状态 ─────────────────────────────────────────────────
  let globalData = {};     // 全局数据
  let timerInterval = null;
  let pubTs = null, secTs = null;
  let activeFilter = 'all';
  let favorites = [];
  let history = [];
  let customTasks = [];
  let isInitialized = false;
  let _saveQueue = Promise.resolve(); // 串行化保存队列

  // ─── 工具函数 ──────────────────────────────────────────────
  function saveLocal(key, data) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  }

  // 从认证模块加载用户数据
  function loadUserData() {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) {
      favorites = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'favs') || '[]');
      history = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'history') || '[]');
      customTasks = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'custom') || '[]');
      return;
    }

    favorites = AuthAPI.getUserData('favorites') || [];
    history = AuthAPI.getUserData('history') || [];
    customTasks = AuthAPI.getUserData('customTasks') || [];
  }

  // 保存用户数据到认证模块
  function saveUserData() {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) {
      saveLocal('favs', favorites);
      saveLocal('history', history);
      saveLocal('custom', customTasks);
      return;
    }

    AuthAPI.setUserData('favorites', favorites);
    AuthAPI.setUserData('history', history);
    AuthAPI.setUserData('customTasks', customTasks);
  }

  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
           (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' +
           (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return Math.floor(diff / 86400000) + '天前';
  }

  function isTaskActive(ts) {
    return ts && (Date.now() - ts) < LOCK_MS;
  }

  // ─── GitHub Gist API ─────────────────────────────────────
  async function fetchWithTimeout(url, options, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchGlobal() {
    if (!HAS_GIST) return null;
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (GIST_PAT) headers['Authorization'] = `Bearer ${GIST_PAT}`;
      const res = await fetchWithTimeout(`https://api.github.com/gists/${GIST_ID}`, { headers });
      if (!res.ok) return null;
      const json = await res.json();
      const file = json.files[GIST_FILE];
      if (!file) return {};
      return JSON.parse(file.content || '{}');
    } catch (e) {
      console.warn('Gist fetch error:', e);
      return null;
    }
  }

  async function saveGlobal() {
    // 等待上一次保存完成，避免并发 fetch-then-PATCH 覆盖
    await _saveQueue.catch(() => {});

    const task = (async () => {
      const data = globalData; // 执行时重新读取最新数据

      // 始终缓存到 localStorage，防止页面刷新后 Gist 不可用时丢失任务状态
      saveLocal('globalData', data);

      if (!HAS_GIST || !GIST_PAT) {
        return;
      }
      try {
        // 合并当前 Gist 数据，避免覆盖 auth 数据（_users, _userData）
        const currentData = await fetchGlobal();
        const merged = { ...(currentData || {}), ...data };
        // 确保 auth 数据不被覆盖
        if (currentData) {
          if (currentData._users && !data._users) merged._users = currentData._users;
          if (currentData._userData && !data._userData) merged._userData = currentData._userData;
        }

        const body = JSON.stringify({
          files: { [GIST_FILE]: { content: JSON.stringify(merged) } }
        });
        await fetchWithTimeout(`https://api.github.com/gists/${GIST_ID}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${GIST_PAT}`,
            'Content-Type': 'application/json'
          },
          body
        });
      } catch (e) {
        console.warn('Gist save error:', e);
      }
    })();

    _saveQueue = task;
    return task;
  }

  // ─── 任务获取 ──────────────────────────────────────────────
  function getFilteredEvents() {
    let pool = [...EVENTS, ...customTasks];
    if (activeFilter !== 'all') {
      pool = pool.filter(e => e.icon === activeFilter);
    }
    return pool;
  }

  function getMyTask(type) {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) return null;
    const email = AuthAPI.getCurrentUser().email;
    const d = globalData[email];
    if (!d || !d[type]) return null;
    if (!isTaskActive(d[type].ts)) return null; // 任务已过期
    return { idx: d[type].idx, ts: d[type].ts };
  }

  // ─── 收藏与历史 ──────────────────────────────────────────
  function toggleFavorite(taskText) {
    const idx = favorites.indexOf(taskText);
    if (idx >= 0) favorites.splice(idx, 1);
    else favorites.push(taskText);
    saveUserData();
  }

  function isFavorite(taskText) {
    return favorites.includes(taskText);
  }

  function addHistory(icon, text, label) {
    history.unshift({ icon, text, label, ts: Date.now() });
    if (history.length > 50) history = history.slice(0, 50);
    saveUserData();
  }

  function addCustomTask(text) {
    const task = { icon: '✨', text, label: '自定义任务' };
    customTasks.push(task);
    saveUserData();
    return task;
  }

  function removeCustomTask(index) {
    customTasks.splice(index, 1);
    saveUserData();
  }

  // ─── 分享功能 ──────────────────────────────────────────────
  function shareTask(text) {
    const shareText = `🎮 和平精英 · 趣味任务\n${text}\n\n——来自和平精英趣味任务生成器`;
    if (navigator.share) {
      navigator.share({ title: '和平精英任务', text: shareText }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText).then(() => {
        showToast('已复制到剪贴板');
      }).catch(() => {
        showToast('复制失败，请手动复制');
      });
    }
  }

  function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  // ─── UI 更新 ────────────────────────────────────────────────
  function updateSyncUI(status, text) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    dot.className = 'sync-dot ' + (status || '');
    txt.textContent = text || '同步中...';
  }

  /** 只更新某一侧任务卡片，避免全局重绘闪烁 */
  function updatePublicCard() {
    const pub = getMyTask('pub');
    if (pub) {
      const ev = EVENTS[pub.idx % EVENTS.length];
      showPublicTask(ev);
      pubTs = pub.ts;
      document.getElementById('publicBtn').textContent = '领取任务';
      document.getElementById('publicBtn').disabled = true;
    } else {
      showPublicEmpty();
      pubTs = null;
      document.getElementById('publicBtn').textContent = '领取任务';
      document.getElementById('publicBtn').disabled = false;
    }
  }

  function updateSecretCard() {
    const sec = getMyTask('sec');
    if (sec) {
      const ev = EVENTS[sec.idx % EVENTS.length];
      showSecretTask(ev, true);
      secTs = sec.ts;
      document.getElementById('secretBtn').textContent = '领取隐藏';
      document.getElementById('secretBtn').disabled = true;
    } else {
      showSecretEmpty();
      secTs = null;
      document.getElementById('secretBtn').textContent = '领取隐藏';
      document.getElementById('secretBtn').disabled = false;
    }
  }

  function updateUI() {
    updatePublicCard();
    updateSecretCard();

    // 计时器
    const pub = getMyTask('pub');
    const sec = getMyTask('sec');
    const hasLock = (pub && pub.ts) || (sec && sec.ts);
    if (hasLock) {
      document.getElementById('timerSection').classList.add('on');
      startTimer();
    } else {
      document.getElementById('timerSection').classList.remove('on');
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    updateStatusBoard();
  }

  function showPublicEmpty() {
    document.getElementById('publicCard').classList.remove('locked');
    document.getElementById('publicEmpty').style.display = 'block';
    document.getElementById('publicContent').style.display = 'none';
  }

  function showPublicTask(ev) {
    document.getElementById('publicEmpty').style.display = 'none';
    document.getElementById('publicContent').style.display = 'block';
    document.getElementById('publicText').textContent = ev.text;
    document.getElementById('publicBadge').textContent = ev.icon + ' ' + ev.label;

    const favBtn = document.getElementById('publicFavBtn');
    if (favBtn) {
      favBtn.textContent = isFavorite(ev.text) ? '★ 已收藏' : '☆ 收藏';
      favBtn.className = 'action-chip' + (isFavorite(ev.text) ? ' fav-on' : '');
      favBtn.onclick = () => {
        toggleFavorite(ev.text);
        favBtn.textContent = isFavorite(ev.text) ? '★ 已收藏' : '☆ 收藏';
        favBtn.className = 'action-chip' + (isFavorite(ev.text) ? ' fav-on' : '');
      };
    }

    const shareBtn = document.getElementById('publicShareBtn');
    if (shareBtn) shareBtn.onclick = () => shareTask(ev.icon + ' ' + ev.text);
  }

  function showSecretEmpty() {
    document.getElementById('secretEmpty').style.display = 'block';
    document.getElementById('secretContent').style.display = 'none';
    document.getElementById('secretMask').style.display = 'none';
  }

  function showSecretTask(ev, masked = true) {
    document.getElementById('secretEmpty').style.display = 'none';
    document.getElementById('secretContent').style.display = 'block';
    document.getElementById('secretText').textContent = masked ? '？？？' : ev.text;
    document.getElementById('secretBadge').textContent = masked ? '点击查看' : ev.icon + ' ' + ev.label;
    document.getElementById('secretMask').style.display = masked ? 'flex' : 'none';

    const favBtn = document.getElementById('secretFavBtn');
    if (favBtn && !masked) {
      favBtn.textContent = isFavorite(ev.text) ? '★ 已收藏' : '☆ 收藏';
      favBtn.className = 'action-chip' + (isFavorite(ev.text) ? ' fav-on' : '');
      favBtn.onclick = () => {
        toggleFavorite(ev.text);
        favBtn.textContent = isFavorite(ev.text) ? '★ 已收藏' : '☆ 收藏';
        favBtn.className = 'action-chip' + (isFavorite(ev.text) ? ' fav-on' : '');
      };
    }

    const shareBtn = document.getElementById('secretShareBtn');
    if (shareBtn && !masked) shareBtn.onclick = () => shareTask(ev.icon + ' ' + ev.text);
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    function tick() {
      const pub = getMyTask('pub');
      const sec = getMyTask('sec');

      // 所有任务已过期，刷新UI并停止计时
      if (!pub && !sec) {
        updateUI();
        return;
      }

      // 单个任务过期时更新对应卡片（使按钮恢复可用）
      if (!pub) updatePublicCard();
      if (!sec) updateSecretCard();

      if (pub) {
        const rem = Math.max(0, LOCK_MS - (Date.now() - pub.ts));
        document.getElementById('timerFill').style.width = (rem / LOCK_MS * 100) + '%';
      } else {
        document.getElementById('timerFill').style.width = '0%';
      }

      if (sec) {
        const rem = Math.max(0, LOCK_MS - (Date.now() - sec.ts));
        document.getElementById('timerFill2').style.width = (rem / LOCK_MS * 100) + '%';
      } else {
        document.getElementById('timerFill2').style.width = '0%';
      }

      let minRem = Infinity;
      if (pub) minRem = Math.min(minRem, LOCK_MS - (Date.now() - pub.ts));
      if (sec) minRem = Math.min(minRem, LOCK_MS - (Date.now() - sec.ts));
      document.getElementById('timerText').textContent = fmt(Math.max(0, minRem));
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  // ─── 全员状态面板 ──────────────────────────────────────────
  function updateStatusBoard() {
    const board = document.getElementById('statusBoard');
    if (!board) return;
    board.innerHTML = '';

    const currentUser = AuthAPI && AuthAPI.getCurrentUser();
    const currentEmail = currentUser ? currentUser.email : null;

    Object.keys(globalData).forEach(email => {
      // 跳过内部数据键（_users, _userData）和当前用户自己
      if (email.startsWith('_') || email === currentEmail) return;
      const d = globalData[email];
      const card = document.createElement('div');
      card.className = 'status-card';

      // 头像
      const avatar = document.createElement('div');
      avatar.className = 'status-avatar';
      avatar.textContent = (d && d.username) ? d.username.charAt(0) : '?';
      card.appendChild(avatar);

      // 内容区
      const body = document.createElement('div');
      body.className = 'status-body';

      // 头部：名字
      const head = document.createElement('div');
      head.className = 'status-head';
      const name = document.createElement('span');
      name.className = 'status-name';
      name.textContent = (d && d.username) || email;
      head.appendChild(name);
      body.appendChild(head);

      // 任务列表
      const list = document.createElement('div');
      list.className = 'status-task-list';

      const hasPub = d && d.pub && isTaskActive(d.pub.ts);
      const hasSec = d && d.sec && isTaskActive(d.sec.ts);

      if (hasPub) {
        const row = document.createElement('div');
        row.className = 'status-row';
        const ev = EVENTS[d.pub.idx % EVENTS.length];
        row.innerHTML = `<span class="t-type pub">公开</span><span class="t-text">${ev ? ev.text : '(已领取)'}</span><span class="t-time">${fmtTime(d.pub.ts)}</span>`;
        list.appendChild(row);
      }

      if (hasSec) {
        const row = document.createElement('div');
        row.className = 'status-row';
        row.innerHTML = `<span class="t-type sec">隐藏</span><span class="t-text">🔒 已领取</span><span class="t-time">${fmtTime(d.sec.ts)}</span>`;
        list.appendChild(row);
      }

      if (!hasPub && !hasSec) {
        const empty = document.createElement('div');
        empty.className = 'status-empty';
        empty.textContent = '尚未领取任务';
        list.appendChild(empty);
      }

      body.appendChild(list);
      card.appendChild(body);
      board.appendChild(card);
    });
  }

  // ─── 筛选器渲染 ──────────────────────────────────────────
  function renderFilters() {
    const container = document.getElementById('filterTags');
    if (!container) return;
    container.innerHTML = '';

    const allTag = document.createElement('div');
    allTag.className = 'pill' + (activeFilter === 'all' ? ' active' : '');
    allTag.textContent = '全部';
    allTag.onclick = () => { activeFilter = 'all'; renderFilters(); };
    container.appendChild(allTag);

    Object.entries(CATEGORY_MAP).forEach(([icon, name]) => {
      const tag = document.createElement('div');
      tag.className = 'pill' + (activeFilter === icon ? ' active' : '');
      tag.textContent = icon + ' ' + name;
      tag.onclick = () => { activeFilter = icon; renderFilters(); };
      container.appendChild(tag);
    });
  }

  // ─── 历史记录渲染 ──────────────────────────────────────────
  function renderHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无历史记录</p></div>';
      return;
    }

    history.slice(0, 20).forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `<span class="h-icon">${item.icon}</span><span class="h-text" title="${item.text}">${item.text}</span><span class="h-time">${timeAgo(item.ts)}</span>`;
      container.appendChild(el);
    });
  }

  // ─── 自定义任务渲染 ──────────────────────────────────────────
  function renderCustomTasks() {
    const container = document.getElementById('customList');
    if (!container) return;
    container.innerHTML = '';

    if (customTasks.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-muted)">暂无自定义任务</div>';
      return;
    }

    customTasks.forEach((task, idx) => {
      const el = document.createElement('div');
      el.className = 'custom-item';
      el.innerHTML = `<span class="c-ico">${task.icon}</span><span class="c-text" title="${task.text}">${task.text}</span><span class="c-del" data-idx="${idx}">删除</span>`;
      el.querySelector('.c-del').onclick = () => {
        removeCustomTask(idx);
        renderCustomTasks();
      };
      container.appendChild(el);
    });
  }

  // ─── 交互 ─────────────────────────────────────────────────

  window.claimPublic = async function() {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) return;

    const user = AuthAPI.getCurrentUser();
    const email = user.email;

    const pool = getFilteredEvents();
    const idx = Math.floor(Math.random() * pool.length);
    const realIdx = EVENTS.indexOf(pool[idx]);
    const ts = Date.now();

    if (!globalData[email]) globalData[email] = {};
    globalData[email].pub = { idx: realIdx >= 0 ? realIdx : idx, ts };
    globalData[email].username = user.username;

    const ev = pool[idx];
    addHistory(ev.icon, ev.text, ev.label);

    pubTs = ts;
    updatePublicCard();
    updateStatusBoard();
    document.getElementById('timerSection').classList.add('on');
    startTimer();

    await saveGlobal();
  };

  window.claimSecret = async function() {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) return;

    const user = AuthAPI.getCurrentUser();
    const email = user.email;

    const pool = getFilteredEvents();
    const idx = Math.floor(Math.random() * pool.length);
    const realIdx = EVENTS.indexOf(pool[idx]);
    const ts = Date.now();

    if (!globalData[email]) globalData[email] = {};
    globalData[email].sec = { idx: realIdx >= 0 ? realIdx : idx, ts };
    globalData[email].username = user.username;

    const ev = pool[idx];
    addHistory(ev.icon, ev.text, ev.label);

    secTs = ts;
    updateSecretCard();
    updateStatusBoard();
    document.getElementById('timerSection').classList.add('on');
    startTimer();

    await saveGlobal();
  };

  window.revealSecret = function() {
    const sec = getMyTask('sec');
    if (!sec) return;
    const ev = EVENTS[sec.idx % EVENTS.length];
    showSecretTask(ev, false);
  };

  window.toggleHistory = function() {
    const body = document.getElementById('historyBody');
    const btn = document.getElementById('historyToggle');
    if (body.style.display === 'none') {
      body.style.display = 'block';
      btn.textContent = '📋 收起历史';
      btn.classList.add('on');
      renderHistory();
    } else {
      body.style.display = 'none';
      btn.textContent = '📋 查看历史';
      btn.classList.remove('on');
    }
  };

  window.addCustomTask = function() {
    const input = document.getElementById('customInput');
    const text = input.value.trim();
    if (!text) return;
    addCustomTask(text);
    input.value = '';
    renderCustomTasks();
    showToast('自定义任务已添加');
  };

  // ─── 数据加载保障 ──────────────────────────────────────────
  /** 检查 globalData 是否已加载，未加载时从数据源重新读取 */
  async function ensureGlobalData() {
    // 如果已登录，先保存当前用户的本地任务状态（防止被远端旧数据覆盖）
    let myLocalData = null;
    if (AuthAPI && AuthAPI.isLoggedIn()) {
      const email = AuthAPI.getCurrentUser().email;
      if (globalData[email]) {
        myLocalData = globalData[email];
      }
    }

    if (Object.keys(globalData).length === 0 || !AuthAPI || !AuthAPI.isLoggedIn()) {
      // globalData 为空，或未登录状态，从数据源加载
      if (HAS_GIST) {
        const data = await fetchGlobal();
        if (data) {
          globalData = data;
          saveLocal('globalData', data);
          updateSyncUI('ok', '已同步');
        }
      } else {
        globalData = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'globalData') || '{}');
      }
    } else {
      // globalData 已有数据且已登录，从 Gist 刷新以确保最新
      if (HAS_GIST) {
        const data = await fetchGlobal();
        if (data) {
          // 合并远端数据，但优先保留当前用户的本地任务状态
          const email = AuthAPI.getCurrentUser().email;
          const myData = myLocalData || globalData[email];
          globalData = data;
          if (myData) {
            globalData[email] = myData;
          }
          saveLocal('globalData', globalData);
          updateSyncUI('ok', '已同步');
        }
      }
    }

    // 恢复当前用户的本地任务状态（如果之前保存了）
    if (myLocalData && AuthAPI && AuthAPI.isLoggedIn()) {
      const email = AuthAPI.getCurrentUser().email;
      // 如果远端数据过期（本地更新），使用本地数据
      if (globalData[email] && myLocalData.pub && myLocalData.pub.ts > (globalData[email].pub?.ts || 0)) {
        globalData[email].pub = myLocalData.pub;
      }
      if (globalData[email] && myLocalData.sec && myLocalData.sec.ts > (globalData[email].sec?.ts || 0)) {
        globalData[email].sec = myLocalData.sec;
      }
    }
  }

  // ─── 初始化 ─────────────────────────────────────────────────
  async function init() {
    try {
    updateSyncUI('syncing', HAS_GIST ? '同步中...' : '本地模式');

    // 等待认证初始化完成，但加 8 秒超时保护，防止 GitHub API 卡住
    if (typeof AuthAPI !== 'undefined' && AuthAPI.ready) {
      const timeout = new Promise(r => setTimeout(() => r('timeout'), 8000));
      const result = await Promise.race([AuthAPI.ready, timeout]);
      if (result === 'timeout') {
        console.warn('Auth init timeout, proceeding anyway');
      }
    }

    // 立即判断登录状态，弹窗和同步不再互相阻塞
    const loggedIn = typeof AuthAPI !== 'undefined' && AuthAPI.isLoggedIn();
    if (AUTH_REQUIRED && !loggedIn) {
      showAuthModal();
    } else if (loggedIn) {
      updateAuthUI();
      loadUserData();
    }

    // 标记初始化完成，避免 handleLogin 重复执行完整 init
    isInitialized = true;

    // 加载 Gist 数据（弹窗已先行显示，用户可立即交互）
    if (HAS_GIST) {
      const data = await fetchGlobal();
      if (data === null) {
        updateSyncUI('error', '同步失败，离线模式');
        globalData = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'globalData') || '{}');
      } else {
        globalData = data;
        // Gist 同步成功后更新本地缓存，确保下次页面加载有回退数据
        saveLocal('globalData', data);
        updateSyncUI('ok', '已同步');
      }
    } else {
      globalData = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'globalData') || '{}');
      updateSyncUI('', '本地模式');
    }

    renderFilters();
    renderCustomTasks();
    updateUI();

    // 启动轮询（带防重入保护）
    if (HAS_GIST && !window._peaPollingStarted) {
      window._peaPollingStarted = true;
      setInterval(async () => {
        const data = await fetchGlobal();
        if (data !== null) {
          // 合并远端数据：保留当前用户的本地状态（本地始终为最新）
          if (AuthAPI && AuthAPI.isLoggedIn()) {
            const email = AuthAPI.getCurrentUser().email;
            const myLocalData = globalData[email];
            globalData = data;
            if (myLocalData) {
              globalData[email] = myLocalData;
            }
          } else {
            globalData = data;
          }
          updateSyncUI('ok', '已同步');
          updateUI();
        } else {
          updateSyncUI('error', '同步失败');
        }
      }, POLL_MS);
    }
    } catch (e) {
      console.error('Init error:', e);
      updateSyncUI('error', '初始化异常');
      // 异常情况下仍然尝试显示登录弹窗
      if (AUTH_REQUIRED) showAuthModal();
      isInitialized = true;
    }
  }

  // 显示认证弹窗
  function showAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.add('show');
    }
  }

  // 隐藏认证弹窗
  function hideAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
      modal.classList.remove('show');
    }
  }

  // 更新认证UI
  function updateAuthUI() {
    if (!AuthAPI || !AuthAPI.isLoggedIn()) return;

    const user = AuthAPI.getCurrentUser();
    const authBar = document.getElementById('authBar');
    const authUsername = document.getElementById('authUsername');

    if (authBar && authUsername && user) {
      authBar.style.display = 'flex';
      authUsername.textContent = user.username;
    }
  }

  // 切换认证标签
  window.switchAuthTab = function(tab) {
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (tab === 'login') {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
    } else {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      registerForm.style.display = 'block';
      loginForm.style.display = 'none';
    }
  };

  // 处理登录
  window.handleLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const hint = document.getElementById('loginHint');

    if (!email || !password) {
      hint.textContent = '请填写邮箱和密码';
      return;
    }

    const result = AuthAPI.login(email, password);

    if (result.success) {
      hint.textContent = '';
      hideAuthModal();
      updateAuthUI();
      loadUserData();

      // 清空表单字段
      document.getElementById('loginEmail').value = '';
      document.getElementById('loginPassword').value = '';

      // 确保 globalData 已加载（修复重新登录数据丢失问题）
      await ensureGlobalData();
      updateUI();

      showToast('欢迎回来，' + result.user.username + '！');
    } else {
      hint.textContent = result.message;
    }
  };

  // 处理注册
  window.handleRegister = async function() {
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    const username = document.getElementById('regUsername').value.trim();
    const hint = document.getElementById('regHint');

    if (!email || !password || !confirmPassword || !username) {
      hint.textContent = '请填写所有字段';
      return;
    }

    if (password !== confirmPassword) {
      hint.textContent = '两次密码输入不一致';
      return;
    }

    const result = AuthAPI.register(email, password, username);

    if (result.success) {
      hint.textContent = '';
      // 注册成功后自动登录
      const loginResult = AuthAPI.login(email, password);
      if (loginResult.success) {
        hideAuthModal();
        updateAuthUI();
        loadUserData();

        // 清空表单字段
        document.getElementById('regEmail').value = '';
        document.getElementById('regPassword').value = '';
        document.getElementById('regConfirmPassword').value = '';
        document.getElementById('regUsername').value = '';

        // 确保 globalData 已加载（修复重新登录数据丢失问题）
        await ensureGlobalData();
        updateUI();

        showToast('注册成功，欢迎 ' + username + '！');
      }
    } else {
      hint.textContent = result.message;
    }
  };

  // 处理登出
  window.handleLogout = function() {
    if (!AuthAPI) return;

    if (confirm('确定要退出登录吗？')) {
      // 清理本地状态
      favorites = [];
      history = [];
      customTasks = [];
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      AuthAPI.logout();
      location.reload(); // 刷新页面重新初始化
    }
  };

  // 密码显示/隐藏切换
  window.togglePwd = function(id, el) {
    const input = document.getElementById(id);
    if (input.type === 'password') {
      input.type = 'text';
      el.textContent = '🙈';
    } else {
      input.type = 'password';
      el.textContent = '👁️';
    }
  };

  // 回车键处理
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const authModal = document.getElementById('authModal');

      if (authModal && authModal.classList.contains('show')) {
        e.preventDefault();
        const loginForm = document.getElementById('loginForm');
        if (loginForm.style.display !== 'none') {
          window.handleLogin();
        } else {
          window.handleRegister();
        }
      }
    }
  });

  init();
})();
