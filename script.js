import * as cloud from './cloud.js';

(() => {
  'use strict';

  const ENTRIES_KEY = 'trading-journal:entries'; // old browser-only entries (one-time upload)
  const THEME_KEY = 'trading-journal:theme';
  const SETTINGS_KEY = 'trading-journal:settings';

  const local = {
    loadPrefs() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
      catch { return {}; }
    },
    savePrefs(p) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
    },
    loadLegacyEntries() {
      try {
        const list = JSON.parse(localStorage.getItem(ENTRIES_KEY));
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    }
  };

  /* ---------- State ---------- */
  let entries = [];
  let filter = 'all';
  let editingId = null;
  let pending = { url: null, blob: null };
  let currentUser = null;
  let stopWatching = null;

  const savedPrefs = local.loadPrefs();
  const legacyStartUSD = Number(savedPrefs.startUSD) || 0;
  let settings = {
    startUSD: 0,
    display: savedPrefs.display === 'USC' ? 'USC' : 'USD',
    period: ['week', 'month', 'lastmonth', '6m', '1y'].includes(savedPrefs.period) ? savedPrefs.period : 'month'
  };

  // display + period stay on this device; the starting balance lives in the database
  function persistPrefs() {
    local.savePrefs({ display: settings.display, period: settings.period, startUSD: legacyStartUSD });
  }

  let startTimer = null;
  function persistStart() {
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (currentUser) cloud.saveStartUSD(currentUser.uid, settings.startUSD).catch(() => {});
    }, 600);
  }

  /* ---------- Elements ---------- */
  const $ = (sel) => document.querySelector(sel);
  const feed = $('#feed');
  const emptyBox = $('#empty');
  const emptyTitle = $('#emptyTitle');
  const emptyText = $('#emptyText');
  const dialog = $('#entryDialog');
  const form = $('#entryForm');
  const formError = $('#formError');
  const amountInput = $('#amount');
  const shotInput = $('#shot');
  const shotPreview = $('#shotPreview');
  const shotRemove = $('#shotRemove');
  const detail = $('#detail');
  const detailBody = $('#detailBody');

  /* ---------- Helpers ---------- */
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const withTimeout = (promise, ms = 20000) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

  function friendlyError(err) {
    const code = (err && err.code) || '';
    const msg = (err && err.message) || '';
    if (msg === 'timeout') return 'This is taking too long. Check your internet and try again.';
    if (code === 'permission-denied') return 'Permission denied. Check that the Firestore rules from SETUP.md are published.';
    if (code === 'unavailable') return 'You seem to be offline. Try again when you have internet.';
    return msg || 'Something went wrong. Please try again.';
  }

  function authMessage(err) {
    switch (err && err.code) {
      case 'auth/invalid-email': return 'That email address does not look right.';
      case 'auth/missing-password': return 'Enter your password.';
      case 'auth/weak-password': return 'Use a password with at least 6 characters.';
      case 'auth/email-already-in-use': return 'An account with this email already exists. Try logging in.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found': return 'Wrong email or password.';
      case 'auth/too-many-requests': return 'Too many tries. Wait a few minutes and try again.';
      case 'auth/network-request-failed': return 'No internet connection.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request': return '';
      case 'auth/operation-not-allowed': return 'This sign-in method is not turned on in Firebase yet.';
      case 'auth/unauthorized-domain': return 'This website address is not allowed yet. Add it under Authentication, Settings, Authorized domains in Firebase.';
      default: return 'Could not sign in. Please try again.';
    }
  }

  const todayStr = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  const fmtNum = (n) =>
    new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

  const fmtDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  };

  // 100 USC = 1 USD
  const toUSD = (e) => {
    if (e.result === 'be') return 0;
    const usd = e.currency === 'USC' ? e.amount / 100 : e.amount;
    return e.result === 'loss' ? -usd : usd;
  };

  const fmtResult = (e) => {
    if (e.result === 'be') return 'Break even';
    const sign = e.result === 'profit' ? '+' : '\u2212';
    return `${sign}${fmtNum(e.amount)} ${e.currency}`;
  };

  /* ---------- Rendering ---------- */
  function buildCard(e) {
    const card = el('button', `card ${e.result}`);
    card.type = 'button';
    card.setAttribute('aria-label', `${e.pair}, ${fmtResult(e)}. Open details`);

    if (e.image) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = e.image;
      img.alt = '';
      img.loading = 'lazy';
      card.append(img);
    } else {
      card.append(el('div', 'thumb placeholder', 'No screenshot'));
    }

    const body = el('div', 'card-body');
    body.append(
      el('p', 'pair', e.pair),
      el('p', `amount ${e.result}`, fmtResult(e)),
      el('p', 'date', fmtDate(e.date))
    );
    card.append(body);
    card.addEventListener('click', () => openDetail(e));
    return card;
  }

  function openDetail(e) {
    detailBody.replaceChildren();

    if (e.image) {
      const img = document.createElement('img');
      img.className = 'detail-img';
      img.src = e.image;
      img.alt = `${e.pair} screenshot`;
      detailBody.append(img);
    }

    const body = el('div', 'detail-body');
    const head = el('div', 'detail-head');
    const left = el('div');
    left.append(el('h2', 'pair', e.pair));
    const meta = el('p', 'meta');
    meta.append(el('span', `side ${e.side}`, e.side === 'buy' ? 'Buy' : 'Sell'));
    meta.append(el('time', '', fmtDate(e.date)));
    left.append(meta);
    head.append(left, el('p', `amount ${e.result}`, fmtResult(e)));

    const actions = el('div', 'detail-actions');
    const close = el('button', 'btn ghost', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => detail.close());
    const del = el('button', 'btn ghost danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => removeEntry(e));
    const edit = el('button', 'btn primary', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => { detail.close(); openDialog(e); });
    actions.append(close, del, edit);

    body.append(head, actions);
    detailBody.append(body);
    detail.showModal();
  }

  function renderStats() {
    const wins = entries.filter((e) => e.result === 'profit').length;
    const losses = entries.filter((e) => e.result === 'loss').length;
    const net = entries.reduce((sum, e) => sum + toUSD(e), 0);

    $('#statTrades').textContent = entries.length;
    $('#statWinRate').textContent = wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : '\u2014';

    const netEl = $('#statNet');
    netEl.textContent = money(net, true);
    netEl.className = 'stat-value' + (net > 0 ? ' profit' : net < 0 ? ' loss' : '');

    renderBalance();
    renderCalendar();
  }

  function render() {
    const visible = entries
      .filter((e) => filter === 'all' || e.result === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

    feed.replaceChildren(...visible.map(buildCard));
    emptyBox.hidden = visible.length > 0;

    if (!visible.length) {
      if (!entries.length) {
        emptyTitle.textContent = 'No trades yet';
        emptyText.textContent = 'Select New entry to log your first trade.';
      } else {
        emptyTitle.textContent = 'No matching trades';
        emptyText.textContent = 'Try a different filter.';
      }
    }
    renderStats();
  }

  /* ---------- Balance ---------- */
  const startInput = $('#startBalance');

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const shortDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const longDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const countLabel = (n) => `${n} ${n === 1 ? 'trade' : 'trades'}`;

  // Every amount is kept in USD internally; this only changes how it is shown.
  function money(usd, signed) {
    const v = Math.round((settings.display === 'USC' ? usd * 100 : usd) * 100) / 100;
    const abs = fmtNum(Math.abs(v));
    const body = settings.display === 'USC' ? `${abs} USC` : `$${abs}`;
    if (!signed || v === 0) return body;
    return (v > 0 ? '+' : '\u2212') + body;
  }

  function periodRange(key) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (key) {
      case 'week': return [addDays(today, -6), today];
      case 'lastmonth':
        return [new Date(today.getFullYear(), today.getMonth() - 1, 1),
                new Date(today.getFullYear(), today.getMonth(), 0)];
      case '6m': return [addDays(today, -182), today];
      case '1y': return [addDays(today, -364), today];
      default: return [new Date(today.getFullYear(), today.getMonth(), 1), today];
    }
  }

  function renderBalance() {
    const totalNet = entries.reduce((s, e) => s + toUSD(e), 0);
    $('#balanceValue').textContent = money(settings.startUSD + totalNet);

    const [start, end] = periodRange(settings.period);
    const startStr = ymd(start);
    const endStr = ymd(end);
    $('#rangeLabel').textContent = `${longDate(start)} \u2013 ${longDate(end)}`;

    const sum = { profit: { n: 0, usd: 0 }, loss: { n: 0, usd: 0 }, be: { n: 0, usd: 0 } };
    entries.forEach((e) => {
      if (e.date >= startStr && e.date <= endStr) {
        sum[e.result].n++;
        sum[e.result].usd += toUSD(e);
      }
    });
    $('#sumProfit').textContent = money(sum.profit.usd, true);
    $('#sumProfitCount').textContent = countLabel(sum.profit.n);
    $('#sumLoss').textContent = money(sum.loss.usd, true);
    $('#sumLossCount').textContent = countLabel(sum.loss.n);
    $('#sumBe').textContent = sum.be.n;
    $('#sumBeCount').textContent = sum.be.n === 1 ? 'trade' : 'trades';
  }

    function syncStartInput() {
    const v = settings.display === 'USC' ? settings.startUSD * 100 : settings.startUSD;
    startInput.value = v ? Math.round(v * 100) / 100 : '';
  }

  /* ---------- Profit calendar ---------- */
  const calGrid = $('#calGrid');
  const calDay = $('#calDay');
  const nowDate = new Date();
  let calMonth = { y: nowDate.getFullYear(), m: nowDate.getMonth() };
  let calSelected = null;

  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const round2 = (n) => Math.round(n * 100) / 100;
  const signClass = (usd) => { const v = round2(usd); return v > 0 ? 'profit' : v < 0 ? 'loss' : 'be'; };

  function cellMoney(usd) {
    const v = round2(settings.display === 'USC' ? usd * 100 : usd);
    if (v === 0) return '0';
    return (v > 0 ? '+' : '\u2212') + compact.format(Math.abs(v));
  }

  function renderCalendar() {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1);
    $('#calMonth').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#calNext').disabled = y * 12 + m >= nowDate.getFullYear() * 12 + nowDate.getMonth();

    const prefix = `${y}-${pad2(m + 1)}-`;
    const days = {};
    let monthUSD = 0;
    let monthN = 0;
    entries.forEach((e) => {
      if (!e.date.startsWith(prefix)) return;
      const day = days[e.date] || (days[e.date] = { usd: 0, list: [] });
      day.usd += toUSD(e);
      day.list.push(e);
      monthUSD += toUSD(e);
      monthN++;
    });

    const totalEl = $('#calTotal');
    totalEl.textContent = monthN ? `${money(monthUSD, true)} \u00b7 ${countLabel(monthN)}` : 'No trades';
    totalEl.className = 'cal-total' + (monthN ? ' ' + signClass(monthUSD) : '');

    const todayKey = ymd(new Date());
    const cells = [];
    const offset = (first.getDay() + 6) % 7; // week starts on Monday
    for (let i = 0; i < offset; i++) cells.push(el('div', 'cal-cell empty'));

    const dim = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const dateStr = prefix + pad2(d);
      const info = days[dateStr];
      const isToday = dateStr === todayKey;

      if (!info) {
        const cell = el('div', 'cal-cell' + (isToday ? ' today' : ''));
        cell.append(el('span', 'cal-num', d));
        cells.push(cell);
        continue;
      }

      const cell = el('button', `cal-cell has ${signClass(info.usd)}` + (isToday ? ' today' : ''));
      cell.type = 'button';
      cell.setAttribute('aria-pressed', String(calSelected === dateStr));
      cell.setAttribute('aria-label', `${fmtDate(dateStr)}: ${money(info.usd, true)}, ${countLabel(info.list.length)}`);
      const val = el('span', 'cal-val');
      val.append(el('span', 'cal-amt', cellMoney(info.usd)), el('span', 'cal-unit', settings.display));
      const n = info.list.length;
      const count = el('span', 'cal-count');
      count.append(String(n), el('span', 'cal-word', n === 1 ? ' trade' : ' trades'));
      const top = el('span', 'cal-top');
      top.append(el('span', 'cal-num', d), count);
      cell.append(top, val);
      cell.addEventListener('click', () => {
        calSelected = calSelected === dateStr ? null : dateStr;
        renderCalendar();
      });
      cells.push(cell);
    }
    calGrid.replaceChildren(...cells);

    const sel = calSelected && days[calSelected];
    calDay.hidden = !sel;
    if (sel) {
      const head = el('h3', '', `${fmtDate(calSelected)} \u00b7 ${money(sel.usd, true)}`);
      const rows = sel.list
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((e) => {
          const row = el('button', 'cal-trade');
          row.type = 'button';
          const left = el('span', 'cal-trade-left');
          left.append(el('span', 'pair', e.pair), el('span', `side ${e.side}`, e.side === 'buy' ? 'Buy' : 'Sell'));
          row.append(left, el('span', `amount ${e.result}`, fmtResult(e)));
          row.addEventListener('click', () => openDetail(e));
          return row;
        });
      calDay.replaceChildren(head, ...rows);
    }
  }

  function shiftMonth(n) {
    const d = new Date(calMonth.y, calMonth.m + n, 1);
    calMonth = { y: d.getFullYear(), m: d.getMonth() };
    calSelected = null;
    renderCalendar();
  }

  /* ---------- Image handling ---------- */
  function compressImage(file, maxWidth = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  // src = picture to show, blob = a new picture that still has to be uploaded
  function showPreview(src, blob = null) {
    if (shotPreview.dataset.blobUrl) URL.revokeObjectURL(shotPreview.dataset.blobUrl);
    delete shotPreview.dataset.blobUrl;
    pending = { url: blob ? null : (src || null), blob };
    shotPreview.hidden = !src;
    shotRemove.hidden = !src;
    if (src) {
      shotPreview.src = src;
      if (blob) shotPreview.dataset.blobUrl = src;
    }
  }

  /* ---------- Dialog ---------- */
  function setError(msg) {
    formError.textContent = msg || '';
    formError.hidden = !msg;
  }

  function syncAmount() {
    const isBE = form.elements.result.value === 'be';
    amountInput.disabled = isBE;
    amountInput.required = !isBE;
    if (isBE) amountInput.value = '';
  }

  function openDialog(entry) {
    editingId = entry ? entry.id : null;
    form.reset();
    setError('');
    $('#dialogTitle').textContent = entry ? 'Edit entry' : 'New entry';
    $('#saveBtn').textContent = entry ? 'Save changes' : 'Save entry';

    form.elements.date.value = entry ? entry.date : todayStr();
    if (entry) {
      form.elements.pair.value = entry.pair;
      form.elements.side.value = entry.side;
      form.elements.result.value = entry.result;
      form.elements.currency.value = entry.currency;
      if (entry.result !== 'be') amountInput.value = entry.amount;
    }
    showPreview(entry ? entry.image : null);
    syncAmount();
    dialog.showModal();
    form.elements.pair.focus();
  }

  async function removeEntry(entry) {
    if (!confirm(`Delete the ${entry.pair} entry? This cannot be undone.`)) return;
    try {
      await withTimeout(cloud.deleteEntry(currentUser.uid, entry.id));
      detail.close();
    } catch (err) {
      alert(friendlyError(err));
    }
  }

  /* ---------- Events ---------- */
  $('#newBtn').addEventListener('click', () => openDialog(null));
  $('#cancelBtn').addEventListener('click', () => dialog.close());

  // Click on the backdrop closes the dialogs
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  detail.addEventListener('click', (ev) => { if (ev.target === detail) detail.close(); });

  form.querySelectorAll('input[name="result"]').forEach((r) =>
    r.addEventListener('change', syncAmount)
  );

  $('#shotBtn').addEventListener('click', () => shotInput.click());
  shotRemove.addEventListener('click', () => { shotInput.value = ''; showPreview(null); });

  shotInput.addEventListener('change', async () => {
    const file = shotInput.files[0];
    if (!file) return;
    try {
      setError('');
      const blob = await compressImage(file);
      showPreview(URL.createObjectURL(blob), blob);
    } catch {
      setError('That file could not be read as an image. Choose a PNG or JPG.');
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pair = form.elements.pair.value.trim().toUpperCase();
    const result = form.elements.result.value;
    const amount = result === 'be' ? 0 : Number(amountInput.value);

    if (!pair) return setError('Enter the pair, for example XAUUSD.');
    if (result !== 'be' && !(amount > 0)) return setError('Enter an amount greater than 0.');
    if (!currentUser) return setError('You are logged out. Log in again.');

    const saveBtn = $('#saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving\u2026';
    setError('');

    try {
      let image = pending.url;
      if (pending.blob) image = await withTimeout(cloud.uploadImage(currentUser.uid, pending.blob), 60000);

      const existing = entries.find((e) => e.id === editingId);
      const entry = {
        id: existing ? existing.id : newId(),
        createdAt: existing ? existing.createdAt : Date.now(),
        pair,
        side: form.elements.side.value,
        currency: form.elements.currency.value,
        result,
        amount,
        date: form.elements.date.value || todayStr(),
        image: image || null
      };

      await withTimeout(cloud.saveEntry(currentUser.uid, entry));
      dialog.close();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = editingId ? 'Save changes' : 'Save entry';
    }
  });

  document.querySelectorAll('.filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      document.querySelectorAll('.filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
      render();
    });
  });

  /* ---------- Balance events ---------- */
  document.querySelectorAll('input[name="display"]').forEach((r) => {
    r.checked = r.value === settings.display;
    r.addEventListener('change', () => {
      settings.display = r.value;
      persistPrefs();
      syncStartInput();
      renderStats();
    });
  });

  startInput.addEventListener('input', () => {
    const v = Number(startInput.value);
    const val = Number.isFinite(v) && v > 0 ? v : 0;
    settings.startUSD = settings.display === 'USC' ? val / 100 : val;
    persistStart();
    renderStats();
  });

  document.querySelectorAll('.periods .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.period === settings.period);
    chip.addEventListener('click', () => {
      settings.period = chip.dataset.period;
      persistPrefs();
      document.querySelectorAll('.periods .chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderBalance();
    });
  });

  syncStartInput();

  /* ---------- Calendar events ---------- */
  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));

  /* ---------- Theme ---------- */
  const themeBtn = $('#themeToggle');

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }

  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  });

  /* ---------- Login & start ---------- */
  const bootEl = $('#boot');
  const appEl = $('#app');
  const authScreen = $('#authScreen');
  const setupScreen = $('#setupScreen');
  const authForm = $('#authForm');
  const authErrorEl = $('#authError');
  const authInfoEl = $('#authInfo');
  const syncErrorEl = $('#syncError');
  const migrateBox = $('#migrate');
  const migrateText = $('#migrateText');
  const migrateBtn = $('#migrateBtn');

  function showOnly(which) {
    bootEl.hidden = which !== 'boot';
    appEl.hidden = which !== 'app';
    authScreen.hidden = which !== 'auth';
    setupScreen.hidden = which !== 'setup';
  }

  function setAuthMsg(error, info) {
    authErrorEl.textContent = error || '';
    authErrorEl.hidden = !error;
    authInfoEl.textContent = info || '';
    authInfoEl.hidden = !info;
  }

  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    $('#authSubmit').textContent = signup ? 'Create account' : 'Log in';
    $('#authSub').textContent = signup
      ? 'Create an account. Your journal is private to you.'
      : 'Log in to see your journal.';
    $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('#forgotBtn').hidden = signup;
    setAuthMsg('', '');
  }

  document.querySelectorAll('input[name="authMode"]').forEach((r) =>
    r.addEventListener('change', () => setAuthMode(r.value))
  );
  $('#authTabs').hidden = !cloud.allowSignup;
  $('#googleBtn').hidden = !cloud.googleSignIn;

  authForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    setAuthMsg('', '');
    if (!email || !password) return setAuthMsg('Enter your email and password.', '');

    const btn = $('#authSubmit');
    btn.disabled = true;
    try {
      if (authMode === 'signup' && cloud.allowSignup) await cloud.signUp(email, password);
      else await cloud.logIn(email, password);
    } catch (err) {
      setAuthMsg(authMessage(err), '');
    } finally {
      btn.disabled = false;
    }
  });

  $('#googleBtn').addEventListener('click', async () => {
    setAuthMsg('', '');
    try { await cloud.logInGoogle(); }
    catch (err) { setAuthMsg(authMessage(err), ''); }
  });

  $('#forgotBtn').addEventListener('click', async () => {
    const email = $('#authEmail').value.trim();
    if (!email) return setAuthMsg('Type your email above first, then tap Forgot password.', '');
    try {
      await cloud.resetPassword(email);
      setAuthMsg('', 'If an account exists for that email, a reset link was sent. Check your inbox and spam.');
    } catch (err) {
      setAuthMsg(authMessage(err), '');
    }
  });

  $('#logoutBtn').addEventListener('click', () => { cloud.logOut(); });

  /* One-time upload of the entries that were saved in this browser before login existed */
  let legacy = [];
  const migratedKey = () => `trading-journal:migrated:${currentUser.uid}`;

  function checkLegacy() {
    legacy = local.loadLegacyEntries();
    let done = null;
    try { done = localStorage.getItem(migratedKey()); } catch { /* ignore */ }
    const show = legacy.length > 0 && !done;
    migrateBox.hidden = !show;
    migrateBtn.disabled = false;
    if (show) {
      const n = legacy.length;
      migrateText.textContent =
        `Found ${n} ${n === 1 ? 'entry' : 'entries'} saved in this browser from before. Upload ${n === 1 ? 'it' : 'them'} to your account?`;
    }
  }

  migrateBtn.addEventListener('click', async () => {
    migrateBtn.disabled = true;
    let done = 0;
    let failed = 0;
    for (const old of legacy) {
      migrateText.textContent = `Uploading ${done + failed + 1} of ${legacy.length}\u2026`;
      try {
        let image = old.image || null;
        if (image && image.startsWith('data:')) {
          const blob = await (await fetch(image)).blob();
          image = await withTimeout(cloud.uploadImage(currentUser.uid, blob), 60000);
        }
        await withTimeout(cloud.saveEntry(currentUser.uid, { ...old, image }), 30000);
        done++;
      } catch {
        failed++;
      }
    }
    if (!failed) {
      if (legacyStartUSD > 0 && !settings.startUSD) {
        settings.startUSD = legacyStartUSD;
        cloud.saveStartUSD(currentUser.uid, legacyStartUSD).catch(() => {});
        syncStartInput();
        renderStats();
      }
      try { localStorage.setItem(migratedKey(), '1'); } catch { /* ignore */ }
      migrateBox.hidden = true;
    } else {
      migrateText.textContent = `${done} uploaded, ${failed} failed. Check your internet and try again.`;
      migrateBtn.disabled = false;
    }
  });

  $('#migrateSkip').addEventListener('click', () => { migrateBox.hidden = true; });

  /* Who is logged in decides what the page shows */
  async function onUserChange(user) {
    if (stopWatching) { stopWatching(); stopWatching = null; }
    currentUser = user;
    entries = [];
    syncErrorEl.hidden = true;
    migrateBox.hidden = true;

    if (!user) {
      $('#authPassword').value = '';
      setAuthMode('login');
      document.querySelector('input[name="authMode"][value="login"]').checked = true;
      showOnly('auth');
      render();
      return;
    }

    $('#userEmail').textContent = user.email || '';
    showOnly('app');
    settings.startUSD = 0;
    syncStartInput();
    render();

    try {
      const start = await cloud.loadStartUSD(user.uid);
      if (currentUser !== user) return;
      settings.startUSD = start;
      syncStartInput();
      renderStats();
    } catch (err) {
      console.error(err);
    }

    stopWatching = cloud.watchEntries(
      user.uid,
      (list) => { entries = list; syncErrorEl.hidden = true; render(); },
      (err) => {
        console.error(err);
        syncErrorEl.textContent = `Could not load your entries. ${friendlyError(err)}`;
        syncErrorEl.hidden = false;
      }
    );
    checkLegacy();
  }

  if (!cloud.isConfigured) showOnly('setup');
  else cloud.onUser(onUserChange);
})();
