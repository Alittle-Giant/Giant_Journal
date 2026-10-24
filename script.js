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

  /* ---------- Balance & chart ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const chart = $('#chart');
  const readout = $('#chartReadout');
  const startInput = $('#startBalance');
  let chartPoints = [];
  let chartGeo = null;
  let markerLine = null;
  let markerDot = null;

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

  const svgEl = (tag, attrs) => {
    const node = document.createElementNS(SVGNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  function setReadout(i) {
    if (i === null) {
      const first = chartPoints[0].value;
      const last = chartPoints[chartPoints.length - 1].value;
      readout.textContent = `${money(first)} \u2192 ${money(last)}  (${money(last - first, true)})`;
      return;
    }
    const p = chartPoints[i];
    readout.textContent = `${i === 0 ? 'Start of period' : longDate(p.date)}: ${money(p.value)}`;
  }

  function drawChart(points) {
    chartPoints = points;
    const W = 600, H = 240, padX = 10, padT = 14, padB = 26;
    const vals = points.map((p) => p.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      const gap = Math.max(1, Math.abs(max) * 0.05);
      min -= gap; max += gap;
    }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;

    const n = points.length;
    const x = (i) => padX + (i / (n - 1)) * (W - 2 * padX);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    chartGeo = { W, H, padX, padT, padB, n, x, y };

    chart.setAttribute('class', 'chart ' + (vals[n - 1] >= vals[0] ? 'up' : 'down'));
    chart.replaceChildren();

    for (let i = 0; i < 4; i++) {
      const gy = padT + i * ((H - padT - padB) / 3);
      chart.append(svgEl('line', { x1: padX, x2: W - padX, y1: gy, y2: gy, class: 'grid' }));
    }

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    chart.append(svgEl('path', {
      d: `${line} L${x(n - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`,
      class: 'area'
    }));
    chart.append(svgEl('path', { d: line, class: 'line' }));

    const left = svgEl('text', { x: padX, y: H - 7, class: 'axis' });
    left.textContent = shortDate(points[0].date);
    const right = svgEl('text', { x: W - padX, y: H - 7, class: 'axis', 'text-anchor': 'end' });
    right.textContent = shortDate(points[n - 1].date);
    chart.append(left, right);

    markerLine = svgEl('line', { class: 'marker-line', y1: padT, y2: H - padB, visibility: 'hidden' });
    markerDot = svgEl('circle', { class: 'marker-dot', r: 5, visibility: 'hidden' });
    chart.append(markerLine, markerDot);

    setReadout(null);
  }

  function renderBalance() {
    const totalNet = entries.reduce((s, e) => s + toUSD(e), 0);
    $('#balanceValue').textContent = money(settings.startUSD + totalNet);

    const [start, end] = periodRange(settings.period);
    const startStr = ymd(start);
    const endStr = ymd(end);
    $('#rangeLabel').textContent = `${longDate(start)} \u2013 ${longDate(end)}`;

    // Opening balance = starting balance + every trade before the period.
    let bal = settings.startUSD;
    const byDay = {};
    const inRange = [];
    entries.forEach((e) => {
      if (e.date < startStr) bal += toUSD(e);
      else if (e.date <= endStr) {
        byDay[e.date] = (byDay[e.date] || 0) + toUSD(e);
        inRange.push(e);
      }
    });

    const points = [{ date: start, value: bal }];
    for (let d = new Date(start); ymd(d) <= endStr; d = addDays(d, 1)) {
      bal += byDay[ymd(d)] || 0;
      points.push({ date: new Date(d), value: bal });
    }
    drawChart(points);

    const sum = { profit: { n: 0, usd: 0 }, loss: { n: 0, usd: 0 }, be: { n: 0, usd: 0 } };
    inRange.forEach((e) => { sum[e.result].n++; sum[e.result].usd += toUSD(e); });
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

  chart.addEventListener('pointermove', (ev) => {
    if (!chartGeo) return;
    const rect = chart.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * chartGeo.W;
    const ratio = (px - chartGeo.padX) / (chartGeo.W - 2 * chartGeo.padX);
    const i = Math.max(0, Math.min(chartGeo.n - 1, Math.round(ratio * (chartGeo.n - 1))));
    const cx = chartGeo.x(i);
    markerLine.setAttribute('x1', cx);
    markerLine.setAttribute('x2', cx);
    markerDot.setAttribute('cx', cx);
    markerDot.setAttribute('cy', chartGeo.y(chartPoints[i].value));
    markerLine.setAttribute('visibility', 'visible');
    markerDot.setAttribute('visibility', 'visible');
    setReadout(i);
  });

  chart.addEventListener('pointerleave', () => {
    if (!markerLine) return;
    markerLine.setAttribute('visibility', 'hidden');
    markerDot.setAttribute('visibility', 'hidden');
    setReadout(null);
  });

  syncStartInput();

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
