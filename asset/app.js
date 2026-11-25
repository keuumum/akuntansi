// ====== Aplikasi HP Inventarisasi UPKL: login, tab, cari, progres, detail, pemindai ======
// Memakai fungsi form (doLookup, setPetugas, esc, $ …) yang sudah dimuat di index.html.
(function () {
  const APP_VERSION = '1.4';
  // indeks kolom data aset (lihat dataAset() di Code.gs)
  const C = 0, A = 1, S = 2, D = 3, L = 4, Q = 5, B = 6, CC = 7, T = 8, K = 9, QF = 10, P = 11, N = 12, U = 13, TP = 14, LC = 15;
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} }
  };
  let data = null, view = 'inven', loading = false;

  // ---------- util ----------
  let toastT = 0;
  function toast(t, ms) {
    const el = $('toast'); el.textContent = t; el.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), ms || 2600);
  }
  const pad = n => String(n).padStart(2, '0');
  function tgl(ms, jam) {
    if (!ms) return '';
    const d = new Date(ms);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (jam ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '/' + d.getFullYear());
  }
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
  const nrm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const keyCode = s => { s = String(s || '').replace(/\s+/g, '').toUpperCase(); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };

  // ---------- data aset (disimpan di HP, diperbarui dari server) ----------
  function loadCache() {
    try { const j = JSON.parse(LS.get('inv-data', 'null')); if (j && Array.isArray(j.items)) data = j; } catch (e) {}
  }
  async function loadData(force) {
    if (loading) return;
    if (!force && data && Date.now() - (data.ambil || 0) < 5 * 60 * 1000) { renderActive(); return; }
    loading = true; setInfo('Memuat data aset…');
    try {
      const r = await APP.call('dataAset');
      r.ambil = Date.now(); data = r;
      LS.set('inv-data', JSON.stringify(r));
      if (force) toast('Data diperbarui');
    } catch (e) {
      if (e.offline) toast(data ? 'Offline – memakai data tersimpan di HP' : 'Offline – data aset belum pernah dimuat. Sambungkan internet sekali dulu.', 4000);
      else toast(data ? 'Gagal memperbarui, memakai data tersimpan. ' + e.message : 'Gagal memuat data: ' + e.message, 4500);
    }
    loading = false; renderActive();
  }
  function setInfo(t) { $('cariInfo').textContent = t; $('progInfo').textContent = t; }
  function dataTime() { return data ? 'Data per ' + tgl(data.ambil || data.waktu, true) : 'Belum ada data'; }
  function findItem(code) { if (!data) return null; const k = keyCode(code); return data.items.find(x => keyCode(x[C]) === k) || null; }
  // dipanggil form setelah simpan berhasil -> status langsung SUDAH tanpa menunggu muat ulang
  window.onInvenSaved = function (code, form) {
    const it = findItem(code);
    if (it) {
      it[T] = Date.now(); it[K] = form.kondisi; it[QF] = form.qty; it[P] = form.petugas + (form.petugasNon ? ' (non-pegawai)' : ''); it[N] = (it[N] || 0) + 1;
      LS.set('inv-data', JSON.stringify(data));
    }
    if (APP.lastQueued) {
      APP.lastQueued = false;
      setTimeout(() => {
        const el = $('lookupMsg'); el.className = 'msg warn';
        el.textContent = '📥 Disimpan di HP (tanpa sinyal). Akan terkirim & dicek AI otomatis saat ada sinyal. Scan aset berikutnya.';
      }, 0);
      updateQueueUi();
    }
  };

  // ---------- tab ----------
  function go(v) {
    view = v;
    TABS.forEach(x => $('view' + x[0].toUpperCase() + x.slice(1)).classList.toggle('hidden', x !== v));
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    LS.set('inv-tab', v);
    window.scrollTo(0, 0);
    if (v !== 'inven' && v !== 'attb') { renderActive(); if (APP.pin()) loadData(false); }
  }
  const TABS = ['home', 'cari', 'attb', 'inven', 'progres'];
  function renderActive() { if (view === 'cari') renderCari(); else if (view === 'progres') renderProgres(); else if (view === 'home') renderHome(); }

  // ---------- HOME ----------
  function sapa() { const h = new Date().getHours(); return h < 11 ? 'Selamat pagi,' : h < 15 ? 'Selamat siang,' : h < 18 ? 'Selamat sore,' : 'Selamat malam,'; }
  function recentList() { try { const a = JSON.parse(LS.get('inv-recent', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function addRecent(code) { const a = recentList().filter(c => keyCode(c) !== keyCode(code)); a.unshift(code); LS.set('inv-recent', JSON.stringify(a.slice(0, 10))); }
  function renderHome() {
    setTimeout(() => { try { hLayout(); } catch (e) {} }, 0);
    $('hHi').textContent = sapa();
    $('hName').textContent = (typeof petugasNama === 'string' && petugasNama) ? petugasNama : 'Petugas Inventaris';
    if (data) {
      const lok = {}; let sud = 0;
      data.items.forEach(x => { lok[x[L]] = 1; if (x[T]) sud++; });
      HO[0].i = 'Ada ' + data.items.length.toLocaleString('id-ID') + ' aset di ' + Object.keys(lok).length + ' lokasi: foto, PDF, riwayat inven. Ketuk mesinnya!';
      $('hPct').textContent = String(pct(sud, data.items.length)).replace('.', ',') + '%';
    }
    const rc = recentList().slice(0, 3).map(c => findItem(c) || [c, '', '', c, '', '', '', '', 0]);
    $('hRecent').innerHTML = rc.length ? rc.map(x =>
      '<div class="it" data-c="' + esc(x[C]) + '"><div class="m"><b>' + esc(x[D] || x[C]) + '</b><small>' + esc((x[A] ? x[A] + '-' + x[S] + ' · ' : '') + (x[L] || '')) + '</small></div>' +
      (x[T] ? '<span class="badge ok">SUDAH</span>' : '<span class="badge no">BELUM</span>') + '</div>').join('')
      : '<div class="empty">Belum ada. Aset yang Anda buka di Bank Data akan muncul di sini.</div>';
  }
  // ---------- HOME ANIMASI: petugas berjalan mengikuti kursor / ke objek ----------
  const HO = [
    { tab: 'cari', stand: 236, j: 'Ini mesin pembangkit = ASET', i: 'Semua aset UPKL ada di Bank Data: foto, PDF, riwayat inven. Ketuk mesinnya!' },
    { tab: 'inven', stand: 196, j: 'Pos scan Inven 2026', i: 'Scan barcode stiker, foto aset, cek AI, lalu simpan. Ketuk pos scan untuk mulai.' },
    { tab: 'attb', stand: 270, j: 'Aset ATTB', i: 'Aset yang sudah tidak beroperasi. Cek daftar & kondisinya di sini.' },
    { tab: 'progres', stand: 270, j: 'Papan progres', i: 'Lihat berapa persen aset sudah diinven, per lokasi & per petugas.' }];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hx = 200, hdir = 1, hi = -1, hHover = false, hWalkT = 0;
  // Lebar adegan menyesuaikan layar: HP = 390 unit; layar lebar = lebih banyak unit, objek disebar (tidak ikut membesar)
  const HB = { o0: 109, o1: 248, o2: 339, o3: 336, bld: 210, c1: 70, c2: 257 };   // titik tengah asli tiap objek
  const HS0 = [236, 196, 270, 270];                                                 // posisi berdiri asli
  let HW = 390, HDX = { o0: 0, o1: 0, o2: 0, o3: 0, bld: 0, c1: 0, c2: 0 };
  function hLayout() {
    const wrap = $('hHero'), pw = wrap.clientWidth || 390;
    const tinggi = pw < 700 ? pw * 400 / 390 : Math.min(460, Math.max(360, window.innerHeight * .5));
    HW = Math.max(390, Math.round(pw * 400 / tinggi));
    if (HW <= 430) { Object.keys(HDX).forEach(k => HDX[k] = 0); }
    else {
      const tgt = { o0: .2, o1: .42, o2: .62, o3: .82, bld: .5, c1: .12, c2: .7 };
      Object.keys(tgt).forEach(k => HDX[k] = Math.round(HW * tgt[k] - HB[k]));
    }
    $('hSvg').setAttribute('viewBox', '0 0 ' + HW + ' 400');
    document.querySelectorAll('#hSvg [data-l]').forEach(g => g.setAttribute('transform', 'translate(' + HDX[g.dataset.l] + ',0)'));
    HO.forEach((o, k) => { o.stand = HS0[k] + HDX['o' + k]; });
    hx = Math.max(40, Math.min(HW - 40, hx));
    hPlace(0);
  }
  function hBubble(j, i) {
    $('hBubT').textContent = j; $('hBubI').textContent = i;
    const b = $('hBub'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }
  function hPlace(dur) {
    const man = $('hMan');
    man.style.transition = 'transform ' + (reduce ? 0 : dur) + 's linear';
    man.style.transform = 'translate(' + hx + 'px,392px) scale(' + (.78 * hdir) + ',.78)';
    // balon chat mengikuti petugas (posisi dalam % lebar adegan)
    const bub = $('hBub'), W = $('hSvg').getBoundingClientRect().width || 390, bw = bub.offsetWidth || 220;
    const px = hx / HW * W, left = Math.max(6, Math.min(W - bw - 6, px - bw * .7));
    bub.style.transition = 'left ' + (reduce ? 0 : dur) + 's linear'; bub.style.left = left + 'px';
    $('hBubTail').style.left = Math.max(14, Math.min(bw - 30, px - left - 7)) + 'px';
  }
  function hWalk(x, k) {
    x = Math.max(40, Math.min(HW - 40, x));
    const d = Math.abs(x - hx);
    if (d < 4 && k === hi) return;
    const dur = Math.min(1.6, Math.max(.25, d / 160));
    if (x !== hx) hdir = x < hx ? -1 : 1;
    hx = x;
    const prev = hi; hi = k;
    document.querySelectorAll('#hSvg .hl').forEach(g => g.classList.toggle('on', Number(g.dataset.k) === k));
    if (k !== prev) { if (k >= 0) hBubble(HO[k].j, HO[k].i); else hBubble(sapa().replace(',', '') + '!', 'Arahkan kursor / sentuh benda di sekitar saya untuk tahu fungsinya.'); }
    $('hBeam').style.display = 'none';
    $('hManIn').classList.toggle('walk', d > 4 && !reduce);
    hPlace(dur);
    clearTimeout(hWalkT);
    hWalkT = setTimeout(() => { $('hManIn').classList.remove('walk'); if (hi === 1) $('hBeam').style.display = 'inline'; }, dur * 1000);
  }
  (function () {
    const svg = $('hSvg');
    const toX = e => { const r = svg.getBoundingClientRect(); return (e.clientX - r.left) * HW / r.width; };
    svg.addEventListener('mousemove', e => { if (e.target.classList.contains('hit')) return; hHover = true; hWalk(toX(e), -1); });
    svg.addEventListener('mouseleave', () => { hHover = false; });
    document.querySelectorAll('#hSvg .hit').forEach(r => {
      const k = Number(r.dataset.k);
      r.addEventListener('mouseenter', () => { hHover = true; hWalk(HO[k].stand, k); });
      r.addEventListener('focus', () => hWalk(HO[k].stand, k));
      r.addEventListener('click', () => go(HO[k].tab));
      r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(HO[k].tab); } });
    });
    // tanpa kursor (HP): keliling ke tiap objek bergantian
    setInterval(() => { if (view === 'home' && !hHover && !document.hidden) hWalk(HO[(hi + 1) % 4].stand, (hi + 1) % 4); }, 4000);
    window.addEventListener('resize', hLayout);
    setTimeout(() => { hBubble('Halo!', 'Saya petugas inventaris. Sentuh benda di sekitar saya untuk tahu fungsinya.'); hLayout(); }, 50);
  })();
  $('hCari').addEventListener('click', () => { go('cari'); setTimeout(() => $('q').focus(), 80); });
  $('hScan').addEventListener('click', () => openAppScanner('cari'));
  $('hAll').addEventListener('click', () => go('cari'));
  $('hRecent').addEventListener('click', e => { const it = e.target.closest('.it'); if (it) openDetail(it.dataset.c); });
  // Cetak stiker: stiker.html di folder aplikasi (sama persis dengan versi Apps Script), data dari HP -> bisa offline, tetap pakai PIN stiker
  $('mStiker').addEventListener('click', () => {
    $('menu').classList.add('hidden');
    location.href = 'stiker.html';
  });
  document.querySelectorAll('#menu .soonBtn').forEach(b => b.addEventListener('click', () => { $('menu').classList.add('hidden'); toast(b.textContent.replace('(segera)', '').trim() + ': segera dibangun'); }));
  document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.v)));

  // ---------- CARI ----------
  let shown = 60, lastQ = '';
  function fillLokasi() {
    if (!data) return;
    const sel = $('fLok'), cur = sel.value;
    const lok = urutLokasi();
    sel.innerHTML = '<option value="">Semua lokasi</option>' + lok.map(l => '<option>' + esc(l) + '</option>').join('');
    sel.value = cur;
  }
  function urutLokasi() {
    const ada = {}; data.items.forEach(x => { ada[x[L]] = 1; });
    const urut = (data.lokasi || []).filter(l => ada[l]);
    Object.keys(ada).sort().forEach(l => { if (urut.indexOf(l) < 0) urut.push(l); });
    return urut;
  }
  function filterItems() {
    const q = nrm($('q').value), lok = $('fLok').value, st = $('fSt').value;
    const toks = q ? q.split(' ') : [];
    const res = [];
    for (const x of data.items) {
      if (lok && x[L] !== lok) continue;
      if (st === 'sudah' && !x[T]) continue;
      if (st === 'belum' && x[T]) continue;
      if (toks.length) {
        const hay = nrm(x[C] + ' ' + x[A] + '-' + x[S] + ' ' + x[D] + ' ' + x[L] + ' ' + x[CC]);
        if (!toks.every(t => hay.indexOf(t) >= 0)) continue;
      }
      res.push(x);
    }
    if (q) {
      const qc = keyCode(q);
      res.sort((a, b) => (keyCode(a[C]).indexOf(qc) === 0 ? 0 : 1) - (keyCode(b[C]).indexOf(qc) === 0 ? 0 : 1));
    }
    return res;
  }
  function renderCari() {
    if (!data) { $('cariList').innerHTML = '<div class="empty">' + (loading ? 'Memuat data aset…' : 'Belum ada data. Ketuk ⟳ Perbarui.') + '</div>'; return; }
    fillLokasi();
    const sig = $('q').value + '|' + $('fLok').value + '|' + $('fSt').value;
    if (sig !== lastQ) { shown = 60; lastQ = sig; }
    const res = filterItems();
    const sudah = res.filter(x => x[T]).length;
    $('cariInfo').textContent = res.length + ' aset · ' + sudah + ' sudah · ' + dataTime();
    $('cariList').innerHTML = res.length ? res.slice(0, shown).map(x =>
      '<div class="it" data-c="' + esc(x[C]) + '"><div class="m"><b>' + esc(x[D] || '(tanpa nama)') + '</b><small>' +
      esc(x[A] + '-' + x[S]) + ' · ' + esc(x[L]) + (x[CC] ? ' · ' + esc(x[CC]) : '') + '</small></div>' +
      (x[T] ? '<span class="badge ok">SUDAH<small>' + tgl(x[T]) + '</small></span>' : '<span class="badge no">BELUM</span>') + '</div>'
    ).join('') : '<div class="empty">Tidak ada aset yang cocok.</div>';
    $('btnMore').classList.toggle('hidden', res.length <= shown);
  }
  let qT = 0;
  $('q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(renderCari, 150); });
  $('fLok').addEventListener('change', renderCari);
  $('fSt').addEventListener('change', renderCari);
  $('btnMore').addEventListener('click', () => { shown += 100; renderCari(); });
  $('cariList').addEventListener('click', e => { const it = e.target.closest('.it'); if (it) openDetail(it.dataset.c); });
  $('btnReload1').addEventListener('click', () => loadData(true));
  $('btnScanCari').addEventListener('click', () => openAppScanner('cari'));

  // ---------- PROGRES ----------
  function renderProgres() {
    if (!data) { $('lokList').innerHTML = '<div class="empty">' + (loading ? 'Memuat data aset…' : 'Belum ada data. Ketuk ⟳ Perbarui.') + '</div>'; return; }
    const rows = {}; let tot = 0, sud = 0, hariIni = 0;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    data.items.forEach(x => {
      const r = rows[x[L]] || (rows[x[L]] = { t: 0, s: 0 });
      r.t++; tot++;
      if (x[T]) { r.s++; sud++; if (x[T] >= d0.getTime()) hariIni++; }
    });
    const p = pct(sud, tot);
    $('ring').style.setProperty('--p', p);
    $('ringTxt').textContent = String(p).replace('.', ',') + '%';
    $('totInfo').innerHTML = '<b>' + sud + '</b> dari <b>' + tot + '</b> aset sudah diinven<br>Belum: <b>' + (tot - sud) + '</b> aset<br>Hari ini: <b>' + hariIni + '</b> aset';
    $('progInfo').textContent = dataTime();
    $('lokList').innerHTML = urutLokasi().map(l => {
      const r = rows[l], q = pct(r.s, r.t);
      return '<div class="lok" data-l="' + esc(l) + '"><div class="r"><b>' + (q >= 100 ? '✅ ' : '') + esc(l) + '</b><span>' + r.s + '/' + r.t +
        ' · ' + String(q).replace('.', ',') + '%</span></div><div class="bar' + (q < 50 ? ' lo' : '') + '"><i style="width:' + q + '%"></i></div></div>';
    }).join('');
  }
  $('lokList').addEventListener('click', e => {
    const el = e.target.closest('.lok'); if (!el) return;
    $('fLok').value = el.dataset.l; $('fSt').value = 'belum'; $('q').value = '';
    go('cari');
  });
  $('btnReload2').addEventListener('click', () => loadData(true));

  // ---------- halaman penuh + tombol kembali HP ----------
  function openSheet(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; history.pushState({ sheet: id }, ''); }
  function closeSheetUi(id) { $(id).classList.add('hidden'); if (['detail', 'scanView', 'qSheet'].every(x => $(x).classList.contains('hidden'))) document.body.style.overflow = ''; }
  window.addEventListener('popstate', () => {
    if (!$('scanView').classList.contains('hidden')) { stopCam(); closeSheetUi('scanView'); }
    else if (!$('lb').classList.contains('hidden')) tutupLb(true);
    else if (!$('detail').classList.contains('hidden')) closeSheetUi('detail');
    else if (!$('qSheet').classList.contains('hidden')) closeSheetUi('qSheet');
  });

  // ---------- DETAIL ----------
  let detCode = '';
  function openDetail(code) {
    detCode = code;
    addRecent(code);
    const it = findItem(code);
    $('detCode').textContent = code;
    $('detTitle').textContent = it ? it[D] : code;
    $('detSub').textContent = it ? (it[A] + '-' + it[S] + ' · ' + it[L]) : '';
    renderStat(it);
    $('detKv').innerHTML = it ? kv([['Qty sistem', it[Q] + ' ' + it[B]], ['Cost center', it[CC]], ['Lokasi', it[L]], ['Diinput', it[N] ? it[N] + ' kali' : '-']]) : '';
    $('detFolder').classList.toggle('hidden', !(it && it[U]));
    if (it && it[U]) $('detFolder').href = it[U];
    ['detHist', 'detNow', 'detOld'].forEach(i => { $(i).innerHTML = '<div class="hint">Memuat…</div>'; });
    openSheet('detail');
    APP.call('detailAset', [code]).then(r => {
      if (detCode !== code) return;
      if (!r || !r.found) { $('detHist').innerHTML = '<div class="msg err">' + esc((r && r.message) || 'Aset tidak ditemukan.') + '</div>'; $('detNow').innerHTML = $('detOld').innerHTML = ''; return; }
      const inf = r.info;
      $('detTitle').textContent = inf.title || inf.code;
      $('detSub').textContent = inf.asset + '-' + inf.sno + ' · ' + inf.lokasi + (inf.costCenter ? ' · ' + inf.costCenter : '');
      $('detKv').innerHTML = kv(inf.fields.filter(f => f.label !== 'Asset description').map(f => [f.label, f.value])
        .concat([['Tgl perolehan', inf.tglPerolehan], ['Diinput', r.riwayat.length ? r.riwayat.length + ' kali' : '-']]));
      if (r.folderUrl) { $('detFolder').href = r.folderUrl; $('detFolder').classList.remove('hidden'); }
      const last = r.riwayat[0];
      renderStat(last ? { 8: last.t } : null);
      $('detHist').innerHTML = r.riwayat.length ? r.riwayat.map(h =>
        '<div class="hist"><b>' + esc(h.waktu) + '</b> · ' + esc(h.petugas || '-') + '<br>Qty fisik <b>' + esc(h.qtyFisik) + '</b> · ' + esc(h.kondisi) +
        (h.cekAi ? ' · AI: ' + esc(h.cekAi) : '') + (h.catatan ? '<br><span style="opacity:.8">' + esc(h.catatan) + '</span>' : '') + '</div>').join('')
        : '<div class="hint">Belum pernah diinven tahun ini.</div>';
      $('detNow').innerHTML = files(r.files.filter(f => !f.lama), 'Belum ada foto/PDF tahun ini.');
      $('detOld').innerHTML = files(r.files.filter(f => f.lama), 'Tidak ada file tahun lalu.');
    }).catch(e => {
      if (detCode !== code) return;
      if (e.offline) {
        $('detHist').innerHTML = it && it[T] ? '<div class="hist"><b>' + tgl(it[T], true) + '</b> · ' + esc(it[P] || '-') + '<br>Qty fisik <b>' + esc(it[QF]) + '</b> · ' + esc(it[K]) + '</div>' +
          '<div class="hint">Offline – riwayat lengkap butuh internet.</div>' : '<div class="hint">Offline – riwayat butuh internet.</div>';
        $('detNow').innerHTML = $('detOld').innerHTML = '<div class="hint">Offline – foto butuh internet.</div>';
        return;
      }
      $('detHist').innerHTML = '<div class="msg err">Gagal memuat: ' + esc(e.message) + '</div>';
      $('detNow').innerHTML = $('detOld').innerHTML = '';
    });
  }
  function renderStat(it) {
    $('detStat').innerHTML = it && it[T] ? '<span class="stat ok">✓ SUDAH diinven · ' + tgl(it[T], true) + '</span>' : '<span class="stat no">BELUM diinven</span>';
  }
  function kv(pairs) { return pairs.filter(p => p[1] !== '' && p[1] != null).map(p => '<div><span>' + esc(p[0]) + '</span><b>' + esc(p[1]) + '</b></div>').join(''); }
  function files(list, kosong) {
    if (!list.length) return '<div class="hint">' + kosong + '</div>';
    const img = list.filter(f => /^image\//.test(f.mime)), oth = list.filter(f => !/^image\//.test(f.mime));
    return (img.length ? '<div class="gal">' + img.map(f => '<a href="https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view" target="_blank" rel="noopener" data-id="' + esc(f.id) + '" data-nama="' + esc(f.nama) + '">' +
      '<img loading="lazy" alt="' + esc(f.nama) + '" src="https://drive.google.com/thumbnail?sz=w400&id=' + encodeURIComponent(f.id) + '"></a>').join('') + '</div>' : '') +
      (oth.length ? '<div class="files" style="margin-top:6px">' + oth.map(f => '<a class="f" href="https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view" target="_blank" rel="noopener">' +
        (/pdf/.test(f.mime) ? '📄 ' : '📎 ') + esc(f.nama) + '</a>').join('') + '</div>' : '');
  }
  $('btnDetBack').addEventListener('click', () => history.back());

  // ---------- LIHAT FOTO (popup + zoom) ----------
  // Klik foto di detail -> tampil besar di aplikasi (tidak pindah tab). Zoom: cubit 2 jari / ketuk 2x / roda mouse / tombol +/-.
  // Geser kiri-kanan untuk foto berikutnya. Tombol "Buka di Drive" tetap tersedia (tab baru).
  let lbList = [], lbI = 0, lbS = 1, lbX = 0, lbY = 0;
  const lbImg = () => $('lbImg');
  function lbApply(anim) {
    const im = lbImg(); im.style.transition = anim ? 'transform .2s' : 'none';
    im.style.transform = 'translate(' + lbX + 'px,' + lbY + 'px) scale(' + lbS + ')';
    $('lbZoom').textContent = Math.round(lbS * 100) + '%';
  }
  function lbBatas() {
    const im = lbImg(), w = im.clientWidth * lbS, h = im.clientHeight * lbS, W = innerWidth, H = innerHeight;
    const mx = Math.max(0, (w - W) / 2), my = Math.max(0, (h - H) / 2);
    lbX = Math.min(mx, Math.max(-mx, lbX)); lbY = Math.min(my, Math.max(-my, lbY));
  }
  function lbSetZoom(s, cx, cy) {
    s = Math.min(6, Math.max(1, s));
    if (cx != null) { const ox = cx - innerWidth / 2 - lbX, oy = cy - innerHeight / 2 - lbY; lbX -= ox * (s / lbS - 1); lbY -= oy * (s / lbS - 1); }
    lbS = s; if (s === 1) { lbX = 0; lbY = 0; } lbBatas(); lbApply(true);
  }
  function lbShow(i) {
    lbI = (i + lbList.length) % lbList.length; lbS = 1; lbX = 0; lbY = 0;
    const f = lbList[lbI], im = lbImg();
    $('lbLoad').classList.remove('hidden');
    im.onload = () => $('lbLoad').classList.add('hidden');
    im.onerror = () => { $('lbLoad').textContent = 'Foto tidak bisa dimuat (perlu internet).'; };
    im.src = 'https://drive.google.com/thumbnail?sz=w2000&id=' + encodeURIComponent(f.id);
    $('lbCap').textContent = (lbList.length > 1 ? (lbI + 1) + '/' + lbList.length + ' · ' : '') + f.nama;
    $('lbDrive').href = 'https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view';
    $('lbPrev').classList.toggle('hidden', lbList.length < 2); $('lbNext').classList.toggle('hidden', lbList.length < 2);
    lbApply(false);
  }
  function bukaLb(list, i) { lbList = list; $('lb').classList.remove('hidden'); history.pushState({ lb: 1 }, ''); lbShow(i); }
  function tutupLb(dariBack) { $('lb').classList.add('hidden'); lbImg().src = ''; if (!dariBack) history.back(); }
  $('detail').addEventListener('click', e => {
    const a = e.target.closest('.gal a'); if (!a) return;
    e.preventDefault();
    const gal = [...a.parentNode.querySelectorAll('a')];
    bukaLb(gal.map(x => ({ id: x.dataset.id, nama: x.dataset.nama })), gal.indexOf(a));
  });
  $('lbClose').addEventListener('click', () => tutupLb(false));
  $('lbPrev').addEventListener('click', () => lbShow(lbI - 1));
  $('lbNext').addEventListener('click', () => lbShow(lbI + 1));
  $('lbIn').addEventListener('click', () => lbSetZoom(lbS * 1.6));
  $('lbOut').addEventListener('click', () => lbSetZoom(lbS / 1.6));
  document.addEventListener('keydown', e => {
    if ($('lb').classList.contains('hidden')) return;
    if (e.key === 'Escape') tutupLb(false); else if (e.key === 'ArrowLeft') lbShow(lbI - 1); else if (e.key === 'ArrowRight') lbShow(lbI + 1);
  });
  (function () {
    const st = $('lbStage'), pts = new Map(); let start = null, lastTap = 0;
    st.addEventListener('wheel', e => { e.preventDefault(); lbSetZoom(lbS * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY); }, { passive: false });
    st.addEventListener('pointerdown', e => {
      st.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        const now = Date.now();
        if (now - lastTap < 300) { lbSetZoom(lbS > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; start = null; return; }
        lastTap = now; start = { x: e.clientX, y: e.clientY, bx: lbX, by: lbY, s: lbS, t: now };
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; start = { pinch: Math.hypot(a.x - b.x, a.y - b.y), s: lbS, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
    });
    st.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start.pinch) {
        const [a, b] = [...pts.values()]; const s = Math.min(6, Math.max(1, start.s * Math.hypot(a.x - b.x, a.y - b.y) / start.pinch));
        lbS = s; if (s === 1) { lbX = 0; lbY = 0; } lbBatas(); lbApply(false);
      } else if (pts.size === 1 && start.bx != null) {
        if (lbS > 1) { lbX = start.bx + e.clientX - start.x; lbY = start.by + e.clientY - start.y; lbBatas(); lbApply(false); }
        else { lbX = e.clientX - start.x; lbApply(false); }
      }
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (start && start.bx != null && lbS === 1 && pts.size === 0) {
        const dx = e.clientX - start.x;
        if (Math.abs(dx) > 60 && lbList.length > 1) lbShow(lbI + (dx < 0 ? 1 : -1)); else { lbX = 0; lbApply(true); }
      }
      if (pts.size === 0) start = null;
    };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  })();
  $('btnDetInven').addEventListener('click', () => {
    const code = detCode; history.back();
    setTimeout(() => { go('inven'); $('code').value = code; doLookup(); }, 60);
  });

  // ---------- PEMINDAI (kamera langsung di aplikasi) ----------
  const CONFIRM_READS = 2, CODE_RE = /^[A-Za-z0-9._-]{1,40}$/;
  let sc = null, scMode = 'inven', done = false, lastVal = '', streak = 0, cams = [], token = 0, attempts = 0, zoomInfo = null, zoomBusy = false;
  function scMsg(t, cls) { $('scMsg').textContent = t || ''; $('scMsg').className = cls || ''; }
  window.openAppScanner = function (mode) {
    scMode = mode || 'inven';
    $('scTitle').textContent = scMode === 'cari' ? 'Scan untuk lihat detail' : 'Scan untuk inven';
    $('scManual').value = '';
    openSheet('scanView');
    startScanner();
  };
  function finish(code) {
    done = true; beep();
    scMsg('Terbaca: ' + code, 'ok');
    stopCam();
    history.back();
    setTimeout(() => {
      if (scMode === 'cari') openDetail(code);
      else { go('inven'); $('code').value = code; doLookup(); }
    }, 80);
  }
  function accept(raw) {
    const code = String(raw || '').trim();
    if (done || !code) return;
    if (!CODE_RE.test(code)) { scMsg('Terbaca "' + code.slice(0, 30) + '" tetapi bukan kode inventaris. QR stiker untuk folder Drive, scan BARCODE-nya.', 'err'); lastVal = ''; streak = 0; return; }
    if (code === lastVal) streak++; else { lastVal = code; streak = 1; }
    if (streak >= CONFIRM_READS) finish(code);
  }
  function setZoom(v) {
    if (!zoomInfo) return;
    v = Math.min(zoomInfo.max, Math.max(zoomInfo.min, v));
    zoomInfo.cur = v; $('scZoom').value = v;
    if (zoomBusy) return; zoomBusy = true;
    requestAnimationFrame(() => { zoomBusy = false; try { zoomInfo.track.applyConstraints({ advanced: [{ zoom: zoomInfo.cur }] }).catch(() => {}); } catch (e) {} });
  }
  (function () {
    const w = $('scWrap'); let pinch = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    w.addEventListener('touchstart', e => { if (e.touches.length === 2 && zoomInfo) { pinch = { d: dist(e.touches), z: zoomInfo.cur }; e.preventDefault(); } }, { passive: false });
    w.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches) / pinch.d); } }, { passive: false });
    w.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  })();
  function fitReader() {
    const r = $('scReader'), w = $('scWrap');
    r.style.transform = ''; w.style.height = '';
    const h = r.offsetHeight; if (!h) return;
    const k = Math.min(1, Math.max(200, Math.floor(window.innerHeight * 0.5)) / h);
    if (k < 1) { r.style.transformOrigin = 'top center'; r.style.transform = 'scale(' + k + ')'; w.style.height = Math.ceil(h * k) + 'px'; }
  }
  function track() { const v = document.querySelector('#scReader video'), s = v && v.srcObject; return s && s.getVideoTracks ? s.getVideoTracks()[0] : null; }
  function setupTools() {
    const t = track(); if (!t || !t.getCapabilities) return;
    let caps = {}; try { caps = t.getCapabilities() || {}; } catch (e) {}
    if ('torch' in caps) {
      $('scTorch').classList.remove('hidden'); let on = false;
      $('scTorch').onclick = async () => { try { on = !on; await t.applyConstraints({ advanced: [{ torch: on }] }); $('scTorch').textContent = on ? '🔦 Senter: nyala' : '🔦 Senter'; } catch (e) { on = !on; } };
    }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const z = $('scZoom'); z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1; z.value = caps.zoom.min;
      z.classList.remove('hidden'); zoomInfo = { min: caps.zoom.min, max: caps.zoom.max, cur: caps.zoom.min, track: t };
      z.oninput = () => setZoom(Number(z.value));
    }
  }
  const RE_REAR = /back|rear|environment|belakang|world/i, RE_FRONT = /front|user|depan|selfie/i;
  const camScore = c => { const l = c.label || ''; let n = 0; if (RE_REAR.test(l)) n += 10; if (RE_FRONT.test(l)) n -= 10; if (/ultra|tele|macro|depth/i.test(l)) n -= 3; return n; };
  async function stopCam() {
    token++;
    try { if (sc) { if (sc.isScanning) await sc.stop(); sc.clear(); } } catch (e) {}
    sc = null; zoomInfo = null;
    $('scTorch').classList.add('hidden'); $('scZoom').classList.add('hidden');
  }
  function camError(err) {
    const n = String((err && (err.name || err.message)) || err);
    if (/NotAllowed|Permission/i.test(n)) scMsg('Izin kamera ditolak. Buka pengaturan HP → Aplikasi/Situs → izinkan Kamera, lalu coba lagi. Atau ketik kode manual.', 'err');
    else if (/NotFound|Devices/i.test(n)) scMsg('Kamera tidak ditemukan. Ketik kode manual atau pakai foto barcode.', 'err');
    else if (/NotReadable|TrackStart|in use/i.test(n)) scMsg('Kamera sedang dipakai aplikasi lain. Tutup lalu coba lagi.', 'err');
    else scMsg('Kamera tidak bisa dibuka: ' + n, 'err');
  }
  async function rawStart(id, withVC) {
    const F = Html5QrcodeSupportedFormats;
    sc = new Html5Qrcode('scReader', { formatsToSupport: [F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
    const cfg = { fps: 12, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.92, 420)), height: Math.floor(Math.min(h * 0.5, 180)) }) };
    if (id && withVC) cfg.videoConstraints = { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } };
    await sc.start(id || { facingMode: 'environment' }, cfg, accept, () => {});
  }
  async function startCam(id) {
    await stopCam();
    const my = token;
    done = false; lastVal = ''; streak = 0;
    scMsg('Memulai kamera…');
    try {
      try { await rawStart(id, true); }
      catch (e1) { if (!/NotAllowed|Permission/i.test(String(e1 && (e1.name || e1)))) { try { if (sc) sc.clear(); } catch (e) {} await rawStart(id, false); } else throw e1; }
    } catch (err) { if (my === token) camError(err); return; }
    if (my !== token) { try { await sc.stop(); } catch (e) {} return; }
    if (id) { LS.set('invent-cam', id); $('scCam').value = id; }
    scMsg('Tahan barcode sejajar di dalam kotak.');
    setupTools();
    [200, 800, 2000].forEach(ms => setTimeout(() => { if (my === token) fitReader(); }, ms));
    setTimeout(() => {
      if (my !== token || done) return;
      const v = document.querySelector('#scReader video');
      if (v && v.videoWidth > 0 && v.readyState >= 2) return;
      if (cams.length > 1 && attempts < cams.length - 1) {
        attempts++; const i = cams.findIndex(c => c.id === id);
        scMsg('Gambar tidak muncul, mencoba kamera lain…', 'err'); startCam(cams[(i + 1) % cams.length].id);
      } else scMsg('Gambar kamera tidak muncul. Pilih kamera lain di bawah, atau pakai foto barcode.', 'err');
    }, 3000);
  }
  async function startScanner() {
    if (!window.Html5Qrcode) { scMsg('Pemindai belum termuat (perlu internet saat pertama kali). Ketik kode manual.', 'err'); return; }
    scMsg('Meminta izin kamera…');
    try { cams = (await Html5Qrcode.getCameras() || []).slice().sort((a, b) => camScore(b) - camScore(a)); }
    catch (err) { camError(err); return; }
    if (cams.length) {
      $('scCam').innerHTML = cams.map((c, i) => '<option value="' + esc(c.id) + '">' + esc(c.label || ('Kamera ' + (i + 1))) +
        (RE_REAR.test(c.label || '') ? ' (belakang)' : RE_FRONT.test(c.label || '') ? ' (depan)' : '') + '</option>').join('');
      $('scCam').classList.remove('hidden');
    }
    attempts = 0;
    const saved = LS.get('invent-cam', ''), pick = cams.find(c => c.id === saved) || cams[0];
    startCam(pick ? pick.id : null);
  }
  $('scCam').addEventListener('change', () => { attempts = 99; startCam($('scCam').value); });
  const manual = () => { const c = $('scManual').value.trim(); if (!CODE_RE.test(c)) { scMsg('Kode tidak valid.', 'err'); return; } finish(c); };
  $('scGo').addEventListener('click', manual);
  $('scManual').addEventListener('keydown', e => { if (e.key === 'Enter') manual(); });
  $('scPhotoBtn').addEventListener('click', () => $('scPhoto').click());
  $('scPhoto').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    scMsg('Membaca barcode dari foto…');
    try { await stopCam(); const text = await decodeImageFile(f); lastVal = String(text).trim(); streak = CONFIRM_READS - 1; accept(text); }
    catch (er) { scMsg('Barcode tidak terbaca dari foto. Dekatkan kamera, pastikan tajam dan tidak silau, lalu foto ulang.', 'err'); }
  });
  $('btnScBack').addEventListener('click', () => history.back());
  window.addEventListener('resize', () => { if (!$('scanView').classList.contains('hidden')) fitReader(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !$('scanView').classList.contains('hidden')) stopCam(); else if (!document.hidden && !$('scanView').classList.contains('hidden') && !sc && !done) startScanner(); });

  // ---------- MODE OFFLINE ----------
  // Antrian simpan di IndexedDB (muat foto HD + PDF); dikirim otomatis saat ada sinyal.
  const QS = (function () {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('inv-antrian', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
      const t = d.transaction('q', mode), st = t.objectStore('q'); const out = fn(st);
      t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
    }));
    return { put: it => tx('readwrite', st => st.put(it)), del: id => tx('readwrite', st => st.delete(id)), all: () => tx('readonly', st => st.getAll()) };
  })();
  let qCount = 0, syncing = false;
  function localLookup(code) {
    if (!data) throw new Error('Offline dan daftar aset belum pernah dimuat. Sambungkan internet sekali, buka tab Cari, lalu coba lagi.');
    const x = findItem(code);
    if (!x) return { found: false, message: 'Kode ' + code + ' tidak ada di data tersimpan (offline). Cek kodenya, atau coba lagi saat ada sinyal.' };
    let info = {}; try { info = JSON.parse(LS.get('inv-info', '{}')) || {}; } catch (e) {}
    return { found: true, offline: true, code: x[C], row: 0, costCenter: x[CC], title: x[D], asset: x[A], sno: x[S] || '0', bun: x[B],
      tglPerolehan: x[TP] || '', qtySistem: x[Q], loc: x[L], lokasi: x[L], folderName: x[L] + '-' + x[A] + '-' + (x[S] || '0'),
      previous: x[T] ? tgl(x[T], true) : '', previousCount: x[N] || 0,
      fields: [{ label: 'Quantity', value: x[Q] }, { label: 'BUn', value: x[B] }, { label: 'Location', value: x[LC] || '' }, { label: 'Loc', value: x[L] }],
      aiAktif: info.aiAktif !== false, aiNama: info.aiNama || 'AI' };
  }
  let aiStash = null;
  APP.offline = {
    lookupCode: code => localLookup(code),
    getPegawai: () => { try { return JSON.parse(LS.get('inv-peg', '[]')); } catch (e) { return []; } },
    verifikasiFoto: p => {
      aiStash = { code: p.code, photos: p.photos };
      return { ok: true, lolos: true, offline: true, ai: '', ringkas: 'OFFLINE', gagal: [], saran: [], catatan: [] };
    },
    saveScan: async p => {
      const it = findItem(p.code), t = Date.now();
      p.waktuOffline = t;
      await QS.put({ id: t + '-' + Math.random().toString(36).slice(2, 7), t: t, code: p.code, desc: it ? it[D] : '', payload: p,
        aiPending: !!(p.ai && p.ai.ringkas === 'OFFLINE'), aiPhotos: aiStash && aiStash.code === p.code ? aiStash.photos : null, err: '' });
      aiStash = null; APP.lastQueued = true;
      return { folderUrl: '', folderName: 'antrian HP', photos: (p.photos || []).length, pdfName: 'PDF', queued: true };
    }
  };
  function aiInfo(r) {
    if (!r) return { status: 'ERROR', ringkas: 'Cek AI tidak dijalankan (foto AI tidak tersimpan)' };
    return { status: r.ok ? (r.lolos ? 'LOLOS' : 'TIDAK LOLOS') : 'ERROR', ringkas: r.ok ? r.ringkas : 'Cek AI gagal: ' + r.error,
      kondisiUsulan: r.kondisiUsulan || '', keteranganUsulan: r.keteranganUsulan || '', nameplate: r.nameplate || '',
      saran: r.lolos ? [] : (r.saran || []), lalu: r.lalu || '', bedaLalu: r.bedaLalu || '', refNama: r.refNama || '' };
  }
  async function syncQueue(manual) {
    if (syncing || !APP.pin()) return;
    let list = []; try { list = await QS.all(); } catch (e) {}
    qCount = list.length; updateQueueUi();
    if (!list.length) { if (manual) toast('Antrian kosong'); return; }
    if (navigator.onLine === false) { if (manual) toast('Masih offline. Akan dikirim otomatis saat ada sinyal.'); return; }
    syncing = true; updateQueueUi();
    let sent = 0, gagal = 0;
    list.sort((a, b) => a.t - b.t);
    for (const it of list) {
      try {
        const p = it.payload;
        if (it.aiPending) {
          let r = null;
          if (it.aiPhotos && it.aiPhotos.length) {
            try { r = await APP.call('verifikasiFoto', [{ code: p.code, kondisi: p.kondisi, catatan: p.catatan, photos: it.aiPhotos }]); }
            catch (e) { if (e.offline) throw e; r = { ok: false, error: e.message }; }
          }
          p.ai = aiInfo(r);
          p.alasanLewati = r && r.ok && r.lolos ? '' : 'Disimpan offline (tanpa sinyal); cek AI saat terkirim: ' + (r && r.ok ? 'belum lolos' : 'gagal');
          it.aiPending = false; it.aiPhotos = null; it.payload = p;
          await QS.put(it);
        }
        await APP.call('saveScan', [p]);
        await QS.del(it.id); sent++;
      } catch (e) {
        if (e.offline) break;
        it.err = e.message; gagal++;
        try { await QS.put(it); } catch (e2) {}
        if (/PIN salah|NIP/.test(e.message)) break;
      }
    }
    syncing = false;
    try { qCount = (await QS.all()).length; } catch (e) {}
    updateQueueUi(); if (!$('qSheet').classList.contains('hidden')) renderQueue();
    if (sent) { toast('📤 ' + sent + ' data offline terkirim' + (gagal ? ', ' + gagal + ' gagal' : ''), 3500); loadData(true); }
    else if (gagal && manual) toast(gagal + ' data gagal terkirim, lihat Antrian offline', 3500);
  }
  function updateQueueUi() {
    QS.all().then(l => {
      qCount = l.length;
      const err = l.filter(x => x.err).length;
      $('qBar').classList.toggle('hidden', !qCount);
      document.body.classList.toggle('hasQ', !!qCount);
      $('qTxt').textContent = syncing ? '📤 Mengirim ' + qCount + ' data…' : '📥 ' + qCount + ' data belum terkirim' + (err ? ' (' + err + ' gagal)' : '') + (navigator.onLine === false ? ' · offline' : '');
      $('qSend').disabled = syncing;
    }).catch(() => {});
  }
  async function renderQueue() {
    const l = (await QS.all()).sort((a, b) => a.t - b.t);
    $('qList').innerHTML = l.length ? l.map(x => '<div class="it" style="cursor:default"><div class="m"><b>' + esc(x.desc || x.code) + '</b><small>' + esc(x.code) +
      ' · ' + tgl(x.t, true) + ' · ' + (x.payload.photos || []).length + ' foto' + (x.aiPending ? ' · AI menunggu' : '') + '</small>' +
      (x.err ? '<div class="qerr">Gagal: ' + esc(x.err) + '</div>' : '') + '</div><button class="sec" type="button" data-del="' + esc(x.id) + '" style="padding:5px 9px;font-size:12px">Hapus</button></div>').join('')
      : '<div class="empty">Antrian kosong. Semua data sudah terkirim. ✓</div>';
  }
  function openQueue() { $('menu').classList.add('hidden'); renderQueue(); openSheet('qSheet'); }
  $('qBar').addEventListener('click', e => { if (e.target.id !== 'qSend') openQueue(); });
  $('qSend').addEventListener('click', () => syncQueue(true));
  $('qSend2').addEventListener('click', () => syncQueue(true));
  $('mQueue').addEventListener('click', openQueue);
  $('btnQBack').addEventListener('click', () => history.back());
  $('qList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-del]'); if (!b) return;
    if (!confirm('Hapus data ini dari antrian? Data yang dihapus TIDAK akan terkirim.')) return;
    await QS.del(b.dataset.del); renderQueue(); updateQueueUi();
  });
  function setOnline() {
    const off = navigator.onLine === false;
    document.querySelector('.appbar .t small').innerHTML = 'PLN UPK Lombok' + (off ? '<span class="pill">OFFLINE</span>' : '');
  }
  window.addEventListener('online', () => { setOnline(); updateQueueUi(); setTimeout(() => syncQueue(false), 1500); });
  window.addEventListener('offline', () => { setOnline(); updateQueueUi(); });

  // ---------- LOGIN ----------
  function showLogin(msg) { $('login').classList.remove('hidden'); $('loginMsg').textContent = msg || ''; $('pinIn').value = ''; setTimeout(() => $('pinIn').focus(), 100); }
  async function doLogin() {
    const pin = $('pinIn').value.trim(); if (!pin) { $('loginMsg').textContent = 'Isi NIP atau PIN tim dulu.'; return; }
    $('btnLogin').disabled = true; $('loginMsg').className = 'msg'; $('loginMsg').textContent = 'Memeriksa…';
    try {
      const r = await APP.call('infoApp', [], pin);
      LS.set('inv-pin', pin);
      $('login').classList.add('hidden');
      afterLogin(r);
    } catch (e) { $('loginMsg').className = 'msg err'; $('loginMsg').textContent = e.offline ? 'Tidak ada sinyal. Login pertama kali butuh internet.' : e.message; }
    $('btnLogin').disabled = false;
  }
  function afterLogin(r) {
    if (r && r.login) { LS.set('inv-login', JSON.stringify(r.login)); applyLogin(r.login); }
    if (r) LS.set('inv-info', JSON.stringify({ aiAktif: r.aiAktif, aiNama: r.aiNama, stikerHash: r.stikerHash || '' }));
    if (r && Array.isArray(r.pegawai)) {
      LS.set('inv-peg', JSON.stringify(r.pegawai));
      pegawai = r.pegawai;
      if (petugasNama && pegawai.length) {
        const hit = pegawai.find(p => normNama(p[0]) === normNama(petugasNama));
        if (hit) setPetugas(hit[0], false); else if (!petugasNon) setPetugas('');
      }
    }
    if (loginInfo && loginInfo.mode === 'nip') setPetugas(loginInfo.nama, false);
    if (view === 'home') renderHome();
    loadData(false);
    syncQueue(false);
  }
  // login NIP: nama petugas terkunci sesuai NIP
  let loginInfo = null;
  function applyLogin(lg) {
    loginInfo = lg || null;
    const nip = loginInfo && loginInfo.mode === 'nip';
    if (nip) setPetugas(loginInfo.nama, false);
    $('btnGantiNama').classList.toggle('hidden', nip);
    $('akunInfo').innerHTML = nip ? '<span class="lockTag">🔒 Login NIP</span> ' + esc(loginInfo.jabatan || '') : 'Perangkat: app-' + esc(APP.device()) + ' · login PIN tim';
  }
  APP.onPinInvalid = () => { LS.del('inv-pin'); LS.del('inv-login'); applyLogin(null); showLogin('PIN/NIP tidak berlaku lagi. Masukkan NIP atau PIN tim terbaru.'); };
  $('btnLogin').addEventListener('click', doLogin);
  $('pinIn').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // ---------- menu ----------
  $('btnMenu').addEventListener('click', e => {
    e.stopPropagation();
    $('aboutTxt').innerHTML = 'Aplikasi v' + APP_VERSION + ' · ID perangkat <b>app-' + esc(APP.device()) + '</b><br>' + esc(dataTime()) + '<br>© Han with Claude🤖✨';
    $('menu').classList.toggle('hidden');
  });
  document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').classList.add('hidden'); });
  $('btnRefresh').addEventListener('click', () => { loadData(true); });
  $('mReload').addEventListener('click', () => { $('menu').classList.add('hidden'); loadData(true); });
  $('mLogout').addEventListener('click', () => {
    if (!confirm('Keluar dari aplikasi di HP ini? PIN perlu dimasukkan lagi.')) return;
    LS.del('inv-pin'); LS.del('inv-data'); LS.del('inv-login'); data = null; applyLogin(null); setPetugas('');
    $('menu').classList.add('hidden'); showLogin('');
  });
  // pasang ke layar utama (Android/Chrome)
  let installEvt = null;
  // Android & laptop (Chrome/Edge): tombol Pasang. iPhone/iPad: tidak ada tombol, tampil petunjuk manual.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const terpasang = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const IOS_TXT = 'iPhone/iPad: buka di Safari → ketuk tombol Bagikan (kotak panah ke atas) → "Tambahkan ke Layar Utama".';
  function updInstall() {
    const bisa = !terpasang() && (!!installEvt || isIOS);
    ['hInstall', 'lInstall'].forEach(id => {
      const el = $(id); el.classList.toggle('hidden', !bisa); el.classList.toggle('ios', isIOS && !installEvt);
      if (isIOS && !installEvt) el.querySelector('.instTxt').textContent = IOS_TXT;
    });
    $('mInstall').classList.toggle('hidden', !bisa);
  }
  async function pasang() {
    $('menu').classList.add('hidden');
    if (installEvt) {
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) {}
      installEvt = null; updInstall();
    } else if (isIOS) toast(IOS_TXT, 7000);
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; updInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; updInstall(); toast('Aplikasi terpasang di layar utama'); });
  document.querySelectorAll('.instBtn').forEach(b => b.addEventListener('click', pasang));
  $('mInstall').addEventListener('click', pasang);
  updInstall();

  // ---------- pembaruan aplikasi (service worker) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const tawarkan = w => { if (!w) return; $('updBar').classList.remove('hidden'); $('btnUpd').onclick = () => w.postMessage('skip'); };
      if (reg.waiting && navigator.serviceWorker.controller) tawarkan(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) tawarkan(w); });
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  // ---------- mulai ----------
  loadCache();
  try { const pg = JSON.parse(LS.get('inv-peg', '[]')); if (Array.isArray(pg) && pg.length && !pegawai.length) pegawai = pg; } catch (e) {}
  try { applyLogin(JSON.parse(LS.get('inv-login', 'null'))); } catch (e) { applyLogin(null); }
  setOnline(); updateQueueUi();
  go('home');   // aplikasi selalu dibuka di Home
  if (!APP.pin()) showLogin('');
  else { APP.call('infoApp').then(afterLogin).catch(() => {}); }
  setInterval(() => syncQueue(false), 60 * 1000);
})();
