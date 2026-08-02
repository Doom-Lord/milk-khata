(function () {
  'use strict';

  const STORAGE_KEY = 'mk_data_v1';
  const LEGACY_NAME = 'mk_farmName';
  const LEGACY_MOBILE = 'mk_farmMobile';

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const $ = (id) => document.getElementById(id);

  // ───────────────────────── helpers ─────────────────────────
  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function fmtNum(n) {
    const r = Math.round((Number(n) || 0) * 100) / 100;
    return r.toString();
  }

  function fmtRupee(n) {
    const r = Math.round((Number(n) || 0) * 100) / 100;
    return '₹' + r.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function daysInMonth(year, monthIndex0) {
    return new Date(year, monthIndex0 + 1, 0).getDate();
  }

  function parseYearMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return { year: y, month: m - 1, key: ym };
  }

  function currentYM() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  /** Default working month = previous calendar month (milk sold last month). */
  function previousYM() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthLabel(ym) {
    const { year, month } = parseYearMonth(ym);
    return MONTH_NAMES[month] + ' ' + year;
  }

  function shortMonth(m0) {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m0];
  }

  let selectedYM = previousYM();

  function getSelectedYM() {
    return selectedYM || previousYM();
  }

  function prevYM(ym) {
    const { year, month } = parseYearMonth(ym);
    const d = new Date(year, month - 1, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('mk-toast--show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('mk-toast--show'), 2200);
  }

  // ───────────────────────── data layer ─────────────────────────
  function defaultSettings() {
    return {
      farmName: 'Your Dairy Farm',
      tagline: 'जय दादा बिशादे की',
      contactMobile: '999999999',
      paymentNumber: '',
      defaultRate: 80
    };
  }

  function emptyData() {
    return { settings: defaultSettings(), buyers: [], months: {} };
  }

  function migrateLegacy(data) {
    const legacyName = localStorage.getItem(LEGACY_NAME);
    const legacyMobile = localStorage.getItem(LEGACY_MOBILE);
    if (legacyName) data.settings.farmName = legacyName;
    if (legacyMobile) {
      data.settings.contactMobile = legacyMobile;
      if (!data.settings.paymentNumber) data.settings.paymentNumber = legacyMobile;
    }
    return data;
  }

  /** Active buyers, plus any inactive buyer who already has a row in this month (history). */
  function buyersForMonth(ym) {
    const month = DB.months[ym];
    const monthIds = month ? Object.keys(month.buyers || {}) : [];
    return allBuyersSorted().filter((b) => b.active || monthIds.includes(b.id));
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.settings && Array.isArray(parsed.buyers) && parsed.months) {
          return parsed;
        }
      }
    } catch (e) { /* fall through */ }

    const data = emptyData();
    migrateLegacy(data);
    saveData(data);
    return data;
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Keep legacy keys in sync for any old bookmarks / partial tools
    localStorage.setItem(LEGACY_NAME, data.settings.farmName || '');
    localStorage.setItem(LEGACY_MOBILE, data.settings.contactMobile || '');
  }

  let DB = loadData();

  function paymentNumber() {
    return (DB.settings.paymentNumber || DB.settings.contactMobile || '').trim();
  }

  function activeBuyersSorted() {
    return DB.buyers
      .filter((b) => b.active)
      .slice()
      .sort((a, b) => a.order - b.order);
  }

  function allBuyersSorted() {
    return DB.buyers.slice().sort((a, b) => a.order - b.order);
  }

  function ensureMonth(ym) {
    if (!DB.months[ym]) DB.months[ym] = { buyers: {} };
    const buyers = activeBuyersSorted();
    const prevKey = prevYM(ym);
    const prevMonth = DB.months[prevKey];

    buyers.forEach((b) => {
      if (!DB.months[ym].buyers[b.id]) {
        let opening = 0;
        if (prevMonth && prevMonth.buyers[b.id]) {
          opening = calcBuyer(prevMonth.buyers[b.id]).net;
        }
        DB.months[ym].buyers[b.id] = {
          rate: b.defaultRate,
          openingBalance: opening,
          adjustment: 0,
          days: {}
        };
      }
    });
    return DB.months[ym];
  }

  function calcBuyer(entry) {
    const days = entry.days || {};
    let total = 0;
    Object.keys(days).forEach((d) => {
      const v = parseFloat(days[d]);
      if (!isNaN(v)) total += v;
    });
    const rate = parseFloat(entry.rate) || 0;
    const opening = parseFloat(entry.openingBalance) || 0;
    const adj = parseFloat(entry.adjustment) || 0;
    const amount = total * rate;
    const net = amount + opening + adj;
    return { total, rate, amount, opening, adj, net };
  }

  function dayQtyArray(entry, numDays) {
    // Always 31 slots for receipt calendar layout (pad short months with 0)
    const arr = [];
    for (let i = 1; i <= 31; i++) {
      if (i > numDays) {
        arr.push(0);
      } else {
        const v = entry.days[String(i)];
        arr.push(v === undefined || v === '' || v === null ? 0 : parseFloat(v) || 0);
      }
    }
    return arr;
  }

  // ───────────────────────── navigation ─────────────────────────
  let currentPanel = 'entry';
  let printMode = null; // 'receipt' | 'ledger'

  function showPanel(name) {
    currentPanel = name;
    document.querySelectorAll('.mk-nav-btn').forEach((btn) => {
      btn.classList.toggle('mk-nav-btn--active', btn.dataset.panel === name);
    });
    document.querySelectorAll('.mk-panel').forEach((p) => {
      p.classList.toggle('mk-panel--active', p.id === 'panel-' + name);
    });
    if (name === 'entry') renderEntry();
    if (name === 'ledger') renderLedger();
    if (name === 'receipt') renderReceiptForm();
    if (name === 'buyers') renderBuyers();
    if (name === 'settings') renderSettings();
  }

  $('mainNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.mk-nav-btn');
    if (!btn) return;
    showPanel(btn.dataset.panel);
  });

  // ───────────────────────── Month picker (Jan–Dec buttons) ─────────────────────────
  const MONTH_PICKER_IDS = [
    'entryMonthPicker',
    'ledgerMonthPicker',
    'receiptMonthPicker',
    'buyersMonthPicker'
  ];

  function setSelectedYM(ym, source) {
    if (!ym) return;
    selectedYM = ym;
    updateAllMonthPickers();
    const src = source || currentPanel;
    if (src === 'entry') renderEntry();
    else if (src === 'ledger') renderLedger();
    else if (src === 'receipt') renderReceiptForm();
    else if (src === 'buyers') renderBuyers();
  }

  function paintMonthPicker(host, ym) {
    if (!host) return;
    const { year, month } = parseYearMonth(ym);
    host.innerHTML = `
      <div class="mk-year-wrap">
        <button type="button" class="mk-year-nav" data-year-delta="-1" aria-label="Previous year">‹</button>
        <span class="mk-year-label">${year}</span>
        <button type="button" class="mk-year-nav" data-year-delta="1" aria-label="Next year">›</button>
      </div>
      <div class="mk-month-btns">
        ${Array.from({ length: 12 }, (_, i) => {
          const active = i === month ? ' mk-month-btn--active' : '';
          return `<button type="button" class="mk-month-btn${active}" data-month="${i + 1}">${shortMonth(i)}</button>`;
        }).join('')}
      </div>`;
  }

  function updateAllMonthPickers() {
    const ym = getSelectedYM();
    MONTH_PICKER_IDS.forEach((id) => paintMonthPicker($(id), ym));
  }

  function pickerSource(host) {
    if (!host || !host.id) return '';
    if (host.id.indexOf('entry') === 0) return 'entry';
    if (host.id.indexOf('ledger') === 0) return 'ledger';
    if (host.id.indexOf('receipt') === 0) return 'receipt';
    if (host.id.indexOf('buyers') === 0) return 'buyers';
    return '';
  }

  function bindMonthPickers() {
    selectedYM = previousYM();
    updateAllMonthPickers();

    MONTH_PICKER_IDS.forEach((id) => {
      const host = $(id);
      if (!host) return;
      host.addEventListener('click', (e) => {
        const yearBtn = e.target.closest('[data-year-delta]');
        const monthBtn = e.target.closest('[data-month]');
        const { year, month } = parseYearMonth(getSelectedYM());
        const source = pickerSource(host);

        if (yearBtn) {
          const delta = parseInt(yearBtn.dataset.yearDelta, 10);
          const next = (year + delta) + '-' + String(month + 1).padStart(2, '0');
          setSelectedYM(next, source);
          return;
        }
        if (monthBtn) {
          const m = parseInt(monthBtn.dataset.month, 10);
          const next = year + '-' + String(m).padStart(2, '0');
          setSelectedYM(next, source);
        }
      });
    });
  }

  // Keep old name as alias used nowhere after refactor — sync helper for callers
  function syncMonthInputs(ym) {
    setSelectedYM(ym || getSelectedYM());
  }

  // ───────────────────────── Settings ─────────────────────────
  function renderSettings() {
    const s = DB.settings;
    $('setFarmName').value = s.farmName || '';
    $('setTagline').value = s.tagline || '';
    $('setContact').value = s.contactMobile || '';
    $('setPayment').value = s.paymentNumber || '';
    $('setDefaultRate').value = s.defaultRate ?? 80;
    updateBrandSubtitle();
  }

  function updateBrandSubtitle() {
    const el = $('brandSubtitle');
    if (el) el.textContent = (DB.settings.farmName || 'Milk bill · Monthly ledger');
  }

  function bindSettings() {
    const map = {
      setFarmName: 'farmName',
      setTagline: 'tagline',
      setContact: 'contactMobile',
      setPayment: 'paymentNumber',
      setDefaultRate: 'defaultRate'
    };
    Object.keys(map).forEach((id) => {
      $(id).addEventListener('input', () => {
        const key = map[id];
        let val = $(id).value;
        if (key === 'defaultRate') val = parseFloat(val) || 0;
        DB.settings[key] = val;
        saveData(DB);
        updateBrandSubtitle();
        if (key === 'defaultRate') {
          updatePasteBuyersTip();
        }
      });
    });
  }

  // ───────────────────────── Buyers ─────────────────────────
  function updatePasteBuyersTip() {
    const tip = $('pasteBuyersTip');
    if (!tip) return;
    const rate = DB.settings.defaultRate || 80;
    tip.textContent = `All get the Settings default rate ₹${fmtNum(rate)}/L. Edit a buyer for a different rate. Existing names are skipped.`;
  }

  function normalizeBuyerName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
  }

  function parseBuyerNames(raw) {
    return String(raw || '')
      .split(/[\n\r,;\t]+/)
      .map(normalizeBuyerName)
      .filter((n) => n.length > 0);
  }

  function addBuyersFromNames(names) {
    const rate = parseFloat(DB.settings.defaultRate) || 80;
    const existing = new Set(
      DB.buyers
        .filter((b) => b.active)
        .map((b) => normalizeBuyerName(b.name).toLowerCase())
    );
    let maxOrder = DB.buyers.reduce((m, b) => Math.max(m, b.order || 0), 0);
    let added = 0;
    let skipped = 0;
    const seenInPaste = new Set();

    names.forEach((name) => {
      const key = name.toLowerCase();
      if (seenInPaste.has(key) || existing.has(key)) {
        skipped += 1;
        return;
      }
      seenInPaste.add(key);
      existing.add(key);
      maxOrder += 1;
      DB.buyers.push({
        id: uid('b'),
        name,
        defaultRate: rate,
        active: true,
        order: maxOrder
      });
      added += 1;
    });

    if (added > 0) saveData(DB);
    return { added, skipped, rate };
  }

  function renderBuyers() {
    updatePasteBuyersTip();
    const list = $('buyerList');
    const buyers = allBuyersSorted();
    const ym = getSelectedYM();
    ensureMonth(ym);
    saveData(DB);
    const monthData = DB.months[ym];

    if (!buyers.length) {
      list.innerHTML = `
        <div class="mk-empty-cta">
          <h3>No buyers yet</h3>
          <p>Add a name above, or paste a list and click <b>Add from list</b>. Rate comes from Settings.</p>
        </div>`;
      return;
    }
    list.innerHTML = buyers.map((b, idx) => {
      const entry = monthData.buyers[b.id] || {
        rate: b.defaultRate,
        openingBalance: 0,
        adjustment: 0,
        days: {}
      };
      // Inactive buyers may not have a month row yet
      if (!monthData.buyers[b.id] && b.active) {
        // ensureMonth should have created it for active; leave as-is
      }
      const c = calcBuyer(entry);
      const rateVal = monthData.buyers[b.id] ? entry.rate : b.defaultRate;
      const openingVal = monthData.buyers[b.id] ? entry.openingBalance : 0;
      return `
      <div class="mk-buyer-item ${b.active ? '' : 'mk-buyer-item--inactive'}" data-id="${escapeHtml(b.id)}">
        <div class="mk-buyer-info">
          <strong>${escapeHtml(b.name)}</strong>
          <span>${b.active ? 'Active' : 'Inactive'} · ${escapeHtml(monthLabel(ym))} · ${fmtNum(c.total)} L · NET ${fmtRupee(c.net)}</span>
        </div>
        <div class="mk-buyer-finance">
          <label>Rate ₹
            <input type="number" step="0.5" min="0" inputmode="decimal" data-fin="rate" value="${fmtNum(rateVal)}" ${b.active ? '' : 'disabled'}>
          </label>
          <label>Prev. balance
            <input type="number" step="1" inputmode="decimal" data-fin="openingBalance" value="${fmtNum(openingVal)}" title="Negative (−) = paid this much less last month" ${b.active && monthData.buyers[b.id] ? '' : 'disabled'}>
          </label>
        </div>
        <div class="mk-buyer-actions">
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="down" ${idx === buyers.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="edit">Edit</button>
          <button type="button" class="mk-btn mk-btn--danger mk-btn--sm" data-act="toggle">${b.active ? 'Remove' : 'Restore'}</button>
        </div>
      </div>`;
    }).join('');
  }

  function reindexOrders() {
    allBuyersSorted().forEach((b, i) => { b.order = i + 1; });
  }

  function bindBuyers() {
    $('addBuyerBtn').addEventListener('click', () => {
      const name = normalizeBuyerName($('newBuyerName').value);
      const err = $('buyerError');
      if (!name) { err.textContent = 'Please enter a name.'; return; }
      err.textContent = '';
      const result = addBuyersFromNames([name]);
      if (result.added === 0) {
        err.textContent = 'This buyer is already in the list.';
        return;
      }
      $('newBuyerName').value = '';
      renderBuyers();
      showToast('Buyer added ✅ (rate ₹' + fmtNum(result.rate) + ')');
    });

    $('pasteBuyersBtn').addEventListener('click', () => {
      const names = parseBuyerNames($('pasteBuyers').value);
      const err = $('buyerError');
      if (!names.length) {
        err.textContent = 'Please paste a list of names (one per line).';
        return;
      }
      err.textContent = '';
      const result = addBuyersFromNames(names);
      if (result.added === 0) {
        err.textContent = 'No new names found — all already exist.';
        return;
      }
      $('pasteBuyers').value = '';
      renderBuyers();
      let msg = result.added + ' buyer(s) added (rate ₹' + fmtNum(result.rate) + ')';
      if (result.skipped) msg += ' · ' + result.skipped + ' skipped';
      showToast(msg + ' ✅');
    });

    $('pasteClipboardBtn').addEventListener('click', async () => {
      const err = $('buyerError');
      err.textContent = '';
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          err.textContent = 'Clipboard unavailable — paste into the list box (Ctrl/Cmd+V).';
          $('pasteBuyers').focus();
          return;
        }
        const text = await navigator.clipboard.readText();
        $('pasteBuyers').value = text;
        const names = parseBuyerNames(text);
        if (!names.length) {
          err.textContent = 'No names found on the clipboard.';
          return;
        }
        showToast(names.length + ' name(s) found — click «Add from list»');
      } catch (e) {
        err.textContent = 'Could not read clipboard — paste into the list box (Ctrl/Cmd+V).';
        $('pasteBuyers').focus();
      }
    });

    $('buyerList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const item = btn.closest('.mk-buyer-item');
      const id = item.dataset.id;
      const buyers = allBuyersSorted();
      const idx = buyers.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const act = btn.dataset.act;

      if (act === 'up' && idx > 0) {
        const a = buyers[idx], b = buyers[idx - 1];
        const tmp = a.order; a.order = b.order; b.order = tmp;
        saveData(DB);
        renderBuyers();
      }
      if (act === 'down' && idx < buyers.length - 1) {
        const a = buyers[idx], b = buyers[idx + 1];
        const tmp = a.order; a.order = b.order; b.order = tmp;
        saveData(DB);
        renderBuyers();
      }
      if (act === 'toggle') {
        buyers[idx].active = !buyers[idx].active;
        saveData(DB);
        renderBuyers();
        showToast(buyers[idx].active ? 'Buyer active ✅' : 'Buyer inactive (history kept)');
      }
      if (act === 'edit') {
        const ym = getSelectedYM();
        ensureMonth(ym);
        const entry = DB.months[ym].buyers[buyers[idx].id] || {
          rate: buyers[idx].defaultRate,
          openingBalance: 0,
          adjustment: 0
        };
        $('editBuyerId').value = buyers[idx].id;
        $('editBuyerName').value = buyers[idx].name;
        $('editBuyerRate').value = buyers[idx].active && entry.rate != null ? entry.rate : buyers[idx].defaultRate;
        $('editBuyerOpening').value = entry.openingBalance || 0;
        $('buyerModal').classList.add('mk-modal-backdrop--show');
      }
    });

    $('buyerList').addEventListener('input', (e) => {
      const input = e.target;
      if (!input.matches('input[data-fin]')) return;
      const item = input.closest('.mk-buyer-item');
      if (!item) return;
      const id = item.dataset.id;
      const buyer = DB.buyers.find((b) => b.id === id);
      if (!buyer || !buyer.active) return;
      const ym = getSelectedYM();
      ensureMonth(ym);
      const field = input.dataset.fin;
      const val = input.value === '' ? 0 : parseFloat(input.value) || 0;
      if (field === 'rate') {
        if (val <= 0) return;
        buyer.defaultRate = val;
        DB.months[ym].buyers[id].rate = val;
      } else if (field === 'openingBalance') {
        DB.months[ym].buyers[id].openingBalance = val;
      }
      saveData(DB);
      const entry = DB.months[ym].buyers[id];
      const c = calcBuyer(entry);
      const info = item.querySelector('.mk-buyer-info span');
      if (info) {
        info.textContent = `Active · ${monthLabel(ym)} · ${fmtNum(c.total)} L · NET ${fmtRupee(c.net)}`;
      }
    });

    $('cancelBuyerBtn').addEventListener('click', () => {
      $('buyerModal').classList.remove('mk-modal-backdrop--show');
    });
    $('buyerModal').addEventListener('click', (e) => {
      if (e.target === $('buyerModal')) $('buyerModal').classList.remove('mk-modal-backdrop--show');
    });
    $('saveBuyerBtn').addEventListener('click', () => {
      const id = $('editBuyerId').value;
      const b = DB.buyers.find((x) => x.id === id);
      if (!b) return;
      const name = normalizeBuyerName($('editBuyerName').value);
      const rate = parseFloat($('editBuyerRate').value);
      const opening = parseFloat($('editBuyerOpening').value) || 0;
      if (!name || !rate || rate <= 0) {
        showToast('Enter a valid name and rate');
        return;
      }
      b.name = name;
      b.defaultRate = rate;
      const ym = getSelectedYM();
      ensureMonth(ym);
      if (DB.months[ym].buyers[id]) {
        DB.months[ym].buyers[id].rate = rate;
        DB.months[ym].buyers[id].openingBalance = opening;
      }
      saveData(DB);
      $('buyerModal').classList.remove('mk-modal-backdrop--show');
      renderBuyers();
      showToast('Saved ✅');
    });
  }

  // ───────────────────────── Entry grid ─────────────────────────
  function renderEntry() {
    const ym = getSelectedYM();
    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    ensureMonth(ym);
    saveData(DB);

    const buyers = buyersForMonth(ym);
    const monthData = DB.months[ym];
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDay = isCurrentMonth ? today.getDate() : null;

    if (!buyers.length) {
      $('entryGridHost').innerHTML = `
        <div class="mk-empty-cta">
          <h3>Start milk entry</h3>
          <p>Add buyers first, then enter daily quantities here.<br>
          Tap a cell → type litres → Enter moves to the next buyer.</p>
          <div class="mk-actions">
            <button type="button" class="mk-btn mk-btn--primary" id="goAddBuyersBtn">+ Add buyers</button>
          </div>
        </div>`;
      $('entryTotals').innerHTML = '';
      const goBtn = $('goAddBuyersBtn');
      if (goBtn) {
        goBtn.addEventListener('click', () => showPanel('buyers'));
      }
      return;
    }

    // Grid
    let html = '<p class="mk-entry-tip">💡 Tap an empty cell to enter litres. Set rate / balance on the <b>Buyers</b> tab. Enter/Tab = next buyer.</p>';
    html += '<div class="mk-grid-scroll"><table class="mk-entry-table"><thead><tr><th>Date</th>';
    buyers.forEach((b) => {
      html += `<th class="mk-col-buyer">${escapeHtml(b.name)}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let d = 1; d <= numDays; d++) {
      const rowClass = todayDay === d ? 'mk-today' : '';
      html += `<tr class="${rowClass}" data-day="${d}" id="entry-day-${d}"><td>${d}</td>`;
      buyers.forEach((b, bi) => {
        const entry = monthData.buyers[b.id];
        const val = entry.days[String(d)];
        const display = (val === undefined || val === null || val === '') ? '' : fmtNum(val);
        html += `<td><input type="number" step="0.5" min="0" inputmode="decimal"
          data-buyer="${escapeHtml(b.id)}" data-day="${d}" data-col="${bi}"
          value="${display}" placeholder="—"></td>`;
      });
      html += '</tr>';
    }

    // Footer totals (litres only on entry — money lives with buyers/ledger)
    html += '<tr class="mk-footer-row"><td>Total</td>';
    let farmLitres = 0;
    buyers.forEach((b) => {
      const c = calcBuyer(monthData.buyers[b.id]);
      farmLitres += c.total;
      html += `<td>${fmtNum(c.total)}</td>`;
    });
    html += '</tr></tbody></table></div>';
    $('entryGridHost').innerHTML = html;

    $('entryTotals').innerHTML =
      `<span>Total milk: <b>${fmtNum(farmLitres)} L</b></span>` +
      `<span class="mk-tip">Rate & balance → Buyers tab</span>`;
  }

  function refreshEntryFooter() {
    const ym = getSelectedYM();
    const monthData = DB.months[ym];
    if (!monthData) return;
    const buyers = buyersForMonth(ym);

    const footerCells = document.querySelectorAll('.mk-entry-table .mk-footer-row td');
    let farmLitres = 0;
    buyers.forEach((b, i) => {
      const c = calcBuyer(monthData.buyers[b.id]);
      farmLitres += c.total;
      if (footerCells[i + 1]) footerCells[i + 1].textContent = fmtNum(c.total);
    });
    $('entryTotals').innerHTML =
      `<span>Total milk: <b>${fmtNum(farmLitres)} L</b></span>` +
      `<span class="mk-tip">Rate & balance → Buyers tab</span>`;
  }

  function bindEntry() {
    $('jumpTodayBtn').addEventListener('click', () => {
      // Keep working month (defaults to previous month); jump to today if that
      // month is current, otherwise to the last day of the selected month.
      const ym = getSelectedYM();
      renderEntry();
      if (!buyersForMonth(ym).length) {
        showPanel('buyers');
        showToast('Add buyers first');
        return;
      }
      const { year, month } = parseYearMonth(ym);
      const now = new Date();
      const numDays = daysInMonth(year, month);
      let day;
      if (now.getFullYear() === year && now.getMonth() === month) {
        day = Math.min(now.getDate(), numDays);
      } else {
        day = numDays;
      }
      const row = $('entry-day-' + day);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = row.querySelector('input');
        if (firstInput) {
          firstInput.focus();
          firstInput.select();
        }
      }
      showToast(monthLabel(ym) + ' — ready to enter milk');
    });

    $('entryGridHost').addEventListener('input', (e) => {
      const input = e.target;
      if (!input.matches('input[data-buyer]')) return;
      const ym = getSelectedYM();
      ensureMonth(ym);
      const buyerId = input.dataset.buyer;
      const day = input.dataset.day;
      const raw = input.value.trim();
      if (raw === '') {
        delete DB.months[ym].buyers[buyerId].days[String(day)];
      } else {
        const n = parseFloat(raw);
        if (!isNaN(n) && n >= 0) {
          DB.months[ym].buyers[buyerId].days[String(day)] = n;
        }
      }
      saveData(DB);
      refreshEntryFooter();
    });

    // Enter / Tab moves to next buyer same day; at end of row → next day first buyer
    $('entryGridHost').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      const input = e.target;
      if (!input.matches('input[data-buyer]')) return;
      e.preventDefault();
      const col = parseInt(input.dataset.col, 10);
      const day = parseInt(input.dataset.day, 10);
      const ym = getSelectedYM();
      const buyers = buyersForMonth(ym);
      const { year, month } = parseYearMonth(ym);
      const numDays = daysInMonth(year, month);

      let nextCol = col + 1;
      let nextDay = day;
      if (e.shiftKey && e.key === 'Tab') {
        nextCol = col - 1;
        if (nextCol < 0) {
          nextDay = day - 1;
          nextCol = buyers.length - 1;
        }
      } else {
        if (nextCol >= buyers.length) {
          nextCol = 0;
          nextDay = day + 1;
        }
      }
      if (nextDay < 1 || nextDay > numDays) return;
      const next = document.querySelector(
        `#entryGridHost input[data-day="${nextDay}"][data-col="${nextCol}"]`
      );
      if (next) {
        next.focus();
        next.select();
      }
    });
  }

  // ───────────────────────── Ledger ─────────────────────────
  function ledgerFooterRows() {
    return [
      { label: 'Total', get: (c) => fmtNum(c.total) },
      { label: 'Rate', get: (c) => fmtNum(c.rate) },
      { label: 'Amount', get: (c) => fmtNum(c.amount) },
      { label: 'Balance', get: (c) => {
        const bal = c.opening + c.adj;
        return bal === 0 ? '' : fmtNum(bal);
      }},
      { label: 'NET', get: (c) => fmtNum(c.net) }
    ];
  }

  function buildLedgerInnerHtml(ym, buyers, opts) {
    opts = opts || {};
    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    const monthData = DB.months[ym];
    const s = DB.settings;
    const pageLabel = opts.pageLabel || '';

    let html = `
      <div class="mk-ledger-header">
        <div class="mk-ledger-header-farm">${escapeHtml(s.farmName || 'Dairy Farm')}</div>
        <div class="mk-ledger-header-month">${escapeHtml(monthLabel(ym))}</div>
        <div class="mk-ledger-header-phone">${s.contactMobile ? escapeHtml(s.contactMobile) : ''}</div>
      </div>
      <table class="mk-ledger-table"><thead><tr><th>Date</th>`;

    buyers.forEach((b) => {
      html += `<th class="mk-col-buyer" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let d = 1; d <= numDays; d++) {
      html += `<tr><td>${d}</td>`;
      buyers.forEach((b) => {
        const entry = monthData.buyers[b.id];
        const val = entry && entry.days ? entry.days[String(d)] : undefined;
        const display = (val === undefined || val === null || val === '') ? '' : fmtNum(val);
        html += `<td>${display}</td>`;
      });
      html += '</tr>';
    }

    let farmLitres = 0, farmAmount = 0, farmNet = 0;
    const calcs = buyers.map((b) => {
      const c = calcBuyer(monthData.buyers[b.id] || { rate: 0, openingBalance: 0, adjustment: 0, days: {} });
      farmLitres += c.total;
      farmAmount += c.amount;
      farmNet += c.net;
      return c;
    });

    ledgerFooterRows().forEach((row) => {
      html += `<tr class="mk-footer-row"><td>${row.label}</td>`;
      calcs.forEach((c) => { html += `<td>${row.get(c)}</td>`; });
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += `<div class="mk-totals-bar">
      <span>Total milk: <b>${fmtNum(farmLitres)} L</b></span>
      <span>Total Amount: <b>${fmtRupee(farmAmount)}</b></span>
      <span>Total NET: <b>${fmtRupee(farmNet)}</b></span>
    </div>`;
    if (pageLabel) {
      html += `<div class="mk-ledger-page-label">${escapeHtml(pageLabel)}</div>`;
    }
    return html;
  }

  function renderLedger() {
    const ym = getSelectedYM();
    ensureMonth(ym);
    saveData(DB);

    const buyers = buyersForMonth(ym);
    const host = $('ledgerHost');

    if (!buyers.length) {
      host.innerHTML = '<div class="mk-empty">No active buyers</div>';
      return;
    }

    host.innerHTML = `<div class="mk-ledger-wrap" id="ledgerSheet">${buildLedgerInnerHtml(ym, buyers)}</div>`;
  }

  // Cached Devanagari font (base64) for vector PDF buyer names
  let pdfFontB64 = null;
  let pdfFontLoading = null;

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function loadPdfDevanagariFont() {
    if (pdfFontB64) return pdfFontB64;
    if (pdfFontLoading) return pdfFontLoading;
    pdfFontLoading = (async () => {
      const staticUrls = [
        'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf'
      ];
      let lastErr = null;
      for (let i = 0; i < staticUrls.length; i++) {
        try {
          const res = await fetch(staticUrls[i]);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          pdfFontB64 = arrayBufferToBase64(buf);
          return pdfFontB64;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Font download failed');
    })();
    try {
      return await pdfFontLoading;
    } finally {
      pdfFontLoading = null;
    }
  }

  function registerPdfFont(pdf, b64) {
    pdf.addFileToVFS('NotoSansDevanagari-Regular.ttf', b64);
    pdf.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal');
  }

  function fitPdfText(pdf, text, maxW, fontSize) {
    let s = String(text == null ? '' : text);
    if (!s) return '';
    pdf.setFont('NotoSansDevanagari', 'normal');
    pdf.setFontSize(fontSize);
    if (pdf.getTextWidth(s) <= maxW) return s;
    while (s.length > 1 && pdf.getTextWidth(s + '…') > maxW) {
      s = s.slice(0, -1);
    }
    return s + '…';
  }

  function drawLedgerVectorPdf(pdf, ym, buyers) {
    const monthData = DB.months[ym];
    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    const s = DB.settings;

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 4.5;
    const left = margin;
    const top = margin;
    const right = pageW - margin;
    const bottom = pageH - margin;
    const width = right - left;

    // Title band
    const titleH = 7.5;
    const totalsH = 5.5;
    const tableTop = top + titleH;
    const tableBottom = bottom - totalsH;
    const tableH = tableBottom - tableTop;

    // Columns: Date + equal buyer columns (all on one landscape page)
    const dateW = Math.max(11, Math.min(13, width * 0.04));
    const buyerW = (width - dateW) / Math.max(buyers.length, 1);

    // Buyer names drawn vertically so they stay legible on one page
    const nameFont = buyerW >= 12 ? 9 : buyerW >= 9 ? 8 : 7;
    pdf.setFont('NotoSansDevanagari', 'normal');
    pdf.setFontSize(nameFont);
    let longestNameW = 0;
    buyers.forEach((b) => {
      const w = pdf.getTextWidth(String(b.name || ''));
      if (w > longestNameW) longestNameW = w;
    });
    // Header row tall enough for full rotated names (+ padding)
    const nameHeaderH = Math.min(48, Math.max(24, longestNameW + 5));

    const footerCount = 5;
    const bodyRows = numDays + footerCount;
    const bodyH = tableH - nameHeaderH;
    const rowH = bodyH / bodyRows;
    const fontSize = Math.min(7.5, Math.max(4.5, rowH * 0.7));

    const calcs = buyers.map((b) =>
      calcBuyer(monthData.buyers[b.id] || { rate: 0, openingBalance: 0, adjustment: 0, days: {} })
    );
    let farmLitres = 0, farmAmount = 0, farmNet = 0;
    calcs.forEach((c) => {
      farmLitres += c.total;
      farmAmount += c.amount;
      farmNet += c.net;
    });

    pdf.setDrawColor(0);
    pdf.setTextColor(0);
    pdf.setFillColor(255, 255, 255);
    pdf.setLineWidth(0.25);

    // Title: farm | month | phone
    pdf.setFont('NotoSansDevanagari', 'normal');
    pdf.setFontSize(11);
    pdf.text(fitPdfText(pdf, s.farmName || 'Dairy Farm', width * 0.34, 11), left, top + 4.8, { align: 'left' });
    pdf.setFontSize(10);
    pdf.text(fitPdfText(pdf, monthLabel(ym), width * 0.3, 10), left + width / 2, top + 4.8, { align: 'center' });
    pdf.setFontSize(9);
    pdf.text(fitPdfText(pdf, s.contactMobile || '', width * 0.34, 9), right, top + 4.8, { align: 'right' });
    pdf.setLineWidth(0.4);
    pdf.line(left, top + titleH - 1, right, top + titleH - 1);

    function colX(i) {
      return left + dateW + i * buyerW;
    }

    function drawCellText(str, x, y, w, align, size) {
      pdf.setFont('NotoSansDevanagari', 'normal');
      pdf.setFontSize(size);
      const t = fitPdfText(pdf, str, w - 1.0, size);
      const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 0.5 : x + 0.5;
      pdf.text(t, tx, y, { align: align || 'left' });
    }

    // Table border
    pdf.setLineWidth(0.25);
    pdf.rect(left, tableTop, width, tableH);

    // Vertical grid lines
    pdf.line(left + dateW, tableTop, left + dateW, tableBottom);
    for (let i = 1; i < buyers.length; i++) {
      pdf.line(colX(i), tableTop, colX(i), tableBottom);
    }

    // Name header separator
    const nameBottom = tableTop + nameHeaderH;
    pdf.line(left, nameBottom, right, nameBottom);

    // "Date" label in name header (horizontal)
    drawCellText('Date', left, tableTop + nameHeaderH / 2 + fontSize * 0.25, dateW, 'center', Math.min(8, fontSize + 1));

    // Buyer names — vertical (90°), bottom-up, larger type, full name when possible
    pdf.setFont('NotoSansDevanagari', 'normal');
    pdf.setFontSize(nameFont);
    buyers.forEach((b, i) => {
      const name = String(b.name || '');
      const maxH = nameHeaderH - 3;
      const label = fitPdfText(pdf, name, maxH, nameFont);
      const cx = colX(i) + buyerW / 2 + nameFont * 0.12;
      const by = nameBottom - 1.5;
      // angle 90 = vertical text reading upward
      pdf.text(label, cx, by, { angle: 90, align: 'left' });
    });

    // Body rows: days then footers
    function bodyTextY(bodyRow) {
      return nameBottom + bodyRow * rowH + rowH * 0.68;
    }

    for (let d = 1; d <= numDays; d++) {
      const bodyRow = d - 1;
      pdf.line(left, nameBottom + (bodyRow + 1) * rowH, right, nameBottom + (bodyRow + 1) * rowH);
      drawCellText(String(d), left, bodyTextY(bodyRow), dateW, 'center', fontSize);
      buyers.forEach((b, i) => {
        const entry = monthData.buyers[b.id];
        const val = entry && entry.days ? entry.days[String(d)] : undefined;
        const display = (val === undefined || val === null || val === '') ? '' : fmtNum(val);
        drawCellText(display, colX(i), bodyTextY(bodyRow), buyerW, 'center', fontSize);
      });
    }

    const footers = ledgerFooterRows();
    footers.forEach((fr, fi) => {
      const bodyRow = numDays + fi;
      if (fi < footers.length - 1) {
        pdf.line(left, nameBottom + (bodyRow + 1) * rowH, right, nameBottom + (bodyRow + 1) * rowH);
      }
      drawCellText(fr.label, left, bodyTextY(bodyRow), dateW, 'center', Math.max(4.2, fontSize - 0.2));
      calcs.forEach((c, i) => {
        drawCellText(fr.get(c), colX(i), bodyTextY(bodyRow), buyerW, 'center', fontSize);
      });
    });

    // Farm totals
    pdf.setFont('NotoSansDevanagari', 'normal');
    pdf.setFontSize(8);
    const totals = 'Total milk: ' + fmtNum(farmLitres) + ' L    Total Amount: ' + fmtRupee(farmAmount) + '    Total NET: ' + fmtRupee(farmNet);
    pdf.text(fitPdfText(pdf, totals, width, 8), left, bottom - 1.2, { align: 'left' });
  }

  function bindLedger() {
    $('printLedgerBtn').addEventListener('click', () => {
      printMode = 'ledger';
      document.querySelectorAll('.mk-print-only').forEach((el) => el.classList.remove('mk-print-only'));
      const host = $('ledgerHost');
      host.classList.add('mk-print-only');
      let styleEl = $('printPageStyle');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'printPageStyle';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = '@page { size: landscape; margin: 8mm; }';
      window.print();
    });

    $('downloadLedgerPdfBtn').addEventListener('click', async () => {
      const ym = getSelectedYM();
      ensureMonth(ym);
      const buyers = buyersForMonth(ym);
      if (!buyers.length) {
        showToast('Open a month with buyers first');
        return;
      }
      const jspdfNS = window.jspdf;
      if (!jspdfNS || !jspdfNS.jsPDF) {
        showToast('PDF tools not loaded — try Print instead');
        return;
      }

      showToast('Creating PDF…');
      try {
        const b64 = await loadPdfDevanagariFont();
        const { jsPDF } = jspdfNS;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        registerPdfFont(pdf, b64);
        drawLedgerVectorPdf(pdf, ym, buyers);
        // Always exactly one landscape A4 page (vector text/lines — no images)
        pdf.save(`milk-khata-ledger-${ym}-vector-A4.pdf`);
        showToast('1-page vector PDF downloaded ✅');
      } catch (err) {
        console.error(err);
        showToast('Vector PDF failed — check internet (font load) and retry');
      }
    });
  }

  // ───────────────────────── Receipt ─────────────────────────
  let lastReceipt = null;

  function renderReceiptForm() {
    const sel = $('receiptBuyer');
    const buyers = activeBuyersSorted();
    // Also include inactive buyers that have data in selected month
    const ym = getSelectedYM();
    const monthBuyers = (DB.months[ym] && DB.months[ym].buyers) || {};
    const idsInMonth = Object.keys(monthBuyers);
    const options = [];
    const seen = new Set();

    buyers.forEach((b) => {
      options.push(b);
      seen.add(b.id);
    });
    idsInMonth.forEach((id) => {
      if (seen.has(id)) return;
      const b = DB.buyers.find((x) => x.id === id);
      if (b) options.push(b);
    });

    const prev = sel.value;
    sel.innerHTML = options.length
      ? options.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}${b.active ? '' : ' (inactive)'}</option>`).join('')
      : '<option value="">— No buyers —</option>';
    if (prev && options.some((b) => b.id === prev)) sel.value = prev;
  }

  function buildReceiptData(buyerId, ym) {
    ensureMonth(ym);
    const buyer = DB.buyers.find((b) => b.id === buyerId);
    if (!buyer) return null;
    const entry = DB.months[ym].buyers[buyerId];
    if (!entry) return null;

    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    const paddedNums = dayQtyArray(entry, numDays);
    const c = calcBuyer(entry);

    const weeks = [];
    for (let i = 0; i < paddedNums.length; i += 7) {
      const chunk = paddedNums.slice(i, i + 7);
      const startDay = i + 1;
      const endDay = i + chunk.length;
      weeks.push({
        label: 'Week ' + (weeks.length + 1),
        range: startDay + '–' + endDay,
        total: chunk.reduce((a, b) => a + b, 0),
        days: chunk.map((qty, j) => ({ date: startDay + j, qty }))
      });
    }

    // Receipt balance line = opening + adjustment (matches old single previous-balance field)
    const balance = c.opening + c.adj;
    const pay = paymentNumber();

    return {
      farmName: DB.settings.farmName.trim() || 'Dairy Farm',
      farmMobile: (DB.settings.contactMobile || '').trim(),
      paymentNumber: pay,
      tagline: DB.settings.tagline || 'जय दादा बिशादे की',
      custName: buyer.name,
      monthYear: monthLabel(ym),
      rate: c.rate,
      balance,
      weeks,
      totalMilk: c.total,
      amount: c.amount,
      grandTotal: c.net
    };
  }

  function renderReceipt(r) {
    const out = $('receiptOutput');
    const allDays = r.weeks.flatMap((w) => w.days);
    const calendarCells = allDays.map((d) => `
      <div class="mk-day">
        <span class="mk-day-num">${d.date}</span>
        <span class="mk-day-qty ${d.qty === 0 ? 'mk-day-qty--zero' : 'mk-day-qty--milk'}">${fmtNum(d.qty)}</span>
      </div>`).join('');
    const weekTotals = r.weeks.map((w) =>
      `<span><b>${w.label}</b>: ${fmtNum(w.total)} L</span>`
    ).join('');

    const payNum = r.paymentNumber || r.farmMobile;

    out.innerHTML = `
      <div class="mk-receipt" id="receiptCard">
        <div class="mk-receipt-shri">${escapeHtml(r.tagline)}</div>
        <div class="mk-receipt-farm">${escapeHtml(r.farmName)}</div>
        ${r.farmMobile ? `<div class="mk-receipt-mobile">📞 ${escapeHtml(r.farmMobile)}</div>` : ''}
        <div class="mk-receipt-divider"></div>
        <div class="mk-row mk-row--head">
          <span class="mk-row-label">Customer</span>
          <span class="mk-row-value">${escapeHtml(r.custName)}</span>
        </div>
        ${r.monthYear ? `<div class="mk-row mk-row--head"><span class="mk-row-label">Month</span><span class="mk-row-value">${escapeHtml(r.monthYear)}</span></div>` : ''}
        <div class="mk-calendar">${calendarCells}</div>
        <div class="mk-weektotals">${weekTotals}</div>
        <div class="mk-row mk-row--total-milk">
          <span class="mk-row-label">Total milk</span>
          <span class="mk-row-value">${fmtNum(r.totalMilk)} L</span>
        </div>
        <div class="mk-row">
          <span class="mk-row-label">Rate</span>
          <span class="mk-row-value">${fmtRupee(r.rate)} / L</span>
        </div>
        <div class="mk-row">
          <span class="mk-row-label">Amount</span>
          <span class="mk-row-value">${fmtRupee(r.amount)}</span>
        </div>
        ${r.balance !== 0 ? `<div class="mk-row"><span class="mk-row-label">${r.balance > 0 ? 'Previous due' : 'Previous advance'}</span><span class="mk-row-value">${fmtRupee(Math.abs(r.balance))}</span></div>` : ''}
        <div class="mk-receipt-divider"></div>
        <div class="mk-grandtotal">
          <span>Total payable</span>
          <span>${fmtRupee(r.grandTotal)}</span>
        </div>
        ${payNum ? `
        <div class="mk-upi">
          <img src="https://upload.wikimedia.org/wikipedia/commons/e/e1/UPI-Logo-vector.svg" alt="UPI Logo" class="mk-upi-logo">
          <span class="mk-upi-text">Pay via UPI to this number</span>
          <span class="mk-upi-number">${escapeHtml(payNum)}</span>
        </div>` : ''}
        <div class="mk-receipt-footer">Thank you 🙏</div>
      </div>
    `;
    $('receiptActions').style.display = 'flex';
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function bindReceipt() {
    $('generateBtn').addEventListener('click', () => {
      const buyerId = $('receiptBuyer').value;
      const ym = getSelectedYM();
      const err = $('receiptFormError');
      if (!buyerId) { err.textContent = 'Please select a buyer.'; return; }
      if (!ym) { err.textContent = 'Please select a month.'; return; }
      err.textContent = '';
      const data = buildReceiptData(buyerId, ym);
      if (!data) { err.textContent = 'No data found.'; return; }
      lastReceipt = data;
      renderReceipt(data);
    });

    $('copyBtn').addEventListener('click', () => {
      if (!lastReceipt) return;
      const r = lastReceipt;
      let msg = `🥛 *${r.farmName}*\n`;
      if (r.farmMobile) msg += `📞 ${r.farmMobile}\n`;
      msg += `👤 Customer: ${r.custName}\n`;
      msg += r.monthYear ? `📅 Month: ${r.monthYear}\n\n` : `\n`;
      r.weeks.forEach((w) => {
        msg += `${w.label} (${w.range}): ${fmtNum(w.total)} L\n`;
      });
      msg += `\nTotal milk: ${fmtNum(r.totalMilk)} L\n`;
      msg += `Rate: ${fmtRupee(r.rate)}/L\n`;
      msg += `Amount: ${fmtRupee(r.amount)}\n`;
      if (r.balance !== 0) {
        msg += `${r.balance > 0 ? 'Previous due' : 'Previous advance'}: ${fmtRupee(Math.abs(r.balance))}\n`;
      }
      msg += `━━━━━━━━━━\n`;
      msg += `✅ *Total payable: ${fmtRupee(r.grandTotal)}*\n\n`;
      msg += `Thank you 🙏`;

      navigator.clipboard.writeText(msg).then(() => {
        showToast('Copied for WhatsApp ✅');
      }).catch(() => {
        showToast('Copy failed — try again');
      });
    });

    $('printReceiptBtn').addEventListener('click', () => {
      printMode = 'receipt';
      document.querySelectorAll('.mk-print-only').forEach((el) => el.classList.remove('mk-print-only'));
      const card = $('receiptCard');
      if (!card) return;
      card.classList.add('mk-print-only');
      let styleEl = $('printPageStyle');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'printPageStyle';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = '@page { size: auto; margin: 12mm; }';
      window.print();
    });

    $('shareImgBtn').addEventListener('click', async () => {
      const card = $('receiptCard');
      if (!card || typeof html2canvas !== 'function') {
        showToast('Screenshot not available');
        return;
      }
      showToast('Creating image…');
      try {
        const canvas = await html2canvas(card, {
          backgroundColor: '#fffdf8',
          scale: 2,
          useCORS: true,
          logging: false
        });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) { showToast('Could not create image'); return; }

        const file = new File([blob], `milk-khata-${(lastReceipt && lastReceipt.custName) || 'receipt'}.png`, {
          type: 'image/png'
        });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Milk Khata receipt',
            text: lastReceipt ? `${lastReceipt.custName} — ${lastReceipt.monthYear}` : 'Receipt'
          });
          showToast('Share sheet opened ✅');
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast('PNG downloaded ✅');
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error(err);
        showToast('Share failed');
      }
    });
  }

  // ───────────────────────── Backup ─────────────────────────
  function bindBackup() {
    $('exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `milk-khata-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Backup downloaded ✅');
    });

    $('importBtn').addEventListener('click', () => $('importFile').click());

    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || !parsed.settings || !Array.isArray(parsed.buyers) || !parsed.months) {
            showToast('Invalid backup file');
            return;
          }
          if (!confirm('This will replace your current data. Continue?')) return;
          DB = parsed;
          saveData(DB);
          renderSettings();
          renderBuyers();
          renderEntry();
          renderLedger();
          renderReceiptForm();
          showToast('Import successful ✅');
        } catch (err) {
          showToast('Could not read file');
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    $('clearDataBtn').addEventListener('click', () => {
      const ok = confirm(
        'All Milk Khata data will be deleted (buyers, entries, settings).\n\n' +
        'If you have not exported a backup, press Cancel and Export first.\n\nDelete everything?'
      );
      if (!ok) return;
      const ok2 = confirm('Final confirmation: data will be permanently deleted.');
      if (!ok2) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_NAME);
        localStorage.removeItem(LEGACY_MOBILE);
        // Remove any other mk_ keys
        Object.keys(localStorage).forEach((k) => {
          if (k.indexOf('mk_') === 0) localStorage.removeItem(k);
        });
      } catch (e) { /* ignore */ }
      showToast('Data cleared — reloading…');
      setTimeout(() => { window.location.reload(); }, 400);
    });
  }

  // Clean print class after print
  window.addEventListener('afterprint', () => {
    document.querySelectorAll('.mk-print-only').forEach((el) => el.classList.remove('mk-print-only'));
    printMode = null;
  });

  // ───────────────────────── init ─────────────────────────
  function init() {
    bindMonthPickers();
    bindSettings();
    bindBuyers();
    bindEntry();
    bindLedger();
    bindReceipt();
    bindBackup();

    updateBrandSubtitle();
    renderEntry();
  }

  init();
})();
