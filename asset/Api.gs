// ====== Api.gs : KHUSUS APLIKASI HP (PWA) ======
// File terpisah dari Code.gs (web form). Update aplikasi cukup mengganti file ini.
// Memakai fungsi di Code.gs: lookupCode, saveScan, verifikasiFoto, daftarPegawai_, dll.

// ====================================================================
// ====== API UNTUK APLIKASI HP (PWA) ======
// ====================================================================
// Aplikasi HP memanggil skrip ini lewat doPost (JSON), dilindungi PIN aplikasi.
// SETUP:
//  1. Login aplikasi: NIP pegawai (kolom C sheet 'pegawai') ATAU PIN tim di Properti skrip APP_PIN (untuk non-pegawai).
//     APP_PIN boleh dikosongkan bila hanya ingin login NIP. Jangan tulis PIN di kode.
//  2. Deploy > Deployment baru > Aplikasi web > Jalankan sebagai: Saya, Yang memiliki akses: Siapa saja.
//     (deployment TERPISAH dari form lama; form lama tetap jalan seperti biasa)
//  3. Salin URL /exec deployment baru itu ke config.js aplikasi (API_URL).
let APP_CTX = null;
const APP_FUNGSI = {
  infoApp: function () { return infoApp(); },
  getPegawai: function () { return getPegawai(); },
  lookupCode: function (code) { return lookupCode(code); },
  verifikasiFoto: function (p) { return verifikasiFoto(p); },
  saveScan: function (p) { return saveScan(p); },
  dataAset: function () { return dataAset(); },
  detailAset: function (code) { return detailAset(code); }
};

