/**
 * 和平精英 · 双线任务 - 核心逻辑
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
  const MAX_PLAYERS = _cfg.game?.maxPlayers || 4;
  const HAS_GIST = !!GIST_ID;
  const STORAGE_PREFIX = 'pea_';

  // ─── 状态 ─────────────────────────────────────────────────
  let sel = null;          // 当前选中的编号
  let myNum = null;        // 我的编号（用于标识是我领取的）
  let globalData = {};     // 全局数据
  let timerInterval = null;
  let pubTs = null, secTs = null;
  let activeFilter = 'all';
  let favorites = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'favs') || '[]');
  let history = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'history') || '[]');
  let customTasks = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'custom') || '[]');

  // ─── 工具函数 ──────────────────────────────────────────────
  function saveLocal(key, data) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
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

  // ─── GitHub Gist API ─────────────────────────────────────
  async function fetchGlobal() {
    if (!HAS_GIST) return null;
    try {
      const headers = { 'Accept': 'application/vnd.github.v3+json' };
      if (GIST_PAT) headers['Authorization'] = `Bearer ${GIST_PAT}`;
      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers });
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

  async function saveGlobal(data) {
    if (!HAS_GIST || !GIST_PAT) {
      saveLocal('globalData', data);
      return;
    }
    try {
      const body = JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify(data) } }
      });
      await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${GIST_PAT}`,
          'Content-Type': 'application/json'
        },
        body
      });
    } catch (e) {
      console.warn('Gist save error:', e);
      saveLocal('globalData', data);
    }
  }

  // ─── 编号占用判断 ──────────────────────────────────────────
  /** 编号已被任何人占用（领了任务就算占用，不管冷却期） */
  function isNumTaken(n) {
    const d = globalData[n];
    if (!d) return false;
    return !!(d.pub || d.sec);
  }

  /** 编号正在冷却期内（用于UI高亮） */
  function isNumInCooldown(n) {
    const d = globalData[n];
    if (!d) return false;
    const now = Date.now();
    const pubOk = d.pub && (now - d.pub.ts < LOCK_MS);
    const secOk = d.sec && (now - d.sec.ts < LOCK_MS);
    return pubOk || secOk;
  }

  function isMyNum(n) {
    return myNum === n;
  }

  // ─── 任务获取 ──────────────────────────────────────────────
  function getFilteredEvents() {
    let pool = [...EVENTS, ...customTasks];
    if (activeFilter !== 'all') {
      pool = pool.filter(e => e.icon === activeFilter);
    }
    return pool;
  }

  function getTask(n, type) {
    const d = globalData[n];
    if (!d || !d[type]) return null;
    return { idx: d[type].idx, ts: d[type].ts };
  }

  // ─── 收藏与历史 ──────────────────────────────────────────
  function toggleFavorite(taskText) {
    const idx = favorites.indexOf(taskText);
    if (idx >= 0) favorites.splice(idx, 1);
    else favorites.push(taskText);
    saveLocal('favs', favorites);
  }

  function isFavorite(taskText) {
    return favorites.includes(taskText);
  }

  function addHistory(icon, text, label) {
    history.unshift({ icon, text, label, ts: Date.now() });
    if (history.length > 50) history = history.slice(0, 50);
    saveLocal('history', history);
  }

  function addCustomTask(text) {
    const task = { icon: '✨', text, label: '自定义任务' };
    customTasks.push(task);
    saveLocal('custom', customTasks);
    return task;
  }

  function removeCustomTask(index) {
    customTasks.splice(index, 1);
    saveLocal('custom', customTasks);
  }

  // ─── 分享功能 ──────────────────────────────────────────────
  function shareTask(text) {
    const shareText = `🎮 和平精英 · 双线任务\n${text}\n\n——来自和平精英任务生成器`;
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
  function refreshNums() {
    for (let i = 1; i <= MAX_PLAYERS; i++) {
      const el = document.getElementById('nb' + i);
      if (!el) continue;
      el.className = 'num-btn';
      // 清除旧的锁标识
      const oldOverlay = el.querySelector('.lock-overlay');
      if (oldOverlay) oldOverlay.remove();

      if (i === sel) {
        el.classList.add('active');
      } else if (isMyNum(i)) {
        el.classList.add('mine');
      } else if (isNumTaken(i)) {
        // 被其他人占用 → 锁定，不可选
        el.classList.add('locked');
        const overlay = document.createElement('div');
        overlay.className = 'lock-overlay';
        overlay.textContent = '🔒';
        el.appendChild(overlay);
      }
    }
  }

  function updateSyncUI(status, text) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    dot.className = 'sync-dot ' + (status || '');
    txt.textContent = text || '同步中...';
  }

  /** 只更新某一侧任务卡片，避免全局重绘闪烁 */
  function updatePublicCard() {
    const pub = getTask(sel, 'pub');
    if (pub) {
      const ev = EVENTS[pub.idx % EVENTS.length];
      showPublicTask(ev);
      pubTs = pub.ts;
      document.getElementById('publicBtn').textContent = '换一个';
      document.getElementById('publicBtn').disabled = false;
    } else {
      showPublicEmpty();
      pubTs = null;
      document.getElementById('publicBtn').textContent = '领取任务';
      document.getElementById('publicBtn').disabled = false;
    }
  }

  function updateSecretCard() {
    const sec = getTask(sel, 'sec');
    if (sec) {
      const ev = EVENTS[sec.idx % EVENTS.length];
      showSecretTask(ev, true);
      secTs = sec.ts;
      document.getElementById('secretBtn').textContent = '换一个';
      document.getElementById('secretBtn').disabled = false;
    } else {
      showSecretEmpty();
      secTs = null;
      document.getElementById('secretBtn').textContent = '领取隐藏';
      document.getElementById('secretBtn').disabled = false;
    }
  }

  function updateUI() {
    if (sel === null) {
      document.getElementById('publicBtn').disabled = true;
      document.getElementById('publicBtn').textContent = '选编号';
      document.getElementById('secretBtn').disabled = true;
      document.getElementById('secretBtn').textContent = '选编号';
      showPublicEmpty();
      showSecretEmpty();
      document.getElementById('timerSection').classList.remove('active');
      updateStatusBoard();
      return;
    }

    updatePublicCard();
    updateSecretCard();

    // 计时器
    const pub = getTask(sel, 'pub');
    const sec = getTask(sel, 'sec');
    const hasLock = (pub && pub.ts) || (sec && sec.ts);
    if (hasLock) {
      document.getElementById('timerSection').classList.add('active');
      startTimer();
    } else {
      document.getElementById('timerSection').classList.remove('active');
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
      favBtn.textContent = isFavorite(ev.text) ? '★' : '☆';
      favBtn.className = 'action-btn' + (isFavorite(ev.text) ? ' fav-active' : '');
      favBtn.onclick = () => {
        toggleFavorite(ev.text);
        favBtn.textContent = isFavorite(ev.text) ? '★' : '☆';
        favBtn.className = 'action-btn' + (isFavorite(ev.text) ? ' fav-active' : '');
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
      favBtn.textContent = isFavorite(ev.text) ? '★' : '☆';
      favBtn.className = 'action-btn' + (isFavorite(ev.text) ? ' fav-active' : '');
      favBtn.onclick = () => {
        toggleFavorite(ev.text);
        favBtn.textContent = isFavorite(ev.text) ? '★' : '☆';
        favBtn.className = 'action-btn' + (isFavorite(ev.text) ? ' fav-active' : '');
      };
    }

    const shareBtn = document.getElementById('secretShareBtn');
    if (shareBtn && !masked) shareBtn.onclick = () => shareTask(ev.icon + ' ' + ev.text);
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    function tick() {
      const pub = getTask(sel, 'pub');
      const sec = getTask(sel, 'sec');

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

      refreshNums();
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  // ─── 全员状态面板 ──────────────────────────────────────────
  function updateStatusBoard() {
    const board = document.getElementById('statusBoard');
    if (!board) return;
    board.innerHTML = '';

    for (let i = 1; i <= MAX_PLAYERS; i++) {
      const d = globalData[i];
      const item = document.createElement('div');
      item.className = 'status-item' + (i === sel ? ' my-status' : '');

      // 编号
      const numEl = document.createElement('span');
      numEl.className = 'status-num';
      numEl.textContent = i + '号';
      item.appendChild(numEl);

      // 明牌任务
      const pubEl = document.createElement('span');
      pubEl.className = 'status-task pub-task';
      if (d && d.pub) {
        const ev = EVENTS[d.pub.idx % EVENTS.length];
        const isMine = isMyNum(i);
        pubEl.textContent = ev ? ev.text : '(已领取)';
        pubEl.title = '领取时间: ' + fmtTime(d.pub.ts);
        // 添加时间戳
        const tsEl = document.createElement('span');
        tsEl.className = 'status-ts';
        tsEl.textContent = fmtTime(d.pub.ts);
        pubEl.appendChild(tsEl);
      } else {
        pubEl.textContent = '—';
        pubEl.style.opacity = '0.3';
      }
      item.appendChild(pubEl);

      // 隐藏任务（只显示状态，不显示内容）
      const secEl = document.createElement('span');
      secEl.className = 'status-task sec-task';
      if (d && d.sec) {
        const isMine = isMyNum(i);
        if (isMine) {
          const ev = EVENTS[d.sec.idx % EVENTS.length];
          secEl.textContent = ev ? '🔒 ' + ev.text : '🔒 已领取';
          secEl.title = '领取时间: ' + fmtTime(d.sec.ts);
        } else {
          secEl.textContent = '🔒 隐藏';
        }
        // 添加时间戳
        const tsEl = document.createElement('span');
        tsEl.className = 'status-ts';
        tsEl.textContent = fmtTime(d.sec.ts);
        secEl.appendChild(tsEl);
      } else {
        secEl.textContent = '—';
        secEl.style.opacity = '0.3';
      }
      item.appendChild(secEl);

      board.appendChild(item);
    }
  }

  // ─── 筛选器渲染 ──────────────────────────────────────────
  function renderFilters() {
    const container = document.getElementById('filterTags');
    if (!container) return;
    container.innerHTML = '';

    const allTag = document.createElement('div');
    allTag.className = 'filter-tag' + (activeFilter === 'all' ? ' active' : '');
    allTag.textContent = '全部';
    allTag.onclick = () => { activeFilter = 'all'; renderFilters(); };
    container.appendChild(allTag);

    Object.entries(CATEGORY_MAP).forEach(([icon, name]) => {
      const tag = document.createElement('div');
      tag.className = 'filter-tag' + (activeFilter === icon ? ' active' : '');
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
      container.innerHTML = '<div style="text-align:center;padding:10px;font-size:12px;color:rgba(255,255,255,.3)">暂无自定义任务</div>';
      return;
    }

    customTasks.forEach((task, idx) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `<span class="h-icon">${task.icon}</span><span class="h-text" title="${task.text}">${task.text}</span><span class="h-time" style="cursor:pointer;color:#f44336" data-idx="${idx}">删除</span>`;
      el.querySelector('[data-idx]').onclick = () => {
        removeCustomTask(idx);
        renderCustomTasks();
      };
      container.appendChild(el);
    });
  }

  // ─── 交互 ─────────────────────────────────────────────────
  window.selectNum = function(n) {
    if (sel === n) return;
    // 被其他人占用的编号不可选
    if (isNumTaken(n) && !isMyNum(n)) {
      const el = document.getElementById('nb' + n);
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 300);
      showToast(n + '号已被占用');
      return;
    }
    sel = n;
    refreshNums();
    updateUI();
  };

  window.claimPublic = async function() {
    if (sel === null) return;

    const pool = getFilteredEvents();
    const idx = Math.floor(Math.random() * pool.length);
    const realIdx = EVENTS.indexOf(pool[idx]);
    const ts = Date.now();

    if (!globalData[sel]) globalData[sel] = {};
    globalData[sel].pub = { idx: realIdx >= 0 ? realIdx : idx, ts };
    globalData[sel].num = sel;

    // 先立即更新本地 UI，再异步保存（避免等待网络导致的闪烁）
    myNum = sel;
    localStorage.setItem(STORAGE_PREFIX + 'my_num', sel);

    const ev = pool[idx];
    addHistory(ev.icon, ev.text, ev.label);

    pubTs = ts;
    refreshNums();
    updatePublicCard();   // 只更新明牌卡片
    updateStatusBoard();  // 更新状态面板
    // 确保计时器也更新
    document.getElementById('timerSection').classList.add('active');
    startTimer();

    // 异步保存到 Gist
    saveGlobal(globalData);
  };

  window.claimSecret = async function() {
    if (sel === null) return;

    const pool = getFilteredEvents();
    const idx = Math.floor(Math.random() * pool.length);
    const realIdx = EVENTS.indexOf(pool[idx]);
    const ts = Date.now();

    if (!globalData[sel]) globalData[sel] = {};
    globalData[sel].sec = { idx: realIdx >= 0 ? realIdx : idx, ts };
    globalData[sel].num = sel;

    myNum = sel;
    localStorage.setItem(STORAGE_PREFIX + 'my_num', sel);

    const ev = pool[idx];
    addHistory(ev.icon, ev.text, ev.label);

    secTs = ts;
    refreshNums();
    updateSecretCard();   // 只更新隐藏卡片（不影响明牌）
    updateStatusBoard();
    document.getElementById('timerSection').classList.add('active');
    startTimer();

    saveGlobal(globalData);
  };

  window.revealSecret = function() {
    if (sel === null) return;
    const sec = getTask(sel, 'sec');
    if (!sec) return;
    const ev = EVENTS[sec.idx % EVENTS.length];
    showSecretTask(ev, false);
  };

  window.toggleHistory = function() {
    const panel = document.getElementById('historyPanel');
    const btn = document.getElementById('historyToggle');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      btn.textContent = '📋 收起历史';
      renderHistory();
    } else {
      panel.style.display = 'none';
      btn.textContent = '📋 查看历史';
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

  // ─── 初始化 ─────────────────────────────────────────────────
  async function init() {
    updateSyncUI('syncing', HAS_GIST ? '同步中...' : '本地模式');

    const savedMyNum = localStorage.getItem(STORAGE_PREFIX + 'my_num');
    if (savedMyNum) myNum = parseInt(savedMyNum);

    if (HAS_GIST) {
      const data = await fetchGlobal();
      if (data === null) {
        updateSyncUI('error', '同步失败，离线模式');
        globalData = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'globalData') || '{}');
      } else {
        globalData = data;
        updateSyncUI('ok', '已同步');
      }
    } else {
      globalData = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'globalData') || '{}');
      updateSyncUI('', '本地模式');
    }

    if (myNum) sel = myNum;

    renderFilters();
    renderCustomTasks();

    refreshNums();
    updateUI();

    if (HAS_GIST) {
      setInterval(async () => {
        const data = await fetchGlobal();
        if (data !== null) {
          globalData = data;
          updateSyncUI('ok', '已同步');
          refreshNums();
          updateUI();
        } else {
          updateSyncUI('error', '同步失败');
        }
      }, POLL_MS);
    }
  }

  init();
})();
