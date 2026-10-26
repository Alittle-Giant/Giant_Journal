(() => {
  'use strict';

  const ENTRIES_KEY = 'trading-journal:entries';
  const THEME_KEY = 'trading-journal:theme';
  const SETTINGS_KEY = 'trading-journal:settings';

  /* ---------- Storage ----------
     Everything goes through these two functions. To move to
     Firebase + Cloudinary later, replace their bodies only. */
  const store = {
    load() {
      try { return JSON.parse(localStorage.getItem(ENTRIES_KEY)) || []; }
      catch { return []; }
    },
    save(list) {
      try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(list)); return true; }
      catch { return false; }
    },
    loadSettings() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
      catch { return {}; }
    },
    saveSettings(s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    }
  };

  /* ---------- State ---------- */
  let entries = store.load();
  let filter = 'all';
  let editingId = null;
  let pendingImage = null;
  let settings = Object.assign({ startUSD: 0, display: 'USD', period: 'month' }, store.loadSettings());

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

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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
  function compressImage(file, maxWidth = 1280, quality = 0.8) {
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
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  function showPreview(src) {
    pendingImage = src || null;
    shotPreview.hidden = !src;
    shotRemove.hidden = !src;
    if (src) shotPreview.src = src;
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

  function removeEntry(entry) {
    if (!confirm(`Delete the ${entry.pair} entry? This cannot be undone.`)) return;
    entries = entries.filter((e) => e.id !== entry.id);
    store.save(entries);
    detail.close();
    render();
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
      showPreview(await compressImage(file));
    } catch {
      setError('That file could not be read as an image. Choose a PNG or JPG.');
    }
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pair = form.elements.pair.value.trim().toUpperCase();
    const result = form.elements.result.value;
    const amount = result === 'be' ? 0 : Number(amountInput.value);

    if (!pair) return setError('Enter the pair, for example XAUUSD.');
    if (result !== 'be' && !(amount > 0)) return setError('Enter an amount greater than 0.');

    const existing = entries.find((e) => e.id === editingId);
    const entry = {
      id: existing ? existing.id : uid(),
      createdAt: existing ? existing.createdAt : Date.now(),
      pair,
      side: form.elements.side.value,
      currency: form.elements.currency.value,
      result,
      amount,
      date: form.elements.date.value || todayStr(),
      image: pendingImage
    };

    const previous = entries;
    entries = existing
      ? entries.map((e) => (e.id === entry.id ? entry : e))
      : [...entries, entry];

    if (!store.save(entries)) {
      entries = previous;
      return setError('Storage is full. Delete old entries or use a smaller screenshot.');
    }

    dialog.close();
    render();
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
      store.saveSettings(settings);
      syncStartInput();
      renderStats();
    });
  });

  startInput.addEventListener('input', () => {
    const v = Number(startInput.value);
    const val = Number.isFinite(v) && v > 0 ? v : 0;
    settings.startUSD = settings.display === 'USC' ? val / 100 : val;
    store.saveSettings(settings);
    renderStats();
  });

  document.querySelectorAll('.periods .chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.period === settings.period);
    chip.addEventListener('click', () => {
      settings.period = chip.dataset.period;
      store.saveSettings(settings);
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

  /* ---------- Start ---------- */
  render();
})();