// ---- login: NIP pegawai atau PIN tim ----
function nipKey_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// NIP -> [nama, jabatan, nip] dari sheet 'pegawai' (A nama, B jabatan, C NIP). NIP TIDAK pernah dikirim ke HP.
function nipMap_(segar) {
  const cache = CacheService.getScriptCache();
  if (!segar) { const hit = cache.get('nip_v1'); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  const map = {};
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_PEGAWAI);
  if (sh && sh.getLastRow() >= 2 && sh.getLastColumn() >= 3) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      const k = nipKey_(r[2]), n = String(r[0] || '').replace(/\s+/g, ' ').trim();
      if (k.length >= 5 && n && !map[k]) map[k] = [n, String(r[1] || '').trim(), String(r[2]).trim()];
    });
  }
  try { cache.put('nip_v1', JSON.stringify(map), 300); } catch (e) {}
  return map;
}
function cekLogin_(given) {
  given = String(given || '').trim();
  const pin = prop_('APP_PIN');
  if (pin && given === pin) return { mode: 'tim' };
  const k = nipKey_(given);
  if (k.length >= 5) {
    const m = nipMap_()[k] || nipMap_(true)[k];
    if (m) return { mode: 'nip', nama: m[0], jabatan: m[1], nip: m[2] };
  }
  return null;
}
// Waktu hasil inven: data yang disimpan offline memakai waktu saat diinput di HP (maks. 14 hari ke belakang)
function waktuInven_(p) {
  const t = Number(p && p.waktuOffline), now = Date.now();
  if (APP_CTX && isFinite(t) && t > now - 14 * 86400000 && t <= now + 5 * 60000) return new Date(t);
  return new Date();
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const login = cekLogin_(req.pin);
    if (!login) { Utilities.sleep(1500); throw new Error('PIN salah / NIP tidak terdaftar.'); }
    const fn = APP_FUNGSI[String(req.fn || '')];
    if (!fn) throw new Error('Fungsi tidak dikenal: ' + req.fn);
    const dev = String(req.device || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    if (!dev) throw new Error('ID perangkat kosong.');
    // login NIP: ID akun di hasil_scan = app-N<NIP>, nama petugas dipaksa sesuai NIP
    APP_CTX = { device: login.mode === 'nip' ? ('N' + nipKey_(login.nip)).slice(0, 12) : dev, login: login };
    const args = Array.isArray(req.args) ? req.args : [];
    if (req.fn === 'saveScan' && login.mode === 'nip' && args[0]) { args[0].petugas = login.nama; args[0].petugasNon = false; }
    out = { ok: true, data: fn.apply(null, args) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    APP_CTX = null;
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Dipanggil saat login di aplikasi (sekaligus cek PIN)
function infoApp() {
  const cfg = aiConfig_();
  const lg = APP_CTX && APP_CTX.login ? APP_CTX.login : { mode: 'tim' };
  return { pegawai: daftarPegawai_(true), aiAktif: !!cfg, aiNama: cfg ? cfg.nama : '', lokasi: REKAP_LOKASI,
    login: { mode: lg.mode, nama: lg.nama || '', jabatan: lg.jabatan || '' } };
}

function fmtWaktu_(t) {
  return t instanceof Date ? Utilities.formatDate(t, REKAP_TZ, 'dd/MM/yyyy HH:mm') : String(t || '');
}

// Daftar semua aset + status inven (untuk tab Cari & Progres; dicari di HP, jadi cepat)
// item: [code, asset, sno, desc, lokasi, qtySistem, bun, costCenter, waktuTerakhir(ms), kondisi, qtyFisik, petugas, jumlahInput, linkFolder,
//        tglPerolehan, location]   (dipakai juga untuk cari aset saat OFFLINE)
function dataAset() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const d = ss.getSheetByName(SHEET_DATA).getDataRange().getDisplayValues();
  const H = d[0].map(function (h) { return String(h).trim(); });
  const col = function (n) { return H.indexOf(n); };
  const iA = col('Asset'), iS = col('SNo.'), iD = col('Asset description'), iL = col('Loc'), iQ = col('Quantity'), iB = col('BUn');
  const iT = col('Tanggal Perolehan') >= 0 ? col('Tanggal Perolehan') : (col('Cap.date') >= 0 ? col('Cap.date') : 3), iLoc = col('Location');

  const last = {};
  const log = ss.getSheetByName(SHEET_LOG);
  if (log && log.getLastRow() > 1) {
    const w = Math.min(15, log.getLastColumn());
    log.getRange(2, 1, log.getLastRow() - 1, w).getValues().forEach(function (x) {
      const k = key_(x[1]); if (!k) return;
      const t = x[0] instanceof Date ? x[0].getTime() : 0;
      const L = last[k];
      if (!L || t >= L.t) last[k] = { t: t, qf: String(x[4]), kd: String(x[5]), p: w >= 15 ? String(x[14] || '') : '', n: (L ? L.n : 0) + 1 };
      else L.n++;
    });
  }
  const url = {};
  const fs = ss.getSheetByName(SHEET_FOLDER);
  if (fs && fs.getLastRow() > 1) fs.getRange(2, 1, fs.getLastRow() - 1, 9).getDisplayValues().forEach(function (r) { if (r[0]) url[key_(r[0])] = r[8]; });

  const seen = {}, items = [];
  for (let r = 1; r < d.length; r++) {
    const code = String(d[r][0]).trim(), k = key_(code);
    if (!code || seen[k]) continue;
    seen[k] = 1;
    const L = last[k];
    items.push([code, iA < 0 ? '' : d[r][iA], iS < 0 ? '0' : (d[r][iS] || '0'), iD < 0 ? '' : d[r][iD],
      resolveLocation_(String(iL < 0 ? '' : d[r][iL]).trim()), iQ < 0 ? '' : d[r][iQ], iB < 0 ? '' : d[r][iB],
      String(d[r][COST_CENTER_COL - 1] || '').trim(),
      L ? L.t : 0, L ? L.kd : '', L ? L.qf : '', L ? L.p : '', L ? L.n : 0, url[k] || '',
      d[r][iT] || '', iLoc < 0 ? '' : d[r][iLoc]]);
  }
  return { waktu: Date.now(), lokasi: REKAP_LOKASI, items: items };
}

// Detail satu aset: data, riwayat input, dan file di folder Drive (foto/PDF tahun ini + hasil migrasi tahun lalu)
function detailAset(code) {
  const info = lookupCode(code);
  if (!info.found) return info;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const k = key_(info.code), riwayat = [];
  const log = ss.getSheetByName(SHEET_LOG);
  if (log && log.getLastRow() > 1) {
    const w = Math.min(15, log.getLastColumn());
    log.getRange(2, 1, log.getLastRow() - 1, w).getValues().forEach(function (x) {
      if (key_(x[1]) !== k) return;
      riwayat.push({ t: x[0] instanceof Date ? x[0].getTime() : 0, waktu: fmtWaktu_(x[0]), qtyFisik: String(x[4]), kondisi: String(x[5]),
        catatan: String(x[6]), cekAi: w >= 9 ? String(x[8]) : '', petugas: w >= 15 ? String(x[14] || '') : '' });
    });
  }
  riwayat.sort(function (a, b) { return b.t - a.t; });
  let files = [], folderUrl = '';
  const hit = folderIndex_(folderSheet_(ss))[info.code];
  if (hit && hit.id) {
    try {
      const f = DriveApp.getFolderById(hit.id);
      folderUrl = f.getUrl();
      const it = f.getFiles();
      while (it.hasNext() && files.length < 60) {
        const x = it.next();
        files.push({ id: x.getId(), nama: x.getName(), mime: x.getMimeType(), t: x.getDateCreated().getTime(),
          lama: /^migrasi:/.test(x.getDescription() || '') });
      }
    } catch (e) { /* folder tidak bisa dibuka */ }
  }
  files.sort(function (a, b) { return (a.lama - b.lama) || (b.t - a.t); });
  return { found: true, info: info, riwayat: riwayat, files: files, folderUrl: folderUrl };
}
