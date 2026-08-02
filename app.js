(function () {
  'use strict';

  const STORAGE_KEY = 'mk_data_v1';
  const LEGACY_NAME = 'mk_farmName';
  const LEGACY_MOBILE = 'mk_farmMobile';

  const HINDI_MONTHS = [
    'जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
    'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'
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

  function hindiMonthLabel(ym) {
    const { year, month } = parseYearMonth(ym);
    return HINDI_MONTHS[month] + ' ' + year;
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

  // Sync month selectors
  function syncMonthInputs(ym) {
    ['entryMonth', 'ledgerMonth', 'receiptMonth'].forEach((id) => {
      const el = $(id);
      if (el && el.value !== ym) el.value = ym;
    });
  }

  function initMonthInputs() {
    const ym = currentYM();
    syncMonthInputs(ym);
    $('entryMonth').addEventListener('change', () => {
      syncMonthInputs($('entryMonth').value);
      renderEntry();
    });
    $('ledgerMonth').addEventListener('change', () => {
      syncMonthInputs($('ledgerMonth').value);
      renderLedger();
    });
    $('receiptMonth').addEventListener('change', () => {
      syncMonthInputs($('receiptMonth').value);
    });
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
    if (el) el.textContent = (DB.settings.farmName || 'दूध बिल · मासिक खाता');
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
        if (key === 'defaultRate' && $('newBuyerRate')) {
          $('newBuyerRate').value = DB.settings.defaultRate;
        }
      });
    });
  }

  // ───────────────────────── Buyers ─────────────────────────
  function renderBuyers() {
    const list = $('buyerList');
    const buyers = allBuyersSorted();
    if (!buyers.length) {
      list.innerHTML = `
        <div class="mk-empty-cta">
          <h3>अभी कोई खरीदार नहीं</h3>
          <p>ऊपर नाम और दर भरकर <b>+ जोड़ें</b> दबाएँ। उसके बाद एंट्री टैब में दूध लिख सकेंगे।</p>
        </div>`;
      return;
    }
    list.innerHTML = buyers.map((b, idx) => `
      <div class="mk-buyer-item ${b.active ? '' : 'mk-buyer-item--inactive'}" data-id="${escapeHtml(b.id)}">
        <div class="mk-buyer-info">
          <strong>${escapeHtml(b.name)}</strong>
          <span>दर ₹${fmtNum(b.defaultRate)}/ली. · ${b.active ? 'सक्रिय' : 'निष्क्रिय'}</span>
        </div>
        <div class="mk-buyer-actions">
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="down" ${idx === buyers.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="mk-btn mk-btn--ghost mk-btn--sm" data-act="edit">संपादित</button>
          <button type="button" class="mk-btn mk-btn--danger mk-btn--sm" data-act="toggle">${b.active ? 'हटाएँ' : 'वापस लाएँ'}</button>
        </div>
      </div>
    `).join('');
  }

  function reindexOrders() {
    allBuyersSorted().forEach((b, i) => { b.order = i + 1; });
  }

  function bindBuyers() {
    $('addBuyerBtn').addEventListener('click', () => {
      const name = $('newBuyerName').value.trim();
      const rate = parseFloat($('newBuyerRate').value);
      const err = $('buyerError');
      if (!name) { err.textContent = 'कृपया नाम लिखें।'; return; }
      if (!rate || rate <= 0) { err.textContent = 'कृपया सही दर लिखें।'; return; }
      err.textContent = '';
      const maxOrder = DB.buyers.reduce((m, b) => Math.max(m, b.order || 0), 0);
      DB.buyers.push({
        id: uid('b'),
        name,
        defaultRate: rate,
        active: true,
        order: maxOrder + 1
      });
      saveData(DB);
      $('newBuyerName').value = '';
      $('newBuyerRate').value = DB.settings.defaultRate || 80;
      renderBuyers();
      showToast('खरीदार जोड़ा गया ✅');
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
        showToast(buyers[idx].active ? 'खरीदार सक्रिय ✅' : 'खरीदार निष्क्रिय (इतिहास सुरक्षित)');
      }
      if (act === 'edit') {
        $('editBuyerId').value = buyers[idx].id;
        $('editBuyerName').value = buyers[idx].name;
        $('editBuyerRate').value = buyers[idx].defaultRate;
        $('buyerModal').classList.add('mk-modal-backdrop--show');
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
      const name = $('editBuyerName').value.trim();
      const rate = parseFloat($('editBuyerRate').value);
      if (!name || !rate || rate <= 0) {
        showToast('नाम और दर सही भरें');
        return;
      }
      b.name = name;
      b.defaultRate = rate;
      saveData(DB);
      $('buyerModal').classList.remove('mk-modal-backdrop--show');
      renderBuyers();
      showToast('सेव हो गया ✅');
    });
  }

  // ───────────────────────── Entry grid ─────────────────────────
  function renderEntry() {
    const ym = $('entryMonth').value || currentYM();
    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    ensureMonth(ym);
    saveData(DB);

    const buyers = buyersForMonth(ym);
    const monthData = DB.months[ym];
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDay = isCurrentMonth ? today.getDate() : null;

    // Meta cards per buyer
    const meta = $('entryMeta');
    if (!buyers.length) {
      meta.innerHTML = '';
      $('entryGridHost').innerHTML = `
        <div class="mk-empty-cta">
          <h3>दूध एंट्री शुरू करें</h3>
          <p>पहले खरीदार जोड़ें, फिर यहाँ रोज़ की मात्रा लिख सकेंगे।<br>
          सेल पर टैप करें → नंबर भरें → Enter से अगले खरीदार पर जाएँ।</p>
          <div class="mk-actions">
            <button type="button" class="mk-btn mk-btn--primary" id="goAddBuyersBtn">+ खरीदार जोड़ें</button>
          </div>
        </div>`;
      $('entryTotals').innerHTML = '';
      const goBtn = $('goAddBuyersBtn');
      if (goBtn) {
        goBtn.addEventListener('click', () => showPanel('buyers'));
      }
      return;
    }

    meta.innerHTML = buyers.map((b) => {
      const entry = monthData.buyers[b.id];
      const c = calcBuyer(entry);
      return `
        <div class="mk-meta-card" data-buyer="${escapeHtml(b.id)}">
          <h3>${escapeHtml(b.name)}</h3>
          <div class="mk-meta-row">
            <label>दर ₹</label>
            <input type="number" step="0.5" min="0" data-field="rate" inputmode="decimal" value="${fmtNum(entry.rate)}">
          </div>
          <div class="mk-meta-row">
            <label>पिछला बकाया</label>
            <input type="number" step="1" data-field="openingBalance" inputmode="decimal" value="${fmtNum(entry.openingBalance)}">
          </div>
          <div class="mk-meta-row">
            <label>समायोजन ±</label>
            <input type="number" step="1" data-field="adjustment" inputmode="decimal" value="${fmtNum(entry.adjustment)}">
          </div>
          <div class="mk-meta-row">
            <label>कुल / NET</label>
            <span class="mk-meta-net">${fmtNum(c.total)} ली · ${fmtRupee(c.net)}</span>
          </div>
        </div>`;
    }).join('');

    // Grid
    let html = '<p class="mk-entry-tip">💡 खाली सेल पर टैप करके लीटर लिखें। Enter/Tab = उसी दिन अगला खरीदार।</p>';
    html += '<div class="mk-grid-scroll"><table class="mk-entry-table"><thead><tr><th>तारीख</th>';
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

    // Footer totals
    html += '<tr class="mk-footer-row"><td>कुल</td>';
    let farmLitres = 0, farmAmount = 0, farmNet = 0;
    buyers.forEach((b) => {
      const c = calcBuyer(monthData.buyers[b.id]);
      farmLitres += c.total;
      farmAmount += c.amount;
      farmNet += c.net;
      html += `<td>${fmtNum(c.total)}</td>`;
    });
    html += '</tr></tbody></table></div>';
    $('entryGridHost').innerHTML = html;

    $('entryTotals').innerHTML =
      `<span>कुल दूध: <b>${fmtNum(farmLitres)} ली.</b></span>` +
      `<span>कुल राशि: <b>${fmtRupee(farmAmount)}</b></span>` +
      `<span>कुल NET: <b>${fmtRupee(farmNet)}</b></span>`;
  }

  function refreshEntryMetaAndFooter() {
    // Lightweight update of meta nets + footer without full re-render (keeps focus)
    const ym = $('entryMonth').value;
    const monthData = DB.months[ym];
    if (!monthData) return;
    const buyers = buyersForMonth(ym);

    document.querySelectorAll('#entryMeta .mk-meta-card').forEach((card) => {
      const id = card.dataset.buyer;
      const entry = monthData.buyers[id];
      if (!entry) return;
      const c = calcBuyer(entry);
      const netEl = card.querySelector('.mk-meta-net');
      if (netEl) netEl.textContent = `${fmtNum(c.total)} ली · ${fmtRupee(c.net)}`;
    });

    const footerCells = document.querySelectorAll('.mk-entry-table .mk-footer-row td');
    let farmLitres = 0, farmAmount = 0, farmNet = 0;
    buyers.forEach((b, i) => {
      const c = calcBuyer(monthData.buyers[b.id]);
      farmLitres += c.total;
      farmAmount += c.amount;
      farmNet += c.net;
      if (footerCells[i + 1]) footerCells[i + 1].textContent = fmtNum(c.total);
    });
    $('entryTotals').innerHTML =
      `<span>कुल दूध: <b>${fmtNum(farmLitres)} ली.</b></span>` +
      `<span>कुल राशि: <b>${fmtRupee(farmAmount)}</b></span>` +
      `<span>कुल NET: <b>${fmtRupee(farmNet)}</b></span>`;
  }

  function bindEntry() {
    $('jumpTodayBtn').addEventListener('click', () => {
      const ym = currentYM();
      syncMonthInputs(ym);
      renderEntry();
      if (!buyersForMonth(ym).length) {
        showPanel('buyers');
        showToast('पहले खरीदार जोड़ें');
        return;
      }
      const today = new Date().getDate();
      const row = $('entry-day-' + today);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = row.querySelector('input');
        if (firstInput) {
          firstInput.focus();
          firstInput.select();
        }
      }
      showToast('आज की पंक्ति तैयार — दूध लिखें');
    });

    $('entryMeta').addEventListener('input', (e) => {
      const input = e.target;
      if (!input.matches('input[data-field]')) return;
      const card = input.closest('.mk-meta-card');
      const buyerId = card.dataset.buyer;
      const ym = $('entryMonth').value;
      ensureMonth(ym);
      const field = input.dataset.field;
      DB.months[ym].buyers[buyerId][field] = input.value === '' ? 0 : parseFloat(input.value) || 0;
      saveData(DB);
      refreshEntryMetaAndFooter();
    });

    $('entryGridHost').addEventListener('input', (e) => {
      const input = e.target;
      if (!input.matches('input[data-buyer]')) return;
      const ym = $('entryMonth').value;
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
      refreshEntryMetaAndFooter();
    });

    // Enter / Tab moves to next buyer same day; at end of row → next day first buyer
    $('entryGridHost').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      const input = e.target;
      if (!input.matches('input[data-buyer]')) return;
      e.preventDefault();
      const col = parseInt(input.dataset.col, 10);
      const day = parseInt(input.dataset.day, 10);
      const ym = $('entryMonth').value;
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
  function renderLedger() {
    const ym = $('ledgerMonth').value || currentYM();
    const { year, month } = parseYearMonth(ym);
    const numDays = daysInMonth(year, month);
    ensureMonth(ym);
    saveData(DB);

    const buyers = buyersForMonth(ym);
    const monthData = DB.months[ym];
    const host = $('ledgerHost');

    if (!buyers.length) {
      host.innerHTML = '<div class="mk-empty">कोई सक्रिय खरीदार नहीं</div>';
      return;
    }

    const s = DB.settings;
    let html = `<div class="mk-ledger-wrap">
      <div class="mk-ledger-header">
        <div class="mk-receipt-shri">${escapeHtml(s.tagline || 'जय दादा बिशादे की')}</div>
        <h3>${escapeHtml(s.farmName || 'डेयरी फार्म')}</h3>
        <p>${s.contactMobile ? '📞 ' + escapeHtml(s.contactMobile) + ' · ' : ''}${escapeHtml(hindiMonthLabel(ym))}</p>
      </div>
      <table class="mk-ledger-table"><thead><tr><th>तारीख</th>`;

    buyers.forEach((b) => {
      html += `<th class="mk-col-buyer">${escapeHtml(b.name)}</th>`;
    });
    html += '</tr></thead><tbody>';

    for (let d = 1; d <= numDays; d++) {
      html += `<tr><td>${d}</td>`;
      buyers.forEach((b) => {
        const val = monthData.buyers[b.id].days[String(d)];
        const display = (val === undefined || val === null || val === '') ? '' : fmtNum(val);
        html += `<td>${display}</td>`;
      });
      html += '</tr>';
    }

    // Footer rows: Total, Rate, Amount, Balance (opening+adj), NET
    const rows = [
      { label: 'Total', get: (c) => fmtNum(c.total) },
      { label: 'Rate', get: (c) => fmtNum(c.rate) },
      { label: 'Amount', get: (c) => fmtNum(c.amount) },
      { label: 'Balance', get: (c) => {
        const bal = c.opening + c.adj;
        return bal === 0 ? '' : fmtNum(bal);
      }},
      { label: 'NET', get: (c) => fmtNum(c.net) }
    ];

    let farmLitres = 0, farmAmount = 0, farmNet = 0;
    const calcs = buyers.map((b) => {
      const c = calcBuyer(monthData.buyers[b.id]);
      farmLitres += c.total;
      farmAmount += c.amount;
      farmNet += c.net;
      return c;
    });

    rows.forEach((row) => {
      html += `<tr class="mk-footer-row"><td>${row.label}</td>`;
      calcs.forEach((c) => { html += `<td>${row.get(c)}</td>`; });
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += `<div class="mk-totals-bar" style="margin-top:10px;">
      <span>कुल दूध: <b>${fmtNum(farmLitres)} ली.</b></span>
      <span>कुल Amount: <b>${fmtRupee(farmAmount)}</b></span>
      <span>कुल NET: <b>${fmtRupee(farmNet)}</b></span>
    </div></div>`;

    host.innerHTML = html;
  }

  function bindLedger() {
    $('printLedgerBtn').addEventListener('click', () => {
      printMode = 'ledger';
      // Mark ledger for print visibility
      document.querySelectorAll('.mk-print-only').forEach((el) => el.classList.remove('mk-print-only'));
      const host = $('ledgerHost');
      host.classList.add('mk-print-only');
      // Inject landscape page style
      let styleEl = $('printPageStyle');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'printPageStyle';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = '@page { size: landscape; margin: 8mm; }';
      window.print();
    });
  }

  // ───────────────────────── Receipt ─────────────────────────
  let lastReceipt = null;

  function renderReceiptForm() {
    const sel = $('receiptBuyer');
    const buyers = activeBuyersSorted();
    // Also include inactive buyers that have data in selected month
    const ym = $('receiptMonth').value || currentYM();
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
      ? options.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}${b.active ? '' : ' (निष्क्रिय)'}</option>`).join('')
      : '<option value="">— कोई खरीदार नहीं —</option>';
    if (prev && options.some((b) => b.id === prev)) sel.value = prev;

    if (!$('newBuyerRate').dataset.init) {
      $('newBuyerRate').value = DB.settings.defaultRate || 80;
      $('newBuyerRate').dataset.init = '1';
    }
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
        label: 'सप्ताह ' + (weeks.length + 1),
        range: startDay + '–' + endDay,
        total: chunk.reduce((a, b) => a + b, 0),
        days: chunk.map((qty, j) => ({ date: startDay + j, qty }))
      });
    }

    // Receipt balance line = opening + adjustment (matches old single "पिछला बकाया" field)
    const balance = c.opening + c.adj;
    const pay = paymentNumber();

    return {
      farmName: DB.settings.farmName.trim() || 'डेयरी फार्म',
      farmMobile: (DB.settings.contactMobile || '').trim(),
      paymentNumber: pay,
      tagline: DB.settings.tagline || 'जय दादा बिशादे की',
      custName: buyer.name,
      monthYear: hindiMonthLabel(ym),
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
      `<span><b>${w.label}</b>: ${fmtNum(w.total)} ली.</span>`
    ).join('');

    const payNum = r.paymentNumber || r.farmMobile;

    out.innerHTML = `
      <div class="mk-receipt" id="receiptCard">
        <div class="mk-receipt-shri">${escapeHtml(r.tagline)}</div>
        <div class="mk-receipt-farm">${escapeHtml(r.farmName)}</div>
        ${r.farmMobile ? `<div class="mk-receipt-mobile">📞 ${escapeHtml(r.farmMobile)}</div>` : ''}
        <div class="mk-receipt-divider"></div>
        <div class="mk-row mk-row--head">
          <span class="mk-row-label">ग्राहक</span>
          <span class="mk-row-value">${escapeHtml(r.custName)}</span>
        </div>
        ${r.monthYear ? `<div class="mk-row mk-row--head"><span class="mk-row-label">महीना</span><span class="mk-row-value">${escapeHtml(r.monthYear)}</span></div>` : ''}
        <div class="mk-calendar">${calendarCells}</div>
        <div class="mk-weektotals">${weekTotals}</div>
        <div class="mk-row mk-row--total-milk">
          <span class="mk-row-label">कुल दूध</span>
          <span class="mk-row-value">${fmtNum(r.totalMilk)} ली.</span>
        </div>
        <div class="mk-row">
          <span class="mk-row-label">दर</span>
          <span class="mk-row-value">${fmtRupee(r.rate)} / ली.</span>
        </div>
        <div class="mk-row">
          <span class="mk-row-label">राशि</span>
          <span class="mk-row-value">${fmtRupee(r.amount)}</span>
        </div>
        ${r.balance !== 0 ? `<div class="mk-row"><span class="mk-row-label">${r.balance > 0 ? 'पिछला बकाया' : 'पिछला एडवांस'}</span><span class="mk-row-value">${fmtRupee(Math.abs(r.balance))}</span></div>` : ''}
        <div class="mk-receipt-divider"></div>
        <div class="mk-grandtotal">
          <span>कुल देय राशि</span>
          <span>${fmtRupee(r.grandTotal)}</span>
        </div>
        ${payNum ? `
        <div class="mk-upi">
          <img src="https://upload.wikimedia.org/wikipedia/commons/e/e1/UPI-Logo-vector.svg" alt="UPI Logo" class="mk-upi-logo">
          <span class="mk-upi-text">इस नंबर पर UPI पेमेंट कर सकते हैं</span>
          <span class="mk-upi-number">${escapeHtml(payNum)}</span>
        </div>` : ''}
        <div class="mk-receipt-footer">धन्यवाद 🙏</div>
      </div>
    `;
    $('receiptActions').style.display = 'flex';
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function bindReceipt() {
    $('generateBtn').addEventListener('click', () => {
      const buyerId = $('receiptBuyer').value;
      const ym = $('receiptMonth').value;
      const err = $('receiptFormError');
      if (!buyerId) { err.textContent = 'कृपया खरीदार चुनें।'; return; }
      if (!ym) { err.textContent = 'कृपया महीना चुनें।'; return; }
      err.textContent = '';
      const data = buildReceiptData(buyerId, ym);
      if (!data) { err.textContent = 'डेटा नहीं मिला।'; return; }
      lastReceipt = data;
      renderReceipt(data);
    });

    $('copyBtn').addEventListener('click', () => {
      if (!lastReceipt) return;
      const r = lastReceipt;
      let msg = `🥛 *${r.farmName}*\n`;
      if (r.farmMobile) msg += `📞 ${r.farmMobile}\n`;
      msg += `👤 ग्राहक: ${r.custName}\n`;
      msg += r.monthYear ? `📅 महीना: ${r.monthYear}\n\n` : `\n`;
      r.weeks.forEach((w) => {
        msg += `${w.label} (${w.range} तारीख): ${fmtNum(w.total)} ली.\n`;
      });
      msg += `\nकुल दूध: ${fmtNum(r.totalMilk)} ली.\n`;
      msg += `दर: ${fmtRupee(r.rate)}/ली.\n`;
      msg += `राशि: ${fmtRupee(r.amount)}\n`;
      if (r.balance !== 0) {
        msg += `${r.balance > 0 ? 'पिछला बकाया' : 'पिछला एडवांस'}: ${fmtRupee(Math.abs(r.balance))}\n`;
      }
      msg += `━━━━━━━━━━\n`;
      msg += `✅ *कुल देय राशि: ${fmtRupee(r.grandTotal)}*\n\n`;
      msg += `धन्यवाद 🙏`;

      navigator.clipboard.writeText(msg).then(() => {
        showToast('WhatsApp के लिए कॉपी हो गया ✅');
      }).catch(() => {
        showToast('कॉपी नहीं हो पाया — दोबारा कोशिश करें');
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
        showToast('स्क्रीनशॉट उपलब्ध नहीं');
        return;
      }
      showToast('छवि बन रही है…');
      try {
        const canvas = await html2canvas(card, {
          backgroundColor: '#fffdf8',
          scale: 2,
          useCORS: true,
          logging: false
        });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) { showToast('छवि नहीं बनी'); return; }

        const file = new File([blob], `milk-khata-${(lastReceipt && lastReceipt.custName) || 'receipt'}.png`, {
          type: 'image/png'
        });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Milk Khata रसीद',
            text: lastReceipt ? `${lastReceipt.custName} — ${lastReceipt.monthYear}` : 'रसीद'
          });
          showToast('शेयर शीट खोली गई ✅');
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast('PNG डाउनलोड हो गया ✅');
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error(err);
        showToast('शेयर नहीं हो पाया');
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
      showToast('बैकअप डाउनलोड हो गया ✅');
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
            showToast('अमान्य बैकअप फ़ाइल');
            return;
          }
          if (!confirm('मौजूदा डेटा बदल जाएगा। जारी रखें?')) return;
          DB = parsed;
          saveData(DB);
          renderSettings();
          renderBuyers();
          renderEntry();
          renderLedger();
          renderReceiptForm();
          showToast('इम्पोर्ट सफल ✅');
        } catch (err) {
          showToast('फ़ाइल पढ़ नहीं पाए');
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });
  }

  // Clean print class after print
  window.addEventListener('afterprint', () => {
    document.querySelectorAll('.mk-print-only').forEach((el) => el.classList.remove('mk-print-only'));
    printMode = null;
  });

  // ───────────────────────── init ─────────────────────────
  function init() {
    initMonthInputs();
    bindSettings();
    bindBuyers();
    bindEntry();
    bindLedger();
    bindReceipt();
    bindBackup();

    $('newBuyerRate').value = DB.settings.defaultRate || 80;
    updateBrandSubtitle();
    renderEntry();
  }

  init();
})();
