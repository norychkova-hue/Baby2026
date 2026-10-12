// Сонный помощник — Mini App. Без сборки и библиотек.
(() => {
  const tg = window.Telegram?.WebApp;
  const $ = (id) => document.getElementById(id);
  const MIN = 60000;

  // ── оформление под Telegram ──
  if (tg) {
    tg.ready();
    tg.expand();
    document.documentElement.dataset.theme = tg.colorScheme === 'dark' ? 'dark' : 'light';
    tg.onEvent?.('themeChanged', () => { document.documentElement.dataset.theme = tg.colorScheme === 'dark' ? 'dark' : 'light'; });
  }
  const haptic = (t = 'light') => { try { tg?.HapticFeedback?.impactOccurred(t); } catch {} };

  // ── форматирование: всегда в часовом поясе из настроек бота (TZ), а не телефона ──
  let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let fmt = null;
  const parts = (ms) => {
    if (!fmt || fmt.tz !== TZ) {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      fmt.tz = TZ;
    }
    const o = {};
    for (const p of fmt.formatToParts(ms)) o[p.type] = Number(p.value);
    return o;
  };
  const offset = (ms) => { const p = parts(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
  const wall = (y, m, d, h = 0, mi = 0) => { const g = Date.UTC(y, m - 1, d, h, mi); return g - offset(g - offset(g)); };
  const hm = (ms) => { const p = parts(ms); return `${p.hour}:${String(p.minute).padStart(2, '0')}`; };
  const dur = (m) => { m = Math.max(0, Math.round(m)); if (m < 60) return `${m} мин`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} ч ${r} мин` : `${h} ч`; };
  const short = (m) => { m = Math.round(m); return m < 60 ? `${m}м` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const plural = (n, [a, b, c]) => { const x = n % 100, y = n % 10; if (x > 10 && x < 20) return c; if (y === 1) return a; if (y >= 2 && y <= 4) return b; return c; };
  const startOfDay = (ms) => { const p = parts(ms); return wall(p.year, p.month, p.day); };
  const toDateInput = (ms) => { const p = parts(ms); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
  const toTimeInput = (ms) => { const p = parts(ms); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  const fromDateInput = (v, time = '12:00') => { if (!v) return null; const [y, m, d] = v.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return wall(y, m, d, h, mi); };
  const kg = (g) => `${g.toLocaleString('ru-RU')} г`;

  // ── сервер ──
  async function api(path, body) {
    const res = await fetch(`api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-init-data': tg?.initData || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Нет связи с сервером. Попробуйте ещё раз.');
    return json;
  }

  let S = null; // состояние с сервера
  let skew = 0; // разница часов телефона и сервера
  const now = () => Date.now() + skew;

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function refresh() {
    try {
      S = await api('state');
      if (S.tz) TZ = S.tz;
      if (S.now) skew = S.now - Date.now();
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  // ── экраны ──
  function go(view) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `v-${view}`;
    if (tg?.BackButton) view === 'main' ? tg.BackButton.hide() : tg.BackButton.show();
    if (view === 'report') loadReport(-1);
    if (view === 'settings') fillSettings();
    window.scrollTo(0, 0);
  }
  tg?.BackButton?.onClick(() => { closeSheets(); go('main'); });
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  // ── главный экран ──
  const C = 2 * Math.PI * 94;
  $('prog').style.strokeDasharray = C;

  function render() {
    if (!S) return;
    if (S.needsProfile) {
      go('settings');
      $('setTitle').textContent = 'Давайте познакомимся';
      $('setBack').hidden = true;
      return;
    }
    $('setBack').hidden = false;
    if ($('v-settings').hidden && $('v-report').hidden) go('main');
    const t = now();
    const name = S.profile.name ? `${S.profile.name} · ` : '';
    $('age').textContent = `${name}${S.age.label}`;

    // что сейчас
    let headline = S.headline;
    let elapsed = 0;
    if (S.state !== 'none') {
      elapsed = (t - S.since) / MIN;
      headline = S.state === 'asleep' ? `${S.kind === 'night' ? 'Ночь · спит' : 'Спит'} ${dur(elapsed)}` : `Не спит ${dur(elapsed)}`;
    }
    $('state').innerHTML = `<div class="now"></div><div class="next"></div><div class="why"></div>`;
    $('state').children[0].textContent = headline;
    $('state').children[1].textContent = S.next || '';
    $('state').children[2].textContent = S.why || '';
    $('note').hidden = !S.note;
    $('note').textContent = S.note || '';
    $('leap').hidden = !S.leap;
    $('leap').textContent = S.leap?.text || '';

    // круг и кольцо
    const asleep = S.state === 'asleep';
    $('circle').innerHTML = asleep ? '<span class="ic">☀️</span>Проснулся' : '<span class="ic">😴</span>Уснул';
    $('circle').style.setProperty('--c', asleep ? 'var(--awake)' : 'var(--sleep)');
    if (S.ring) {
      const total = S.ring.total || 1;
      $('prog').style.setProperty('--k', asleep ? 'var(--sleep)' : 'var(--awake)');
      $('prog').style.strokeDashoffset = C * (1 - Math.min(1, elapsed / total));
      $('ringnote').textContent = asleep ? `Кольцо — сон: ${dur(elapsed)} из ${dur(total)}` : `Кольцо — бодрствование: ${dur(elapsed)} из ${dur(total)}`;
    } else {
      $('prog').style.strokeDashoffset = C;
      $('ringnote').textContent = '';
    }
    $('feedBtn').hidden = !S.settings.feedings;
    if (S.lastFeeding && S.settings.feedings) $('feedBtn').textContent = `🤱 Кормление · было в ${hm(S.lastFeeding.at)}`;

    // сны сегодня
    const naps = S.today.naps;
    const n = naps.length;
    const total = naps.reduce((a, x) => a + (x.end ? x.min : (t - x.start) / MIN), 0);
    $('napsTitle').textContent = n ? `Сегодня ${n} ${plural(n, ['сон', 'сна', 'снов'])} · ${dur(total)}` : 'Сегодня снов пока не было';
    const [lo, hi] = S.today.expectedNaps;
    $('napsNorm').textContent = `норма ${lo === hi ? lo : `${lo}–${hi}`} ${plural(hi, ['сон', 'сна', 'снов'])}`;
    const box = $('naps');
    box.innerHTML = '';
    naps.forEach((x, i) => {
      const live = !x.end;
      const b = document.createElement(live ? 'span' : 'button');
      b.className = 'nap';
      if (live) { b.style.opacity = '.55'; b.style.cursor = 'default'; }
      else { b.type = 'button'; b.setAttribute('aria-label', `Сон ${hm(x.start)}–${hm(x.end)}, поправить`); b.onclick = () => openEdit(x); }
      b.textContent = short(live ? (t - x.start) / MIN : x.min);
      box.append(b);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'nap add'; add.textContent = '＋'; add.setAttribute('aria-label', 'Добавить забытый сон');
    add.onclick = () => openEdit(null);
    box.append(add);
    for (let i = n + 1; i < lo; i++) { const e = document.createElement('span'); e.className = 'nap empty'; e.textContent = 'ещё'; box.append(e); }

    // ночь
    const ln = S.lastNight;
    $('nightLine').innerHTML = ln ? `Ночь: <b>${dur(ln.sleepMin)}</b> · ${hm(ln.start)}–${hm(ln.end)} · просыпался ${ln.wakes} ${plural(ln.wakes, ['раз', 'раза', 'раз'])}` : 'Ночь ещё не записана.';
    $('nightCard').hidden = !S.nightForm;
    if (S.nightForm) $('nightCardText').textContent = S.nightForm.fromTaps ? `${hm(S.nightForm.start)}–${hm(S.nightForm.end)} — проверьте и сколько раз просыпался` : 'Отметьте одной записью — это 10 секунд';
  }

  // ── шторки ──
  function openSheet(id) {
    closeSheets();
    $('backdrop').hidden = false;
    $(id).hidden = false;
  }
  function closeSheets() {
    for (const s of document.querySelectorAll('.sheet.pop')) s.hidden = true;
    $('backdrop').hidden = true;
  }
  $('backdrop').addEventListener('click', () => { if (!$('sheetWhen').hidden) return whenDone(); closeSheets(); });

  // ── круг: «Уснул / Проснулся» + бегунок «когда» ──
  let last = null; // { kind: 'sleep'|'feed', action, id, base }
  $('circle').addEventListener('click', async () => {
    $('circle').disabled = true;
    try {
      const r = await api('toggle', { at: now() });
      haptic('medium');
      last = { kind: 'sleep', action: r.action, id: r.id, base: r.at };
      $('whenTitle').textContent = r.action === 'sleep' ? 'Уснул' : 'Проснулся';
      $('whenSide').hidden = true;
      setWhen(0);
      openSheet('sheetWhen');
      refresh();
    } catch (e) { toast(e.message); }
    $('circle').disabled = false;
  });

  $('feedBtn').addEventListener('click', async () => {
    try {
      const r = await api('feeding', { at: now() });
      last = { kind: 'feed', id: r.id, base: now() };
      $('whenTitle').textContent = 'Кормление';
      $('whenSide').hidden = false;
      $('whenSide').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      setWhen(0);
      openSheet('sheetWhen');
      refresh();
    } catch (e) { toast(e.message); }
  });

  function setWhen(m) {
    $('whenShift').value = m;
    $('whenTime').textContent = hm(last.base - m * MIN);
    $('whenAgo').textContent = m ? `${dur(m)} назад` : 'сейчас';
  }
  $('whenShift').addEventListener('input', (e) => setWhen(Number(e.target.value)));
  let shiftTimer;
  $('whenShift').addEventListener('change', () => {
    clearTimeout(shiftTimer);
    shiftTimer = setTimeout(applyShift, 150);
  });
  async function applyShift() {
    if (!last || last.kind !== 'sleep') return;
    try {
      await api('shift', { action: last.action, id: last.id, minutesAgo: Number($('whenShift').value), base: last.base });
      await refresh();
    } catch (e) { toast(e.message); }
  }
  async function whenDone() {
    try {
      if (last?.kind === 'sleep') await applyShift();
      if (last?.kind === 'feed') {
        const side = $('whenSide').querySelector('[aria-pressed="true"]')?.dataset.side ?? null;
        await api('feeding/update', { id: last.id, at: last.base - Number($('whenShift').value) * MIN, side });
        refresh();
      }
    } catch (e) { toast(e.message); }
    closeSheets();
    last = null;
  }
  $('whenDone').addEventListener('click', whenDone);
  $('whenUndo').addEventListener('click', async () => {
    try {
      if (last?.kind === 'sleep') await api('undo', { action: last.action, id: last.id });
      if (last?.kind === 'feed') await api('feeding/delete', { id: last.id });
      toast('Отменено');
    } catch (e) { toast(e.message); }
    closeSheets();
    last = null;
    refresh();
  });
  $('whenSide').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    $('whenSide').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', String(on));
  }));

  // ── поправить / добавить сон ──
  let edit = null; // { ids, base, max }
  function openEdit(nap) {
    const t = now();
    const start = nap ? nap.start : Math.round((t - 60 * MIN) / (5 * MIN)) * 5 * MIN;
    const end = nap ? nap.end : start + 30 * MIN;
    const base = Math.floor((start - 120 * MIN) / (30 * MIN)) * 30 * MIN;
    const top = Math.min(Math.ceil((end + 120 * MIN) / (30 * MIN)) * 30 * MIN, Math.ceil(t / (5 * MIN)) * 5 * MIN);
    edit = { ids: nap ? nap.ids : [], base, max: Math.round((top - base) / (5 * MIN)) };
    $('editTitle').textContent = nap ? 'Поправить сон' : 'Добавить забытый сон';
    $('editDel').hidden = !nap;
    for (const id of ['editA', 'editB']) $(id).max = edit.max;
    $('editA').value = Math.round((start - base) / (5 * MIN));
    $('editB').value = Math.min(edit.max, Math.round((end - base) / (5 * MIN)));
    $('editScale').innerHTML = [0, 0.5, 1].map((k) => `<span>${hm(base + Math.round(edit.max * k) * 5 * MIN)}</span>`).join('');
    $('editErr').hidden = true;
    drawEdit();
    openSheet('sheetEdit');
  }
  function drawEdit(e) {
    let a = Number($('editA').value), b = Number($('editB').value);
    if (a > b - 1) { if (e?.target === $('editA')) a = b - 1; else b = a + 1; $('editA').value = a; $('editB').value = b; }
    const s = edit.base + a * 5 * MIN, f = edit.base + b * 5 * MIN;
    $('editFrom').textContent = hm(s); $('editTo').textContent = hm(f); $('editDur').textContent = dur((f - s) / MIN);
    $('editBand').style.left = `${(a / edit.max) * 100}%`; $('editBand').style.width = `${((b - a) / edit.max) * 100}%`;
  }
  $('editA').addEventListener('input', drawEdit);
  $('editB').addEventListener('input', drawEdit);
  $('editSave').addEventListener('click', async () => {
    try {
      await api('sleep', { ids: edit.ids, start: edit.base + Number($('editA').value) * 5 * MIN, end: edit.base + Number($('editB').value) * 5 * MIN });
      haptic(); closeSheets(); toast('Сохранено'); refresh();
    } catch (e) { $('editErr').textContent = e.message; $('editErr').hidden = false; }
  });
  $('editDel').addEventListener('click', async () => {
    try { await api('sleep/delete', { ids: edit.ids }); closeSheets(); toast('Сон удалён'); refresh(); } catch (e) { toast(e.message); }
  });
  $('editCancel').addEventListener('click', closeSheets);

  // ── ночь одной записью ──
  let nb = 0;
  const pick = (box, v) => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  const picked = (box) => Number(box.querySelector('[aria-pressed="true"]')?.dataset.v ?? 0);
  ['nWakes', 'nLong'].forEach((id) => $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pick($(id), b.dataset.v))));
  $('nightOpen').addEventListener('click', () => {
    const f = S.nightForm;
    nb = startOfDay(fromDateInput(f.date)) - 6 * 60 * MIN; // 18:00 вчера
    $('nA').value = Math.round((f.start - nb) / (5 * MIN));
    $('nB').value = Math.round((f.end - nb) / (5 * MIN));
    pick($('nWakes'), Math.min(3, f.wakes));
    pick($('nLong'), f.longWake ? 1 : 0);
    $('nErr').hidden = true;
    drawNight();
    openSheet('sheetNight');
  });
  function drawNight(e) {
    let a = Number($('nA').value), b = Number($('nB').value);
    if (a > b - 6) { if (e?.target === $('nA')) a = b - 6; else b = a + 6; $('nA').value = a; $('nB').value = b; }
    $('nFrom').textContent = hm(nb + a * 5 * MIN); $('nTo').textContent = hm(nb + b * 5 * MIN);
    $('nBand').style.left = `${(a / 216) * 100}%`; $('nBand').style.width = `${((b - a) / 216) * 100}%`;
  }
  $('nA').addEventListener('input', drawNight);
  $('nB').addEventListener('input', drawNight);
  $('nSave').addEventListener('click', async () => {
    try {
      await api('night', { start: nb + Number($('nA').value) * 5 * MIN, end: nb + Number($('nB').value) * 5 * MIN, wakes: picked($('nWakes')), longWake: picked($('nLong')) === 1, ids: S.nightForm.ids });
      haptic(); closeSheets(); toast('Ночь записана'); refresh();
    } catch (e) { $('nErr').textContent = e.message; $('nErr').hidden = false; }
  });
  $('nSkip').addEventListener('click', async () => { closeSheets(); await api('night/skip', {}).catch(() => {}); refresh(); });

  // ── вес ──
  let wRef = 0;
  $('weightOpen').addEventListener('click', () => {
    wRef = S.lastWeight?.grams ?? S.profile.birthWeight ?? 3500;
    $('w').min = wRef - 300; $('w').max = wRef + 300; $('w').value = wRef;
    $('wScale').innerHTML = `<span>−300 г</span><span>${S.lastWeight ? 'прошлый' : 'при рождении'} ${kg(wRef)}</span><span>+300 г</span>`;
    drawWeight();
    openSheet('sheetWeight');
  });
  function drawWeight() {
    const g = Number($('w').value), d = g - wRef;
    $('wVal').textContent = kg(g);
    $('wDiff').textContent = d === 0 ? 'двигайте бегунок или ±' : `${d > 0 ? '+' : '−'}${Math.abs(d)} г`;
  }
  $('w').addEventListener('input', drawWeight);
  $('wMinus').addEventListener('click', () => { $('w').value = Number($('w').value) - 10; drawWeight(); });
  $('wPlus').addEventListener('click', () => { $('w').value = Number($('w').value) + 10; drawWeight(); });
  $('wSave').addEventListener('click', async () => {
    try { await api('weight', { grams: Number($('w').value) }); haptic(); closeSheets(); toast('Вес записан'); refresh(); } catch (e) { toast(e.message); }
  });
  $('wCancel').addEventListener('click', closeSheets);

  // ── отчёт ──
  async function loadReport(offset) {
    $('repPrev').setAttribute('aria-pressed', String(offset === -1));
    $('repCur').setAttribute('aria-pressed', String(offset === 0));
    try {
      const r = await api(`report?offset=${offset}`);
      $('repTitle').textContent = `Неделя ${r.label}`;
      $('repSub').textContent = `${r.weekOfLife}-я неделя жизни`;
      $('repHead').textContent = r.title;
      $('repSummary').textContent = r.summary;
      $('repVerdict').classList.toggle('warn', !r.enough || r.title === 'Есть над чем поработать');
      $('repRows').innerHTML = '';
      for (const row of r.rows) {
        const el = document.createElement('div');
        el.className = 'r';
        el.innerHTML = '<span class="k"></span><span class="v"></span><span class="n"><span class="nt"></span> <span class="mark"></span></span><span class="t"></span>';
        el.querySelector('.k').textContent = row.label;
        el.querySelector('.v').textContent = row.valueText;
        el.querySelector('.nt').textContent = row.normText;
        const mk = el.querySelector('.mark');
        mk.textContent = row.markText;
        mk.className = `mark ${row.mark === 'ok' ? 'ok' : row.mark === 'none' ? 'none' : 'lo'}`;
        if (row.prevText) { const t = el.querySelector('.t'); t.textContent = row.prevText; if (row.trend === 'up' || row.trend === 'down') t.classList.add(row.trend); }
        $('repRows').append(el);
      }
      $('repStep').innerHTML = '<b>На следующую неделю:</b> ';
      $('repStep').append(r.step);
      $('repSrc').textContent = `Нормы — таблица из гайда, возраст ${r.normLabel}. Учтено полных суток: ${r.days} из 7.${r.leap ? ' ' + r.leap : ''}`;
    } catch (e) { toast(e.message); }
  }
  $('repPrev').addEventListener('click', () => loadReport(-1));
  $('repCur').addEventListener('click', () => loadReport(0));

  // ── настройки ──
  function fillSettings() {
    const p = S?.profile;
    $('pName').value = p?.name || '';
    $('pBirth').value = p ? toDateInput(p.birth) : '';
    $('pBirthTime').value = p ? toTimeInput(p.birth) : '12:00';
    $('pDue').value = p?.due ? toDateInput(p.due) : '';
    $('pWeight').value = p?.birthWeight || '';
    $('sFeed').checked = Boolean(S?.settings?.feedings);
    $('setErr').hidden = true;
  }
  $('setSave').addEventListener('click', async () => {
    try {
      await api('profile', {
        name: $('pName').value,
        birth: fromDateInput($('pBirth').value, $('pBirthTime').value || '12:00'),
        due: fromDateInput($('pDue').value, '00:00'),
        birthWeight: $('pWeight').value ? Number($('pWeight').value) : null,
      });
      await api('settings', { feedings: $('sFeed').checked });
      haptic(); toast('Сохранено');
      await refresh();
      go('main');
    } catch (e) { $('setErr').textContent = e.message; $('setErr').hidden = false; }
  });

  // ── старт ──
  const hash = location.hash.slice(1);
  refresh().then(() => {
    if (hash === 'profile') go('settings');
    if (hash.startsWith('report')) go('report');
  });
  setInterval(render, 30 * 1000);
  setInterval(refresh, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
