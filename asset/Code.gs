/**
 * Scan barcode inventaris -> data aset -> simpan PDF + foto ke Drive per lokasi
 * Spreadsheet: "invent 2026"
 *
 * Struktur Drive hasil:
 *   2026 > invent asset (ROOT)
 *     └ PLTD Ampenan
 *         └ PLTD Ampenan-1000010060-0
 *             ├ 1000010060-0.pdf
 *             └ foto-foto
 */

// ====== KONFIGURASI ======
const SPREADSHEET_ID = '18Dw3QtxsjVktj9etAHmn9c1Vr3RogD1Ns0E6eQSPc9Y';
const SHEET_DATA = 'ar01';       // sumber data (kolom A = Code / barcode)
const SHEET_LOG = 'hasil_scan';  // hasil input (dibuat otomatis)
const SHEET_FOLDER = 'folder_aset'; // daftar folder + link (dibuat otomatis oleh buatSemuaFolder)
// PIN halaman stiker untuk orang selain pemilik. Kosong '' = hanya pemilik. Contoh: '2026upkl'
const STIKER_PIN = 'UPKL';
const COST_CENTER_COL = 11;

// ====== VERIFIKASI FOTO DENGAN AI (Google Gemini atau Claude) ======
// API key TIDAK ditulis di sini. Simpan di: Setelan proyek (ikon ⚙) > Properti skrip:
//   GEMINI_API_KEY    = AIza...    (Google AI Studio, ada tingkat gratis)
//   ANTHROPIC_API_KEY = sk-ant-... (Claude, berbayar)
// Tanpa API key, form tetap jalan seperti biasa (cek AI tidak aktif).
const AI_PROVIDER = 'auto';             // 'auto' = Gemini bila GEMINI_API_KEY ada, selain itu Claude | 'gemini' | 'claude'
const GEMINI_THINKING = ['minimal', 'low'];   // dicoba berurutan: 'minimal' paling cepat; bila model tidak mendukung -> 'low' -> tanpa pengaturan
// Urutan model: yang ringan & cepat dulu. Untuk hasil lebih teliti (lebih lambat) taruh 'gemini-3.8-flash' paling depan.
const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash'];
                                        // dicoba berurutan; yang berhasil diingat. Model bisa berubah: cek ai.google.dev/gemini-api/docs/models
const AI_MODEL = 'claude-haiku-5-5';    // model Claude; lebih teliti (lebih mahal): 'claude-sonnet-5-5'
const AI_WAJIB = true;                 // true = foto harus lolos cek AI, atau isi alasan untuk tetap menyimpan
const REF_LALU_AKTIF = true;            // bandingkan foto baru dengan foto/PDF inventarisasi tahun lalu (hasil migrasi)
const REF_LALU_MAKS = 2;                // maks foto referensi tahun lalu yang dikirim ke AI
const KONDISI_LIST = ['BAIK 75-100%', 'CUKUP 50-74%', 'KURANG 25-49%', 'RUSAK 0-24%', 'TIDAK DITEMUKAN'];      // kolom K = Cost Center (ditampilkan setelah kode ditemukan)
const ROOT_FOLDER_ID = '1JX3Lo2j5bjZE_Ny33QCp2MbchGPHNB9N'; // 2026 > invent asset

// Nama folder lokasi. Dicocokkan dengan kolom "Loc" (tidak peka huruf besar/kecil).
// Jika Loc tidak ada di daftar ini, folder dibuat memakai nama Loc apa adanya.
const LOCATIONS = [
  'PLTD Ampenan', 'PLTMH Narmada', 'PLTD PAOKMOTONG', 'PLTS GILI AIR',
  'PLTS GILI MENO', 'PLTU JERANJANG', 'PLTMGU LOMBOK PEAKER', 'PLTM SANTONG',
  'PLTMH Pengga', 'PLTD Taman', 'PLTS GILI TRAWANGAN', 'UPK Lombok'
];

// Kolom yang ditampilkan di layar setelah scan (nama header baris 1). [] = semua kolom.
const SHOW_FIELDS = [
  'Asset description', 'Quantity', 'BUn', 'Acquis.val.', 'Book val.', 'Location', 'Loc'
];

const LOG_HEADERS = [
  'Waktu', 'Code', 'Asset description', 'Qty sistem',
  'Qty fisik', 'Kondisi', 'Catatan', 'Foto', 'Cek AI', 'Catatan AI', 'Koordinat', 'Akurasi (m)', 'Sumber lokasi', 'Rekomendasi AI',
  'Nama petugas', 'Email petugas', 'ID akun'
];

// ====== WEB APP ======
function doGet(e) {
  // ?code=XXXX dikirim oleh halaman pemindai (scanner.html) setelah barcode terbaca
  // ?page=stiker -> halaman pembuat PDF stiker (QR folder + barcode)
  if (e && e.parameter && e.parameter.page === 'stiker') {
    // halaman boleh dibuka; datanya dikunci di getStickerData (pemilik atau PIN)
    return HtmlService.createHtmlOutputFromFile('stiker')
      .setTitle('Cetak Stiker Aset')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  let code = String((e && e.parameter && e.parameter.code) || '').trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(code)) code = '';
  const t = HtmlService.createTemplateFromFile('index');
  t.initialCodeJson = JSON.stringify(code).replace(/</g, '\\u003c');
  // ?geo=lat,lng,akurasi dari halaman scanner (GPS saat barcode dipindai)
  let geo = String((e && e.parameter && e.parameter.geo) || '').trim();
  if (!/^-?\d{1,2}\.\d{1,8},-?\d{1,3}\.\d{1,8}(,\d{1,6})?$/.test(geo)) geo = '';
  t.initialGeo = geo;
  // Alamat web app (dipakai scanner.html untuk kembali ke aplikasi setelah barcode terbaca)
  let appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  if (!/^https:\/\/script\.google\.com\/[A-Za-z0-9\/_-]+$/.test(appUrl)) appUrl = '';
  t.appUrl = appUrl;
  t.userEmail = petugas_().email;
  return t.evaluate()
    .setTitle('Scan Inventaris')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ====== CARI DATA ======
function lookupCode(code) {
  code = String(code || '').trim();
  if (!code) return { found: false, message: 'Kode kosong.' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_DATA);
  if (!sh) return { found: false, message: 'Sheet "' + SHEET_DATA + '" tidak ditemukan.' };

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { found: false, message: 'Sheet kosong.' };

  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const codes = sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  const rowIdx = findRow_(codes, code);
  if (rowIdx === -1) return { found: false, message: 'Kode ' + code + ' tidak ada di kolom A (Code). Pastikan kode lengkap: Asset + SNo.' };

  const values = sh.getRange(rowIdx, 1, 1, lastCol).getDisplayValues()[0];
  code = String(values[0]).trim() || code;   // pakai Code resmi dari sheet (bukan teks scan mentah)
  const map = {};
  headers.forEach(function (h, i) { map[h] = values[i]; });

  const labels = SHOW_FIELDS.length ? SHOW_FIELDS : headers;
  const fields = labels
    .filter(function (h) { return h in map; })
    .map(function (h) { return { label: h, value: map[h] }; });

  const loc = String(map['Loc'] || '').trim();
  const lokasi = resolveLocation_(loc);
  const asset = String(map['Asset'] || '').trim();
  const prev = lastSubmission_(ss, code);
  const sno = String(map['SNo.'] === undefined ? '0' : map['SNo.']).trim() || '0';

  return {
    found: true,
    code: code,
    row: rowIdx,
    costCenter: String(values[COST_CENTER_COL - 1] || '').trim(),
    title: map['Asset description'] || '',
    asset: asset,
    sno: sno,
    bun: map['BUn'] || '',
    // kolom D (Tanggal Perolehan); fallback ke nama header lama 'Cap.date'
    tglPerolehan: map['Tanggal Perolehan'] || map['Cap.date'] || values[3] || '',
    qtySistem: map['Quantity'] || '',
    loc: loc,
    lokasi: lokasi,
    folderName: lokasi + '-' + asset + '-' + sno,
    previous: prev.last,
    previousCount: prev.count,
    fields: fields,
    aiAktif: !!aiConfig_(),
    aiNama: aiConfig_() ? aiConfig_().nama : ''
  };
}

// Cari baris HANYA di kolom A (Code = Asset + SNo digabung, mis. 1000010345 + 0 = 10000103450).
// (1) persis, (2) setelah dinormalkan (spasi/huruf besar/nol di depan). -1 = tidak ada.
function key_(s) {
  s = String(s || '').replace(/\s+/g, '').toUpperCase();
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}
function findRow_(codes, code) {
  for (let i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).trim() === code) return i + 2;
  }
  const k = key_(code);
  for (let i = 0; i < codes.length; i++) {
    if (key_(codes[i][0]) === k) return i + 2;
  }
  return -1;
}

function norm_(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function resolveLocation_(loc) {
  if (!loc) return 'Lainnya';
  const n = norm_(loc);
  for (let i = 0; i < LOCATIONS.length; i++) {
    if (norm_(LOCATIONS[i]) === n) return LOCATIONS[i];
  }
  return loc.replace(/[\\\/:*?"<>|]/g, '-');
}

// riwayat input kode ini di hasil_scan: waktu terakhir + berapa kali (untuk peringatan saja, tidak memblokir)
function lastSubmission_(ss, code) {
  const out = { last: '', count: 0 };
  const log = ss.getSheetByName(SHEET_LOG);
  if (!log || log.getLastRow() < 2) return out;
  const v = log.getRange(2, 1, log.getLastRow() - 1, 2).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (String(v[i][1]).trim() === code) {
      out.count++;
      if (!out.last) {
        const t = v[i][0];
        out.last = t instanceof Date
          ? Utilities.formatDate(t, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
          : String(t);
      }
    }
  }
  return out;
}

// ====== SIMPAN ======
// p: { code, qty, kondisi, catatan, photos: [{base64}], pdfBase64 }
// Qty fisik dan keterangan WAJIB diisi. Foto boleh kosong.
// Identitas akun Google pengimput.
// email : terisi bila akun pengimput satu domain dengan pemilik skrip (Workspace) atau web app dijalankan sebagai pengakses.
//         Untuk akun @gmail.com biasa (web app "Jalankan sebagai: Saya") Google tidak memberikan email -> kosong.
// key   : ID akun anonim dari Google (unik per akun, berganti tiap ±30 hari). Tetap terisi walau email kosong,
//         sehingga bisa dibedakan siapa yang menginput walau nama diketik berbeda.
// ===== DAFTAR PEGAWAI (untuk pilihan nama petugas) =====
// Sheet 'pegawai': baris 1 = judul (mis. Nama | NIP/Jabatan), mulai baris 2: kolom A nama lengkap, kolom B (opsional) info tambahan.
// Bila sheet kosong / tidak ada, nama petugas boleh diketik bebas.
const SHEET_PEGAWAI = 'pegawai';
// segar=true -> selalu baca langsung dari sheet (dipakai form saat dibuka & saat nama tidak ketemu di cache)
function daftarPegawai_(segar) {
  const cache = CacheService.getScriptCache();
  if (!segar) {
    const hit = cache.get('pegawai_v1');
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_PEGAWAI);
  let list = [];
  if (sh && sh.getLastRow() >= 2) {
    const seen = {};
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(2, sh.getLastColumn())).getDisplayValues().forEach(function (r) {
      const n = String(r[0] || '').replace(/\s+/g, ' ').trim();
      if (!n || seen[n.toUpperCase()]) return;
      seen[n.toUpperCase()] = 1;
      list.push([n, String(r[1] || '').trim()]);
    });
  }
  try { cache.put('pegawai_v1', JSON.stringify(list), 600); } catch (e) {}   // 10 menit
  return list;
}
// form selalu mengambil daftar terbaru -> pegawai baru langsung muncul tanpa deploy ulang
function getPegawai() { return daftarPegawai_(true); }
// (opsional) cek jumlah pegawai yang terbaca dari sheet
function segarkanPegawai() { Logger.log(daftarPegawai_(true).length + ' pegawai'); }

function petugas_() {
  // dipanggil lewat aplikasi HP (doPost): identitas = ID perangkat
  if (typeof APP_CTX !== 'undefined' && APP_CTX) return { email: '(aplikasi HP)', key: 'app-' + APP_CTX.device };   // dipanggil dari aplikasi HP (Api.gs)
  let email = '', key = '';
  try { email = String(Session.getActiveUser().getEmail() || ''); } catch (e) {}
  try { key = String(Session.getTemporaryActiveUserKey() || ''); } catch (e) {}
  return { email: email, key: key };
}

function saveScan(p) {
  p = p || {};
  const info = lookupCode(p.code);
  if (!info.found) throw new Error(info.message);
  if (p.qty === '' || p.qty == null || isNaN(Number(p.qty))) throw new Error('Qty fisik wajib diisi.');
  if (!String(p.catatan || '').trim()) throw new Error('Keterangan aset wajib diisi.');
  let namaPetugas = String(p.petugas || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!namaPetugas) throw new Error('Nama petugas wajib diisi.');
  const adaDiDaftar = function (list) { return list.some(function (x) { return x[0].toUpperCase() === namaPetugas.toUpperCase(); }); };
  if (p.petugasNon) {
    // non-pegawai / tulis nama sendiri: boleh, ditandai di hasil_scan
    if (namaPetugas.length < 3) throw new Error('Nama petugas terlalu pendek.');
    namaPetugas += ' (non-pegawai)';
  } else {
    let peg = daftarPegawai_();
    if (peg.length && !adaDiDaftar(peg)) peg = daftarPegawai_(true);   // mungkin pegawai baru -> baca ulang
    if (peg.length && !adaDiDaftar(peg)) {
      throw new Error('Nama petugas "' + namaPetugas + '" tidak ada di daftar pegawai. Tekan Ganti lalu pilih dari daftar atau pilih "tulis nama sendiri".');
    }
  }
  const akun = petugas_();
  const ai = p.ai || {};
  const perluAi = AI_WAJIB && !!aiConfig_() && p.kondisi !== 'TIDAK DITEMUKAN';
  if (perluAi && ai.status !== 'LOLOS' && !String(p.alasanLewati || '').trim()) {
    throw new Error('Foto belum lolos cek AI. Perbaiki foto, atau centang "Tetap simpan" dan isi alasannya.');
  }

  let hasil;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = typeof waktuInven_ === 'function' ? waktuInven_(p) : new Date();   // aplikasi offline: waktu saat diinput (Api.gs)
    const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');

    let root;
    try { root = DriveApp.getFolderById(ROOT_FOLDER_ID); }
    catch (e) { throw new Error('Folder tujuan Drive tidak bisa diakses. Cek ROOT_FOLDER_ID & izin.'); }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // Pakai folder yang sudah dibuat (sama dengan QR di stiker). Bila belum ada, buat dengan aturan yang sama.
    const folder = folderForAsset_(ss, root, info);
    const base = info.asset + '-' + info.sno;
    const jejak = 'inven:' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') +
      ' oleh ' + namaPetugas + (akun.email ? ' <' + akun.email + '>' : '') + (akun.key ? ' #' + akun.key.slice(0, 8) : '');

    // foto
    const photos = Array.isArray(p.photos) ? p.photos : [];
    let n = 0;
    photos.forEach(function (ph) {
      if (ph && ph.base64) {
        n++;
        folder.createFile(Utilities.newBlob(
          Utilities.base64Decode(ph.base64), 'image/jpeg', base + '_' + stamp + '_' + n + '.jpg'))
          .setDescription(jejak);
      }
    });

    // PDF: tidak ada yang dihapus/ditimpa. Input ulang -> "nama (2).pdf", "nama (3).pdf", dst.
    let pdfName = '';
    if (p.pdfBase64) {
      pdfName = nextPdfName_(folder, base);
      folder.createFile(Utilities.newBlob(
        Utilities.base64Decode(p.pdfBase64), 'application/pdf', pdfName)).setDescription(jejak);
    }

    // log di sheet hasil_scan
    let log = ss.getSheetByName(SHEET_LOG);
    if (!log) {
      log = ss.insertSheet(SHEET_LOG);
      log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
        .setFontWeight('bold').setBackground('#e8f0fe');
      log.setFrozenRows(1);
    }
    const row = log.getLastRow() + 1;
    const qty = (p.qty === '' || p.qty == null || isNaN(Number(p.qty))) ? '' : Number(p.qty);
    log.getRange(row, 2).setNumberFormat('@');
    log.getRange(row, 1, 1, 7).setValues([[
      now, info.code, info.title, info.qtySistem, qty, p.kondisi || '', p.catatan || ''
    ]]);
    log.getRange(row, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    log.getRange(row, 8).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(info.folderName).setLinkUrl(folder.getUrl()).build());
    // kolom hasil cek AI (header ditambahkan otomatis bila sheet lama belum punya)
    if (!log.getRange(1, 9).getValue()) {
      log.getRange(1, 9, 1, 2).setValues([['Cek AI', 'Catatan AI']]).setFontWeight('bold').setBackground('#e8f0fe');
    }
    let aiStatus = ai.status || (perluAi ? 'TIDAK DICEK' : (aiConfig_() ? 'TIDAK PERLU' : 'AI TIDAK AKTIF'));
    let aiNote = String(ai.ringkas || '');
    if (perluAi && ai.status !== 'LOLOS') {
      aiStatus = 'DILEWATI';
      aiNote = (aiNote ? aiNote + ' | ' : '') + 'Alasan petugas: ' + String(p.alasanLewati).trim();
    }
    log.getRange(row, 9, 1, 2).setValues([[aiStatus, aiNote.slice(0, 2000)]]);
    // geotag lokasi pengambilan foto
    if (!log.getRange(1, 11).getValue()) {
      log.getRange(1, 11, 1, 3).setValues([['Koordinat', 'Akurasi (m)', 'Sumber lokasi']]).setFontWeight('bold').setBackground('#e8f0fe');
    }
    const g = p.geo || {};
    const lat = Number(g.lat), lng = Number(g.lng);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
      const txt = lat.toFixed(6) + ', ' + lng.toFixed(6);
      log.getRange(row, 11).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(txt)
        .setLinkUrl('https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6)).build());
      log.getRange(row, 12, 1, 2).setValues([[isFinite(Number(g.acc)) && g.acc !== '' && g.acc != null ? Math.round(Number(g.acc)) : '', String(g.src || '').slice(0, 40)]]);
    } else {
      log.getRange(row, 11, 1, 3).setValues([['', '', 'Tidak ada (' + String(g.err || 'lokasi tidak didapat').slice(0, 80) + ')']]);
    }
    // rekomendasi AI (kondisi, keterangan, name plate, saran foto)
    if (!log.getRange(1, 14).getValue()) {
      log.getRange(1, 14).setValue('Rekomendasi AI').setFontWeight('bold').setBackground('#e8f0fe');
    }
    const rk = [];
    if (ai.kondisiUsulan) rk.push('Kondisi: ' + ai.kondisiUsulan + (p.kondisi ? (ai.kondisiUsulan === p.kondisi ? ' (sama dgn petugas)' : ' (petugas memilih ' + p.kondisi + ')') : ''));
    if (ai.keteranganUsulan) rk.push('Keterangan: ' + ai.keteranganUsulan);
    if (ai.nameplate) rk.push('Name plate: ' + ai.nameplate);
    if (ai.lalu) rk.push('Tahun lalu: ' + (ai.lalu === 'sama' ? 'barang SAMA' : ai.lalu === 'beda' ? 'BEDA barang' : 'diragukan') +
      (ai.bedaLalu ? ' (' + String(ai.bedaLalu).slice(0, 120) + ')' : '') + (ai.refNama ? ' – pembanding: ' + String(ai.refNama).slice(0, 200) : ''));
    if (Array.isArray(ai.saran) && ai.saran.length) rk.push('Saran foto: ' + ai.saran.join('; '));
    log.getRange(row, 14).setValue(rk.join('\n').slice(0, 3000) || (perluAi ? '-' : ''));
    log.getRange(row, 14).setWrap(true);
    // siapa yang menginput
    if (!log.getRange(1, 15).getValue()) {
      log.getRange(1, 15, 1, 3).setValues([['Nama petugas', 'Email petugas', 'ID akun']]).setFontWeight('bold').setBackground('#e8f0fe');
    }
    log.getRange(row, 15, 1, 3).setValues([[namaPetugas, akun.email || '(tidak diberikan Google)', akun.key ? akun.key.slice(0, 16) : '-']]);

    hasil = { ok: true, row: row, folderName: info.folderName, folderUrl: folder.getUrl(), photos: n, pdfName: pdfName };
  } finally {
    lock.releaseLock();
  }
  // sheet rekap_terkini langsung ikut diperbarui setiap ada isian baru (gagal di sini tidak membatalkan simpan)
  try { perbaruiRekapSheet(); } catch (e) {}
  return hasil;
}

// Nama PDF berikutnya: base.pdf, lalu base (2).pdf, base (3).pdf, ...
function nextPdfName_(folder, base) {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc + '(?: \\((\\d+)\\))?\\.pdf$');
  let max = 0;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const m = re.exec(it.next().getName());
    if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
  }
  return max === 0 ? base + '.pdf' : base + ' (' + (max + 1) + ').pdf';
}

function getOrCreate_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// ====================================================================
// ====== CEK FOTO DENGAN CLAUDE ======
// ====================================================================
function prop_(k) { return String(PropertiesService.getScriptProperties().getProperty(k) || '').trim(); }

// Penyedia AI yang aktif: { provider, key, nama } atau null
function aiConfig_() {
  const g = prop_('GEMINI_API_KEY'), c = prop_('ANTHROPIC_API_KEY');
  const pick = AI_PROVIDER === 'gemini' ? (g ? 'gemini' : '') : AI_PROVIDER === 'claude' ? (c ? 'claude' : '') : (g ? 'gemini' : c ? 'claude' : '');
  if (pick === 'gemini') return { provider: 'gemini', key: g, nama: 'Gemini' };
  if (pick === 'claude') return { provider: 'claude', key: c, nama: 'Claude' };
  return null;
}

// Kirim foto + perintah ke AI. Hasil: { text } atau { error }
function callAi_(cfg, photos, prompt) {
  return cfg.provider === 'gemini' ? callGemini_(cfg.key, photos, prompt) : callClaude_(cfg.key, photos, prompt);
}

// item: string base64 JPEG, atau { b64, mime, label } (mime boleh application/pdf)
function mediaItem_(x) { return typeof x === 'string' ? { b64: x, mime: 'image/jpeg', label: '' } : x; }

function callClaude_(key, photos, prompt) {
  const content = [];
  photos.map(mediaItem_).forEach(function (m) {
    if (m.label) content.push({ type: 'text', text: m.label });
    content.push(m.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.b64 } }
      : { type: 'image', source: { type: 'base64', media_type: m.mime, data: m.b64 } });
  });
  content.push({ type: 'text', text: prompt });
  let res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: content }] })
    });
  } catch (e) { return { error: 'Tidak bisa menghubungi Claude: ' + e.message }; }
  const http = res.getResponseCode(), body = res.getContentText();
  if (http !== 200) {
    let m = body;
    try { m = JSON.parse(body).error.message; } catch (e) {}
    const hint = http === 401 ? ' (API key salah)' : http === 400 && /credit|balance/i.test(m) ? ' (saldo API habis)' :
      http === 429 || http === 529 ? ' (layanan sibuk, coba lagi sebentar)' : '';
    return { error: 'Claude menolak permintaan [' + http + ']' + hint + ': ' + String(m).slice(0, 300) };
  }
  try {
    const jb = JSON.parse(body);
    return { text: (jb.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''),
      model: AI_MODEL, stop: jb.stop_reason || '' };
  } catch (e) { return { error: 'Jawaban Claude tidak terbaca.' }; }
}

function callGemini_(key, photos, prompt) {
  const parts = [];
  photos.map(mediaItem_).forEach(function (m) {
    if (m.label) parts.push({ text: m.label });
    parts.push({ inline_data: { mime_type: m.mime, data: m.b64 } });
  });
  parts.push({ text: prompt });
  const mk = function (level) {
    const gc = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
    if (level) gc.thinkingConfig = { thinkingLevel: level };
    return JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: gc });
  };
  // coba model yang terakhir berhasil dulu (hanya bila masih ada di GEMINI_MODELS), lalu daftar GEMINI_MODELS
  const memKey = 'GEMINI_MODEL_OK:' + GEMINI_MODELS.join(',');
  const last = GEMINI_MODELS.indexOf(prop_(memKey).split('|')[0]) >= 0 ? prop_(memKey).split('|')[0] : '';
  const lastLevel = last ? (prop_(memKey).split('|')[1] || '') : '';
  const models = (last ? [last] : []).concat(GEMINI_MODELS.filter(function (m) { return m !== last; }));
  let lastErr = '';
  for (let i = 0; i < models.length; i++) {
    let res, http, body, m;
    const levels = (models[i] === last && lastLevel ? [lastLevel] : []).concat(GEMINI_THINKING.filter(function (x) { return x !== lastLevel || models[i] !== last; }), ['']);
    let level = levels[0];
    for (let tryNo = 0; tryNo < levels.length; tryNo++) {
      level = levels[tryNo];
      try {
        res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { 'x-goog-api-key': key }, payload: mk(level)
        });
      } catch (e) { return { error: 'Tidak bisa menghubungi Gemini: ' + e.message }; }
      http = res.getResponseCode(); body = res.getContentText(); m = body;
      try { m = JSON.parse(body).error.message; } catch (e) {}
      // model tidak mendukung level thinking ini -> coba level berikutnya
      if (http === 400 && level && /thinking/i.test(m)) continue;
      break;
    }
    if (http === 200) {
      try {
        const j = JSON.parse(body);
        const c = (j.candidates || [])[0];
        if (!c || !c.content) return { error: 'Gemini tidak memberi jawaban' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (diblokir: ' + j.promptFeedback.blockReason + ')' : '') + '.' };
        const text = (c.content.parts || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('');
        if (last !== models[i] || lastLevel !== level) PropertiesService.getScriptProperties().setProperty(memKey, models[i] + '|' + level);
        return { text: text, model: models[i] + (level ? ', thinking ' + level : ''), stop: c.finishReason || '' };
      } catch (e) { return { error: 'Jawaban Gemini tidak terbaca.' }; }
    }
    // model tidak ada / tidak tersedia di tingkat gratis -> coba model berikutnya
    const modelIssue = http === 404 || (http === 429 && /limit:\s*0\b|free.?tier/i.test(m)) || (http === 400 && /model/i.test(m) && !/api key/i.test(m));
    lastErr = '[' + http + '] ' + String(m).slice(0, 250);
    if (modelIssue) continue;
    const hint = (http === 400 || http === 403) && /api key/i.test(m) ? ' (API key salah / belum aktif)' :
      http === 429 ? ' (batas pemakaian gratis tercapai, coba lagi beberapa menit lagi)' :
      http === 503 || http === 500 ? ' (layanan sibuk, coba lagi sebentar)' : '';
    return { error: 'Gemini menolak permintaan ' + lastErr.split(']')[0] + ']' + hint + ': ' + String(m).slice(0, 250) };
  }
  return { error: 'Tidak ada model Gemini yang bisa dipakai. Cek nama model di GEMINI_MODELS. Terakhir: ' + lastErr };
}

// Foto / PDF inventarisasi TAHUN LALU di folder aset (file hasil migrasi, deskripsi "migrasi:...")
// Hasil: [{ b64, mime, label, nama }]  (kosong bila tidak ada)
function ambilReferensiLalu_(info) {
  if (!REF_LALU_AKTIF) return [];
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const fs = ss.getSheetByName(SHEET_FOLDER);
    if (!fs) return [];
    const hit = folderIndex_(fs)[info.code];
    if (!hit || !hit.id) return [];
    const folder = DriveApp.getFolderById(hit.id);
    const imgs = [], pdfs = [];
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (!/^migrasi:/.test(f.getDescription() || '')) continue;
      const mime = f.getMimeType();
      if (/^image\//.test(mime)) imgs.push(f); else if (mime === 'application/pdf') pdfs.push(f);
    }
    imgs.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
    const out = [];
    imgs.slice(0, REF_LALU_MAKS).forEach(function (f) {
      // pakai gambar kecil (1024 px) dari Drive agar hemat; bila gagal pakai file asli (maks 3,5 MB)
      let blob = null;
      try {
        const r = UrlFetchApp.fetch('https://drive.google.com/thumbnail?sz=w1024&id=' + f.getId(),
          { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        if (r.getResponseCode() === 200 && /^image\/(jpeg|png|webp|gif)/.test(r.getBlob().getContentType())) blob = r.getBlob();
      } catch (e) {}
      if (!blob && f.getSize() <= 3.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)/.test(f.getMimeType())) blob = f.getBlob();
      if (blob) out.push({ b64: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType().split(';')[0], nama: f.getName() });
    });
    if (!out.length && pdfs.length && pdfs[0].getSize() <= 4 * 1024 * 1024) {
      out.push({ b64: Utilities.base64Encode(pdfs[0].getBlob().getBytes()), mime: 'application/pdf', nama: pdfs[0].getName() });
    }
    out.forEach(function (r, i) {
      r.label = 'REFERENSI TAHUN LALU ' + (i + 1) + (r.mime === 'application/pdf' ? ' (PDF laporan inventarisasi lama)' : ' (foto lama)') + ': ' + r.nama;
    });
    return out;
  } catch (e) { return []; }
}

// Dipanggil dari form sebelum menyimpan.
// p: { code, kondisi, catatan, photos: [base64 jpeg] }
function verifikasiFoto(p) {
  p = p || {};
  const cfg = aiConfig_();
  if (!cfg) return { ok: false, error: 'Cek AI belum aktif (API key belum diisi di Properti skrip).' };
  const info = lookupCode(p.code);
  if (!info.found) return { ok: false, error: info.message };
  const photos = (Array.isArray(p.photos) ? p.photos : []).filter(Boolean).slice(0, 6);
  if (!photos.length) {
    const g0 = ['Belum ada foto. Minimal foto sisi depan/keseluruhan dan sisi samping.'];
    return { ok: true, lolos: false, masalah: g0, gagal: g0, catatan: [],
      saran: ['Ambil foto sisi depan (aset terlihat utuh) dan sisi samping. Untuk mesin, foto juga name plate-nya.'],
      ringkas: 'Tidak ada foto' };
  }

  // Aturan tetap name plate (tidak bergantung AI):
  //   Cost Center berisi '#' + SNo 0  -> mesin utama, WAJIB name plate
  //   selain itu                       -> TIDAK perlu name plate
  const np = nameplateRule_(info);
  const npText = np === 'wajib'
    ? 'ATURAN TETAP: aset ini adalah MESIN (cost center "' + info.costCenter + '", sub number 0). WAJIB ada foto NAME PLATE pabrikan yang terbaca, ' +
      'walaupun nama asetnya tidak menyebut mesin. Foto name plate mesin utamanya.\n'
    : 'ATURAN TETAP: aset ini BUKAN mesin utama, TIDAK perlu foto name plate. Jangan sebut name plate di masalah/saran.\n';
  const refs = ambilReferensiLalu_(info);
  const media = photos.map(function (b64, i) { return { b64: b64, mime: 'image/jpeg', label: 'FOTO BARU ' + (i + 1) + ':' }; }).concat(refs);
  const refText = refs.length
    ? '6. Bandingkan FOTO BARU dengan REFERENSI TAHUN LALU (aset yang sama, nomor aset lama). Apakah barangnya SAMA ' +
      '(jenis, bentuk, merk/name plate, ciri khas)? Beda sudut/pencahayaan/kondisi wajar bukan berarti beda barang. ' +
      'Jawab "tidak" HANYA bila jelas barang lain. Kolom "foto" hanya untuk FOTO BARU.\n'
    : '';
  const prompt =
    'Anda pemeriksa foto inventarisasi aset PLN. Periksa ' + photos.length + ' FOTO BARU di atas untuk aset berikut:\n' +
    '- Nomor aset: ' + info.asset + '-' + info.sno + '\n' +
    '- Nama aset di data: ' + info.title + '\n' +
    '- Satuan: ' + info.bun + ', Qty sistem: ' + info.qtySistem + '\n' +
    '- Lokasi: ' + info.loc + ', Cost Center: ' + (info.costCenter || '-') + '\n' +
    '- Kondisi menurut petugas: ' + (p.kondisi || '-') + '\n' +
    '- Keterangan petugas: ' + (p.catatan || '-') + '\n\n' +
    'Aturan foto:\n' +
    '1. Kualitas: tiap foto harus cukup tajam, tidak terlalu gelap/silau, objek tidak terpotong.\n' +
    '2. Isi foto harus sesuai nama aset di data.\n' +
    '3. Minimal ada foto sisi DEPAN atau keseluruhan aset terlihat, DAN foto sisi SAMPING. ' +
    'Untuk tanah, gedung, jalan, pagar, atau aset luas lain: "samping" boleh berupa sudut pandang lain dari aset.\n' +
    '4. Name plate: ' + npText +
    '5. Usulkan kondisi berdasarkan yang terlihat, pilih salah satu: ' + KONDISI_LIST.join(' | ') + '.\n' + refText + '\n' +
    'Jawab HANYA dengan satu objek JSON (tanpa teks lain, tanpa ```), dengan kunci:\n' +
    '{"jenis":"mesin|bangunan|tanah|kendaraan|peralatan|lainnya",' +
    '"perlu_nameplate":true/false,"nameplate_terlihat":true/false,"nameplate_teks":"merk/tipe/serial yang terbaca atau \"\"",' +
    '"sisi_depan":true/false,"sisi_samping":true/false,"cocok":"ya|tidak|ragu",' +
    '"foto":[{"no":1,"kualitas":"baik|buram|gelap|silau|terpotong","isi":"maks 3 kata"}],' +
    '"masalah":["maks 5 kata, gaya catatan, mis. Foto samping tidak ada"],"saran":["maks 5 kata, mis. Foto name plate dari dekat"],' +
    '"kondisi_usulan":"salah satu pilihan kondisi","keterangan_usulan":"maks 8 kata, mis. Berfungsi, karat ringan"' +
    (refs.length ? ',"sama_dengan_lalu":"ya|tidak|ragu","beda_lalu":"maks 5 kata, kosong bila sama"' : '') + '}\n' +
    'Gaya bahasa: SANGAT RINGKAS, gaya catatan, tanpa kalimat panjang, tanpa basa-basi. masalah & saran maks 3 butir.';

  const t0 = Date.now();
  let out = callAi_(cfg, media, prompt);
  let r = out.error ? null : nilaiHasilAi_(out.text, info, photos.length, np, refs);
  // jawaban terpotong / bukan JSON -> coba sekali lagi dengan perintah lebih tegas & ringkas
  if (r && !r.ok && r.parseError) {
    const first = out;
    out = callAi_(cfg, media, prompt + '\n\nPENTING: jawaban sebelumnya tidak bisa dibaca. Balas HANYA satu objek JSON valid, ' +
      'tanpa teks lain, tanpa ```. Isi setiap teks maksimal 1 kalimat pendek.');
    r = out.error ? null : nilaiHasilAi_(out.text, info, photos.length, np, refs);
    if (r && !r.ok && r.parseError) {
      const stop = out.stop || first.stop;
      r.error = 'Jawaban AI tidak terbaca' + (/max_tokens|MAX_TOKENS/.test(stop) ? ' (terpotong, terlalu panjang)' : '') +
        '. Awal jawaban: "' + String(out.text || '').replace(/\s+/g, ' ').slice(0, 120) + '"';
    }
  }
  const detik = Math.round((Date.now() - t0) / 100) / 10;
  if (out.error) return { ok: false, error: out.error + ' (' + detik + ' dtk)' };
  if (r.ok) {
    r.ai = cfg.nama + ' (' + out.model + ')'; r.detik = detik;
    r.ringkas = '[' + cfg.nama + ', ' + detik + ' dtk] ' + r.ringkas;
  }
  return r;

}

// Ubah jawaban JSON Claude menjadi keputusan LOLOS / TIDAK LOLOS (aturan dicek ulang di sini, tidak hanya percaya AI)
function nameplateRule_(info) {
  const sno = String(info.sno == null ? '0' : info.sno).trim() || '0';
  if (sno === '0' && /#/.test(String(info.costCenter || ''))) return 'wajib';   // mesin utama
  return 'tidak';
}

// Baca JSON dari jawaban AI dengan toleran: buang ```json, ambil { ... } terluar, hapus koma berlebih
function parseJsonLoose_(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  t = t.slice(a, b + 1);
  const tries = [t, t.replace(/,\s*([}\]])/g, '$1'), t.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')];
  for (let i = 0; i < tries.length; i++) { try { return JSON.parse(tries[i]); } catch (e) {} }
  return null;
}

function nilaiHasilAi_(text, info, nFoto, np, refs) {
  refs = refs || [];
  const j = parseJsonLoose_(text);
  if (!j) return { ok: false, error: 'Jawaban AI bukan JSON yang valid.', parseError: true };
  j.perlu_nameplate = np === 'wajib';                    // aturan tetap mengalahkan penilaian AI
  const npRe = /name ?plate|nameplate|plat nama|label pabrik/i;
  let saran = (Array.isArray(j.saran) ? j.saran : []).map(String);
  if (np !== 'wajib') saran = saran.filter(function (x) { return !npRe.test(x); });
  const gagal = [];                                   // pelanggaran aturan wajib -> TIDAK LOLOS
  (Array.isArray(j.foto) ? j.foto : []).forEach(function (f) {
    if (Number(f.no) > nFoto) return;                   // abaikan bila AI ikut menilai foto referensi
    const q = String(f.kualitas || 'baik').toLowerCase();
    if (q !== 'baik') gagal.push('Foto ' + (f.no || '?') + ' ' + q);
  });
  if (String(j.cocok).toLowerCase() === 'tidak') gagal.push('Foto tidak sesuai aset');
  if (j.sisi_depan !== true) gagal.push('Foto depan tidak ada');
  if (j.sisi_samping !== true) gagal.push('Foto samping tidak ada');
  if (j.perlu_nameplate === true && j.nameplate_terlihat !== true) {
    gagal.push('Name plate tidak ada (mesin utama)');
    if (!saran.some(function (x) { return /name ?plate/i.test(x); })) saran.push('Foto name plate dari dekat');
  }
  // catatan tambahan dari AI (tidak memblokir); buang yang sama maknanya dengan daftar gagal
  const key = function (x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const sudah = gagal.map(key);
  const catatan = [];
  (Array.isArray(j.masalah) ? j.masalah : []).forEach(function (x) {
    x = String(x).trim().replace(/\.$/, '');
    const k = key(x);
    const dobel = sudah.some(function (g) { return g === k || g.indexOf(k) >= 0 || k.indexOf(g) >= 0; }) ||
      (/name ?plate|nameplate/i.test(x) && sudah.some(function (g) { return g.indexOf('nameplate') >= 0; })) ||
      (/samping/i.test(x) && sudah.indexOf('fotosampingtidakada') >= 0) || (/depan/i.test(x) && sudah.indexOf('fotodepantidakada') >= 0);
    if (np !== 'wajib' && npRe.test(x)) return;          // bukan mesin utama: abaikan catatan soal name plate
    if (x && !dobel && catatan.length < 3) catatan.push(x);
  });
  if (String(j.cocok).toLowerCase() === 'ragu') catatan.push('Kecocokan foto diragukan');
  // perbandingan dengan tahun lalu
  let lalu = '';
  if (refs.length) {
    const sl = String(j.sama_dengan_lalu || '').toLowerCase();
    lalu = sl === 'ya' ? 'sama' : sl === 'tidak' ? 'beda' : 'ragu';
    if (lalu === 'beda') gagal.push('Beda dengan foto tahun lalu' + (j.beda_lalu ? ': ' + String(j.beda_lalu).slice(0, 60) : ''));
    if (lalu === 'ragu') catatan.push('Kemiripan dgn tahun lalu diragukan');
  }
  const aturanGagal = gagal.length > 0;
  const masalah = gagal.concat(catatan);
  const kondisi = KONDISI_LIST.indexOf(String(j.kondisi_usulan)) >= 0 ? String(j.kondisi_usulan) : '';
  const ringkas = (aturanGagal ? 'TIDAK LOLOS: ' + gagal.join(', ') : 'LOLOS') +
    (j.nameplate_teks ? ' | Name plate: ' + String(j.nameplate_teks).slice(0, 120) : '') +
    (kondisi ? ' | Kondisi: ' + kondisi : '') +
    (lalu ? ' | Tahun lalu: ' + lalu : '');
  return {
    ok: true, lolos: !aturanGagal, masalah: masalah, gagal: gagal, catatan: catatan, saran: saran.slice(0, 3),
    jenis: String(j.jenis || ''), nameplate: String(j.nameplate_teks || ''),
    cocok: String(j.cocok || ''), kondisiUsulan: kondisi, keteranganUsulan: String(j.keterangan_usulan || ''),
    nFoto: nFoto, ringkas: ringkas,
    lalu: lalu, bedaLalu: lalu === 'beda' ? String(j.beda_lalu || '').slice(0, 120) : '',
    refNama: refs.map(function (r) { return r.nama; }).join(', ')
  };
}

// Jalankan dari editor untuk menguji API key (tanpa foto)
function tesKoneksiAI() {
  const cfg = aiConfig_();
  if (!cfg) { Logger.log('API key belum diisi. Setelan proyek > Properti skrip > GEMINI_API_KEY (atau ANTHROPIC_API_KEY)'); return; }
  const out = cfg.provider === 'gemini'
    ? callGemini_(cfg.key, [], 'Balas hanya dengan JSON: {"status":"koneksi OK"}')
    : callClaude_(cfg.key, [], 'Balas: koneksi OK');
  Logger.log(out.error ? 'GAGAL (' + cfg.nama + '): ' + out.error : 'BERHASIL (' + cfg.nama + ', model ' + out.model + '): ' + String(out.text).slice(0, 200));
}

// ====================================================================
// ====== FOLDER PER ASET (dibuat sekaligus sebelum inventarisasi) ======
// ====================================================================
// Struktur: ROOT (invent asset) > Lokasi > Lokasi-Asset-SNo
// Daftar folder + link disimpan di sheet "folder_aset" (dipakai form & halaman stiker).
const FOLDER_HEADERS = ['Code', 'Asset', 'SNo.', 'Asset description', 'Loc', 'Folder lokasi',
  'Nama folder', 'Folder ID', 'Link folder', 'Dibuat'];

function folderSheet_(ss) {
  let fs = ss.getSheetByName(SHEET_FOLDER);
  if (!fs) {
    fs = ss.insertSheet(SHEET_FOLDER);
    fs.getRange(1, 1, 1, FOLDER_HEADERS.length).setValues([FOLDER_HEADERS])
      .setFontWeight('bold').setBackground('#e8f0fe');
    fs.setFrozenRows(1);
    fs.getRange('A:C').setNumberFormat('@');   // kode tetap teks (nol di depan tidak hilang)
  }
  return fs;
}

// Peta Code -> { row, id, url, name }
function folderIndex_(fs) {
  const map = {};
  const n = fs.getLastRow() - 1;
  if (n < 1) return map;
  const v = fs.getRange(2, 1, n, 9).getDisplayValues();
  for (let i = 0; i < v.length; i++) {
    const code = String(v[i][0]).trim();
    if (code && v[i][7]) map[code] = { row: i + 2, name: v[i][6], id: v[i][7], url: v[i][8] };
  }
  return map;
}

// Folder lokasi + isi sub-folder yang sudah ada (agar tidak membuat folder ganda)
function loadLoc_(root, lokasi) {
  const folder = getOrCreate_(root, lokasi);
  const children = {};
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (!(f.getName() in children)) children[f.getName()] = f;
  }
  return { folder: folder, children: children };
}

// Dipakai saveScan: ambil folder dari folder_aset, atau buat bila belum ada
function folderForAsset_(ss, root, info) {
  const fs = folderSheet_(ss);
  const hit = folderIndex_(fs)[info.code];
  if (hit && hit.id) {
    try {
      const f = DriveApp.getFolderById(hit.id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* folder terhapus -> buat ulang di bawah */ }
  }
  const locFolder = getOrCreate_(root, info.lokasi);
  const folder = getOrCreate_(locFolder, info.folderName);
  const rowVals = [info.code, info.asset, info.sno, info.title, info.loc, info.lokasi,
    info.folderName, folder.getId(), folder.getUrl(), new Date()];
  if (hit) fs.getRange(hit.row, 1, 1, rowVals.length).setValues([rowVals]);
  else fs.appendRow(rowVals);
  return folder;
}

// ===== JALANKAN DARI EDITOR: buat folder untuk SEMUA aset di sheet ar01 =====
// Aman dijalankan berkali-kali: aset yang sudah punya folder dilewati.
// Bila datanya banyak (> ~6 menit), skrip berhenti sendiri lalu lanjut otomatis 1 menit kemudian.
function buatSemuaFolder() {
  const t0 = Date.now();
  const LIMIT_MS = 4.5 * 60 * 1000;
  hapusTrigger_('buatSemuaFolder');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_DATA);
  if (!sh) throw new Error('Sheet "' + SHEET_DATA + '" tidak ditemukan.');
  const data = sh.getDataRange().getDisplayValues();
  const H = data[0].map(function (h) { return String(h).trim(); });
  const iA = H.indexOf('Asset'), iS = H.indexOf('SNo.'), iD = H.indexOf('Asset description'), iL = H.indexOf('Loc');
  if (iA < 0 || iL < 0) throw new Error('Header "Asset" / "Loc" tidak ditemukan di baris 1 sheet ' + SHEET_DATA + '.');

  const fs = folderSheet_(ss);
  const idx = folderIndex_(fs);
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const locCache = {};
  const seen = {};
  let pending = [], dibuat = 0, sudah = 0, kosong = 0, sisa = 0;

  const flush = function () {
    if (!pending.length) return;
    fs.getRange(fs.getLastRow() + 1, 1, pending.length, FOLDER_HEADERS.length).setValues(pending);
    pending = [];
  };

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const code = String(row[0]).trim();
    const asset = String(row[iA]).trim();
    if (!code || !asset) { kosong++; continue; }
    if (seen[code]) continue;
    seen[code] = true;
    if (idx[code]) { sudah++; continue; }
    if (Date.now() - t0 > LIMIT_MS) { sisa++; continue; }

    const sno = (iS < 0 ? '0' : String(row[iS]).trim()) || '0';
    const loc = String(row[iL]).trim();
    const lokasi = resolveLocation_(loc);
    const name = lokasi + '-' + asset + '-' + sno;      // aturan sama dengan lookupCode()
    const lc = locCache[lokasi] || (locCache[lokasi] = loadLoc_(root, lokasi));
    let f = lc.children[name];
    if (!f) { f = lc.folder.createFolder(name); lc.children[name] = f; }
    pending.push([code, asset, sno, iD < 0 ? '' : row[iD], loc, lokasi, name, f.getId(), f.getUrl(), new Date()]);
    dibuat++;
    if (pending.length >= 25) flush();
  }
  flush();

  if (sisa > 0) {
    ScriptApp.newTrigger('buatSemuaFolder').timeBased().after(60 * 1000).create();
    Logger.log('Dibuat ' + dibuat + ' folder. Masih ada ' + sisa + ' aset, lanjut otomatis dalam 1 menit (biarkan saja).');
  } else {
    Logger.log('SELESAI. Dibuat ' + dibuat + ' folder baru, ' + sudah + ' sudah ada, ' + kosong + ' baris kosong dilewati. ' +
      'Daftar link ada di sheet "' + SHEET_FOLDER + '".');
  }
}

function hapusTrigger_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
}

// Hanya pemilik skrip (akun yang men-deploy) yang boleh membuka halaman stiker.
// Pengunjung lain / anonim: getActiveUser() kosong atau berbeda -> ditolak.
function isOwner_() {
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const user = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!me && me === user;
}

// ===== Data untuk halaman stiker (dipanggil dari stiker.html) =====
function getStickerData(pin) {
  const pinOk = STIKER_PIN !== '' && String(pin || '') === String(STIKER_PIN);
  if (!isOwner_() && !pinOk) throw new Error(pin ? 'PIN_SALAH' : 'PIN_DIPERLUKAN');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const fs = ss.getSheetByName(SHEET_FOLDER);
  if (!fs || fs.getLastRow() < 2) return { items: [], message: 'Sheet "' + SHEET_FOLDER + '" masih kosong. Jalankan buatSemuaFolder dulu.' };

  // data terbaru dari ar01 (deskripsi/lokasi bisa berubah setelah folder dibuat)
  const cur = {};
  const sh = ss.getSheetByName(SHEET_DATA);
  if (sh && sh.getLastRow() > 1) {
    const d = sh.getDataRange().getDisplayValues();
    const H = d[0].map(function (h) { return String(h).trim(); });
    const iD = H.indexOf('Asset description'), iL = H.indexOf('Loc');
    for (let r = 1; r < d.length; r++) {
      const c = String(d[r][0]).trim();
      if (c && !(c in cur)) cur[c] = { desc: iD < 0 ? '' : d[r][iD], loc: iL < 0 ? '' : d[r][iL], cc: d[r][COST_CENTER_COL - 1] || '' };
    }
  }
  const v = fs.getRange(2, 1, fs.getLastRow() - 1, FOLDER_HEADERS.length).getDisplayValues();
  const items = [];
  v.forEach(function (r) {
    const code = String(r[0]).trim();
    if (!code || !r[8]) return;
    const c = cur[code] || {};
    items.push({
      code: code, asset: r[1], sno: r[2] || '0',
      desc: c.desc || r[3], loc: c.loc || r[4], lokasi: r[5], cc: c.cc || '',
      url: r[8], inData: !!cur[code]
    });
  });
  items.sort(function (a, b) { return a.lokasi < b.lokasi ? -1 : a.lokasi > b.lokasi ? 1 : (a.code < b.code ? -1 : a.code > b.code ? 1 : 0); });
  return { items: items };
}

// ====================================================================
// ====== MIGRASI FILE INVENTARIS LAMA (nomor aset lama -> baru) ======
// ====================================================================
// 1. Buat sheet "mapping_lama": kolom A = kode lama (Gab Aset No dan Sub No),
//    kolom B = kode baru (Code di ar01). Baris 1 = judul. Tempel sebagai NILAI.
// 2. Jalankan migrasiFileLama() dari editor. Lanjut otomatis tiap menit sampai selesai.
// ISI folder lama (file, termasuk yang di sub-folder) disalin LANGSUNG ke folder aset baru
// (folder yang sama dengan QR stiker), bukan foldernya. Folder lama tidak ditemukan -> dilewati.
// Hasil: per folder lama di "migrasi_log", dan per baris mapping di kolom C-E "mapping_lama".
const OLD_ROOT_FOLDER_ID = '1S-87PtbnbJdL8FE7bu5ZnfOJJjxCoEqX'; // KU UPKL > Bank Data Aset (folder lama)
const SHEET_MAP = 'mapping_lama';
const SHEET_MIG = 'migrasi_log';
const MIG_MODE = 'salin';              // 'salin' = file lama tetap ada (aman) | 'pindah' = file dipindah
const MIG_HEADERS = ['Folder lama ID', 'Nama folder lama', 'Kode lama', 'Kode baru', 'Status',
  'Folder baru', 'Jumlah file', 'Waktu'];

function migSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_MIG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_MIG);
    sh.getRange(1, 1, 1, MIG_HEADERS.length).setValues([MIG_HEADERS]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    sh.getRange('A:D').setNumberFormat('@');
  }
  return sh;
}

// Nama folder lama "UPK Lmbk-1000032996-0" -> kode lama "10000329960"
function oldCodeFromName_(name) {
  const m = /(\d{6,})\s*-\s*(\d{1,4})\s*$/.exec(String(name));
  return m ? m[1] + m[2] : '';
}

// Cari semua folder aset lama (nama berakhiran -nomorAset-sub) di bawah folder lama, sampai 4 tingkat
function scanOld_(folder, depth, out) {
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const code = oldCodeFromName_(f.getName());
    if (code) out.push([f.getId(), f.getName(), code]);
    else if (depth < 4) scanOld_(f, depth + 1, out);
  }
}

function mappingLama_(ss) {
  const sh = ss.getSheetByName(SHEET_MAP);
  if (!sh || sh.getLastRow() < 2) throw new Error('Sheet "' + SHEET_MAP + '" belum ada / kosong. Isi kolom A = kode lama, B = kode baru.');
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
  const map = {};
  v.forEach(function (r) {
    const a = key_(r[0]), b = String(r[1]).trim();
    if (a && b && !/^#/.test(b) && !(a in map)) map[a] = b;   // lewati #N/A dan duplikat
  });
  return map;
}

// Tanda di deskripsi file hasil migrasi: "migrasi:<ID file asal>" -> aman dijalankan ulang (tidak dobel)
function migratedIds_(dst) {
  const ids = {}, names = {};
  const it = dst.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    names[f.getName()] = true;
    const m = /migrasi:([\w-]+)/.exec(f.getDescription() || '');
    if (m) ids[m[1]] = true;
  }
  return { ids: ids, names: names };
}

// Salin/pindah SEMUA file dari folder lama (termasuk isi sub-folder) LANGSUNG ke folder baru.
// Nama bentrok -> diberi akhiran "(lama <kode>)" agar tidak menimpa / tertukar.
function copyContents_(src, dst, oldLabel, seen) {
  seen = seen || migratedIds_(dst);
  let n = 0;
  const files = src.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const id = f.getId();
    if (seen.ids[id]) continue;                         // sudah pernah disalin
    let name = f.getName();
    if (seen.names[name]) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? name.slice(0, dot) + ' (lama ' + oldLabel + ')' + name.slice(dot) : name + ' (lama ' + oldLabel + ')';
    }
    const c = MIG_MODE === 'pindah' ? (f.moveTo(dst), f) : f.makeCopy(name, dst);
    if (MIG_MODE === 'pindah' && name !== f.getName()) f.setName(name);
    c.setDescription('migrasi:' + id + ' dari ' + src.getName());
    seen.ids[id] = true; seen.names[name] = true;
    n++;
  }
  const subs = src.getFolders();
  while (subs.hasNext()) n += copyContents_(subs.next(), dst, oldLabel, seen);
  return n;
}

// Tulis hasil ke sheet mapping_lama kolom C-E (per kode lama)
function migrasiLaporan() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const mp = ss.getSheetByName(SHEET_MAP);
  if (!mp || mp.getLastRow() < 2) return;
  const agg = {};
  const log = migSheet_(ss);
  if (log.getLastRow() > 1) {
    log.getRange(2, 1, log.getLastRow() - 1, 7).getDisplayValues().forEach(function (r) {
      const k = key_(r[2]);
      const a = agg[k] || (agg[k] = { st: [], link: '', n: 0 });
      a.st.push(r[4]); if (r[5]) a.link = r[5]; a.n += Number(r[6]) || 0;
    });
  }
  const v = mp.getRange(2, 1, mp.getLastRow() - 1, 2).getDisplayValues();
  const out = v.map(function (r) {
    const k = key_(r[0]);
    if (!k) return ['', '', ''];
    const b = String(r[1]).trim();
    if (!b || /^#/.test(b)) return ['KODE BARU KOSONG / #N/A', '', ''];
    const a = agg[k];
    if (!a) return ['DILEWATI: folder lama tidak ditemukan', '', ''];
    if (a.st.indexOf('ANTRI') >= 0) return ['MENUNGGU', a.link, a.n];
    const bad = a.st.filter(function (x) { return x !== 'SELESAI'; });
    if (bad.length) return [bad[0], a.link, a.n];
    return [a.n ? 'SELESAI' : 'SELESAI (folder lama kosong)', a.link, a.n];
  });
  mp.getRange(1, 3, 1, 3).setValues([['Status migrasi', 'Folder baru', 'Jumlah file']]).setFontWeight('bold');
  mp.getRange(2, 3, out.length, 3).setValues(out);
}

// ===== JALANKAN DARI EDITOR =====
function migrasiFileLama() {
  const t0 = Date.now();
  const LIMIT_MS = 4.5 * 60 * 1000;
  hapusTrigger_('migrasiFileLama');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const map = mappingLama_(ss);
  const log = migSheet_(ss);

  // Tahap 1 (sekali): daftar semua folder lama ke migrasi_log
  if (log.getLastRow() < 2) {
    const found = [];
    scanOld_(DriveApp.getFolderById(OLD_ROOT_FOLDER_ID), 0, found);
    if (!found.length) { Logger.log('Tidak ada folder aset lama ditemukan.'); return; }
    log.getRange(2, 1, found.length, 5).setValues(found.map(function (r) { return [r[0], r[1], r[2], '', 'ANTRI']; }));
    Logger.log('Ditemukan ' + found.length + ' folder aset lama. Mulai menyalin…');
  }

  // Tahap 2: proses baris berstatus ANTRI
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const rows = log.getRange(2, 1, log.getLastRow() - 1, 5).getDisplayValues();
  let ok = 0, gagal = 0, sisa = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][4] !== 'ANTRI') continue;
    if (Date.now() - t0 > LIMIT_MS) { sisa++; continue; }
    const r = i + 2, oldId = rows[i][0], oldName = rows[i][1], oldCode = rows[i][2];
    let status, link = '', n = '', baru = map[key_(oldCode)] || '';
    try {
      if (!baru) throw new Error('kode lama tidak ada di ' + SHEET_MAP);
      const info = lookupCode(baru);
      if (!info.found) throw new Error('kode baru ' + baru + ' tidak ada di ' + SHEET_DATA);
      const target = folderForAsset_(ss, root, info);          // folder yang sama dengan QR stiker
      const lbl = oldCode.slice(0, -1) + '-' + oldCode.slice(-1);
      n = copyContents_(DriveApp.getFolderById(oldId), target, oldName.replace(/^.*?(\d{6,}\s*-\s*\d+)\s*$/, '$1') || lbl);
      link = target.getUrl(); baru = info.code; status = 'SELESAI'; ok++;
    } catch (e) {
      status = 'GAGAL: ' + (e && e.message ? e.message : e); gagal++;
    }
    log.getRange(r, 4, 1, 5).setValues([[baru, status, link, n, new Date()]]);
  }

  migrasiLaporan();
  if (sisa > 0) {
    ScriptApp.newTrigger('migrasiFileLama').timeBased().after(60 * 1000).create();
    Logger.log('Run ini: ' + ok + ' selesai, ' + gagal + ' gagal. Sisa ' + sisa + ' folder, lanjut otomatis 1 menit lagi.');
  } else {
    Logger.log('MIGRASI SELESAI. Run terakhir: ' + ok + ' selesai, ' + gagal + ' gagal. Cek sheet "' + SHEET_MIG +
      '" dan kolom C-E sheet "' + SHEET_MAP + '". Perbaiki mapping/ar01 lalu jalankan migrasiCobaLagiGagal().');
  }
}

// Setelah memperbaiki mapping_lama / ar01: ulangi baris GAGAL
function migrasiCobaLagiGagal() {
  const log = migSheet_(SpreadsheetApp.openById(SPREADSHEET_ID));
  if (log.getLastRow() < 2) return;
  const rng = log.getRange(2, 5, log.getLastRow() - 1, 1);
  const v = rng.getValues().map(function (r) { return [/^GAGAL/.test(String(r[0])) ? 'ANTRI' : r[0]]; });
  rng.setValues(v);
  migrasiFileLama();
}

// Folder lama ditambah setelah migrasi? Jalankan ini untuk mendaftarkan folder yang belum tercatat, lalu memproses.
function migrasiPindaiUlang() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const log = migSheet_(ss);
  const have = {};
  if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().forEach(function (r) { have[r[0]] = true; });
  const found = [];
  scanOld_(DriveApp.getFolderById(OLD_ROOT_FOLDER_ID), 0, found);
  const baru = found.filter(function (r) { return !have[r[0]]; });
  if (baru.length) log.getRange(log.getLastRow() + 1, 1, baru.length, 5).setValues(baru.map(function (r) { return [r[0], r[1], r[2], '', 'ANTRI']; }));
  Logger.log(baru.length + ' folder lama baru didaftarkan.');
  migrasiFileLama();
}

// ====================================================================
// ====== REKAP INVENTARIS OTOMATIS KE GRUP WHATSAPP (Fonnte) ======
// ====================================================================
// Simpan di Setelan proyek > Properti skrip:
//   FONNTE_TOKEN = token device dari fonnte.com (boleh token device yang sama dengan skrip lain)
//   WA_GROUP_ID  = tujuan: nomor (mis. 081234567890) untuk tes, atau ID grup 120363...@g.us (cari dengan cariGrupWA)
// Jalankan sekali: pasangJadwalRekap  -> kirim otomatis tiap hari jam REKAP_JAM (WITA)
const REKAP_JAM = [8, 17];               // laporan WA berisi data s.d. 07.59.59 dan 16.59.59 WITA
const REKAP_TZ = 'Asia/Makassar';
const SHEET_REKAP = 'rekap_inven';
const REKAP_LOKASI = [
  'PLTD Ampenan', 'PLTMH Narmada', 'PLTD PAOKMOTONG', 'PLTS GILI AIR', 'PLTS GILI MENO', 'PLTU JERANJANG',
  'PLTMGU LOMBOK PEAKER', 'PLTM SANTONG', 'PLTMH Pengga', 'PLTD Taman', 'UPK Lombok', 'PLTS GILI TRAWANGAN'
];
const REKAP_HEADERS = ['Data s.d.', 'Lokasi', 'Total aset', 'Sudah inven', 'Belum inven', '% sudah', 'Status kirim WA'];
const SHEET_REKAP_KINI = 'rekap_terkini';

// Hitung rekap per lokasi: total aset di ar01 vs kode unik yang sudah ada di hasil_scan
function hitungRekap_(sejak, sampai) {   // sampai = batas waktu data (ms); kosong = semua data
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_DATA);
  const d = sh.getDataRange().getDisplayValues();
  const H = d[0].map(function (h) { return String(h).trim(); });
  const iL = H.indexOf('Loc');
  const lokasiKode = {};                       // kode -> nama lokasi rekap
  const rows = {};
  REKAP_LOKASI.forEach(function (l) { rows[norm_(l)] = { lokasi: l, total: 0, sudah: 0, baru: 0 }; });
  for (let r = 1; r < d.length; r++) {
    const code = String(d[r][0]).trim();
    if (!code || code in lokasiKode) continue;
    const lok = resolveLocation_(String(iL < 0 ? '' : d[r][iL]).trim());
    const k = norm_(lok);
    if (!rows[k]) rows[k] = { lokasi: lok, total: 0, sudah: 0, baru: 0 };   // lokasi di luar daftar -> baris tambahan
    rows[k].total++;
    lokasiKode[code] = k;
  }
  // scan pertama per kode
  const first = {};
  const log = ss.getSheetByName(SHEET_LOG);
  if (log && log.getLastRow() > 1) {
    const v = log.getRange(2, 1, log.getLastRow() - 1, 2).getValues();
    v.forEach(function (x) {
      const c = String(x[1]).trim(), t = x[0] instanceof Date ? x[0].getTime() : NaN;
      if (!c || !(c in lokasiKode)) return;
      if (!(c in first) || (isFinite(t) && t < first[c])) first[c] = isFinite(t) ? t : 0;
    });
  }
  Object.keys(first).forEach(function (c) {
    if (sampai && first[c] > sampai) return;          // diinput setelah batas waktu laporan -> belum dihitung
    const row = rows[lokasiKode[c]];
    row.sudah++;
    if (sejak && first[c] > sejak) row.baru++;
  });
  const list = Object.keys(rows).map(function (k) { return rows[k]; })
    .filter(function (r) { return r.total > 0 || REKAP_LOKASI.indexOf(r.lokasi) >= 0; });
  list.sort(function (a, b) {
    const ia = REKAP_LOKASI.indexOf(a.lokasi), ib = REKAP_LOKASI.indexOf(b.lokasi);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const tot = { lokasi: 'TOTAL', total: 0, sudah: 0, baru: 0 };
  list.forEach(function (r) { tot.total += r.total; tot.sudah += r.sudah; tot.baru += r.baru; });
  return { list: list, total: tot };
}

function pct_(a, b) { return b ? (Math.round(a / b * 1000) / 10).toFixed(1).replace('.', ',') + '%' : '-'; }

// Batas data laporan: jam laporan terakhir yang sudah lewat, dikurangi 1 detik (mis. 07.59.59 / 16.59.59 WITA)
function batasRekap_(now) {
  const hariIni = Utilities.formatDate(now, REKAP_TZ, 'yyyy-MM-dd');
  const kemarin = Utilities.formatDate(new Date(now.getTime() - 86400000), REKAP_TZ, 'yyyy-MM-dd');
  let best = null;
  [kemarin, hariIni].forEach(function (tgl) {
    REKAP_JAM.forEach(function (h) {
      const t = new Date(tgl + 'T' + ('0' + h).slice(-2) + ':00:00+08:00').getTime() - 1000;
      if (t <= now.getTime() && (!best || t > best)) best = t;
    });
  });
  return new Date(best);
}

function formatRekapWA_(rk, now, label) {
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const dow = Number(Utilities.formatDate(now, REKAP_TZ, 'u')) % 7;
  const tgl = HARI[dow] + ', ' + Number(Utilities.formatDate(now, REKAP_TZ, 'd')) + ' ' +
    BLN[Number(Utilities.formatDate(now, REKAP_TZ, 'M')) - 1] + ' ' + Utilities.formatDate(now, REKAP_TZ, 'yyyy');
  const jam = Utilities.formatDate(now, REKAP_TZ, 'HH.mm');
  const lines = [];
  lines.push('*📊 REKAP INVENTARISASI ASET 2026*' + (label ? ' _(' + label + ')_' : ''));
  lines.push('Data s.d. ' + tgl + ' · ' + jam + ' WITA');
  lines.push('');
  rk.list.forEach(function (r) {
    const done = r.total > 0 && r.sudah >= r.total;
    lines.push((done ? '✅ ' : '▫️ ') + r.lokasi + ' — ' + r.sudah + '/' + r.total + ' (' + pct_(r.sudah, r.total) + ')');
  });
  const t = rk.total;
  lines.push('');
  lines.push('*TOTAL — ' + t.sudah + '/' + t.total + ' (' + pct_(t.sudah, t.total) + ')*');
  return lines.join('\n');
}

function kirimWA_(message) {
  const token = prop_('FONNTE_TOKEN'), target = prop_('WA_GROUP_ID');
  if (!token) return { ok: false, info: 'FONNTE_TOKEN belum diisi di Properti skrip' };
  if (!target) return { ok: false, info: 'WA_GROUP_ID belum diisi di Properti skrip' };
  try {
    const res = UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method: 'post', muteHttpExceptions: true,
      headers: { Authorization: token },
      payload: { target: /@g\.us$/.test(target) ? target : target.replace(/[\s+-]/g, ''), message: message }
    });
    let j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) {}
    const ok = res.getResponseCode() === 200 && j.status === true;
    return { ok: ok, info: ok ? 'Terkirim' : 'Gagal: ' + String(j.reason || j.detail || res.getContentText()).slice(0, 200) };
  } catch (e) {
    return { ok: false, info: 'Gagal menghubungi Fonnte: ' + e.message };
  }
}

// Dipanggil otomatis oleh jadwal (atau jalankan manual)
function kirimRekapWA() { return kirimRekap_(''); }   // data s.d. 07.59.59 / 16.59.59 WITA terakhir

// Uji sekarang juga: kirim rekap ke grup dengan label (TES)
function tesKirimRekapWA() { return kirimRekap_('TES'); }

function kirimRekap_(label) {
  const props = PropertiesService.getScriptProperties();
  const sejak = Number(props.getProperty('REKAP_TERAKHIR') || 0);
  const now = new Date();
  const batas = label ? now : batasRekap_(now);     // TES = data saat ini; terjadwal = s.d. 07.59.59 / 16.59.59
  const rk = hitungRekap_(sejak, batas.getTime());
  try { perbaruiRekapSheet(); } catch (e) {}       // sheet rekap_terkini tetap berisi angka terbaru (bukan batas laporan)
  const msg = formatRekapWA_(rk, batas, label);
  const kirim = kirimWA_(msg);
  if (!label && kirim.ok) props.setProperty('REKAP_TERAKHIR', String(now.getTime()));

  // simpan riwayat di sheet rekap_inven
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_REKAP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_REKAP);
    sh.getRange(1, 1, 1, REKAP_HEADERS.length).setValues([REKAP_HEADERS]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
  }
  const out = rk.list.concat([rk.total]).map(function (r, i, arr) {
    return [batas, r.lokasi, r.total, r.sudah, r.total - r.sudah, r.total ? r.sudah / r.total : '',
      i === arr.length - 1 ? (label ? label + ': ' : '') + kirim.info : ''];
  });
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, out.length, REKAP_HEADERS.length).setValues(out);
  sh.getRange(start, 1, out.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sh.getRange(start, 6, out.length, 1).setNumberFormat('0.0%');
  sh.getRange(start + out.length - 1, 1, 1, REKAP_HEADERS.length).setFontWeight('bold');
  Logger.log(msg + '\n\n→ ' + kirim.info);
  return kirim;
}

// ===== Sheet "rekap_terkini": tabel progres per lokasi (selalu ditimpa dengan angka terbaru) =====
function tulisRekapTerkini_(rk, now) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_REKAP_KINI);
  if (!sh) { sh = ss.insertSheet(SHEET_REKAP_KINI, 0); }
  sh.clear();
  const bar = function (a, b) {
    if (!b) return '';
    const n = Math.round(a / b * 10);
    return '█'.repeat(n) + '░'.repeat(10 - n);
  };
  const rows = rk.list.map(function (r, i) {
    return [i + 1, r.lokasi, r.total, r.sudah, r.total - r.sudah, r.total ? r.sudah / r.total : '', bar(r.sudah, r.total)];
  });
  const t = rk.total;
  rows.push(['', 'TOTAL', t.total, t.sudah, t.total - t.sudah, t.total ? t.sudah / t.total : '', bar(t.sudah, t.total)]);
  sh.getRange(1, 1).setValue('REKAP INVENTARISASI ASET 2026').setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setValue('Diperbarui: ' + Utilities.formatDate(now, REKAP_TZ, 'dd/MM/yyyy HH:mm') +
    ' WITA  ·  otomatis saat ada isian form / baris diedit atau dihapus (cadangan: tiap jam / menu 📊 Rekap)').setFontColor('#5f6368');
  const hdr = [['No', 'Lokasi', 'Total aset', 'Sudah inven', 'Belum inven', '% sudah', 'Progres']];
  sh.getRange(4, 1, 1, 7).setValues(hdr).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  sh.getRange(5, 1, rows.length, 7).setValues(rows);
  sh.getRange(5, 6, rows.length, 1).setNumberFormat('0.0%');
  sh.getRange(5, 7, rows.length, 1).setFontFamily('Consolas').setFontColor('#188038');
  rows.forEach(function (r, i) {
    if (i < rows.length - 1 && r[2] > 0 && r[3] >= r[2]) sh.getRange(5 + i, 1, 1, 7).setBackground('#e6f4ea');
  });
  sh.getRange(5 + rows.length - 1, 1, 1, 7).setFontWeight('bold').setBackground('#e8f0fe');
  sh.setFrozenRows(4);
  sh.setColumnWidth(1, 40); sh.setColumnWidth(2, 220); sh.setColumnWidths(3, 4, 95); sh.setColumnWidth(7, 140);
}

// Perbarui sheet rekap_terkini tanpa mengirim WA (dipanggil tiap jam & dari menu)
function perbaruiRekapSheet() {
  tulisRekapTerkini_(hitungRekap_(0), new Date());
}

// Dipanggil otomatis setiap spreadsheet diubah manual (edit sel, hapus/sisip baris, tempel data)
// -> rekap_terkini dihitung ulang, jadi baris yang dihapus dari hasil_scan / ar01 langsung berkurang.
// (Perubahan oleh skrip sendiri tidak memicu fungsi ini, jadi tidak berulang-ulang.)
function rekapSaatBerubah(e) {
  try {
    const nama = e && e.source ? e.source.getActiveSheet().getName() : '';
    if (nama && [SHEET_LOG, SHEET_DATA].indexOf(nama) < 0) return;   // hanya bila hasil_scan / ar01 yang berubah
  } catch (err) {}
  perbaruiRekapSheet();
}

// Menu di spreadsheet (muncul bila skrip terpasang di spreadsheet invent 2026)
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('📊 Rekap')
      .addItem('Perbarui rekap sekarang', 'perbaruiRekapSheet')
      .addItem('Kirim rekap ke WA sekarang', 'kirimRekapWA')
      .addToUi();
  } catch (e) {}
}

// ===== JALANKAN SEKALI: pasang jadwal kirim otomatis jam 08.00 & 17.00 WITA =====
function pasangJadwalRekap() {
  hapusTrigger_('kirimRekapWA');
  hapusTrigger_('perbaruiRekapSheet');
  hapusTrigger_('rekapSaatBerubah');
  ScriptApp.newTrigger('rekapSaatBerubah').forSpreadsheet(SPREADSHEET_ID).onChange().create();   // edit / hapus baris manual
  REKAP_JAM.forEach(function (h) {
    // berjalan ±08.00–08.30 (selalu setelah batas 07.59.59); isi pesan tetap data s.d. 07.59.59
    ScriptApp.newTrigger('kirimRekapWA').timeBased().everyDays(1).atHour(h).nearMinute(15).inTimezone(REKAP_TZ).create();
  });
  ScriptApp.newTrigger('perbaruiRekapSheet').timeBased().everyHours(1).create();   // sheet rekap_terkini tiap jam
  perbaruiRekapSheet();
  Logger.log('Jadwal rekap aktif: WA tiap hari jam ' + REKAP_JAM.map(function (h) { return ('0' + h).slice(-2) + '.00'; }).join(' & ') +
    ' WITA (terkirim ±0–30 menit setelahnya, data s.d. jam xx.59.59). Sheet rekap_terkini: tiap isian form, tiap edit/hapus baris di hasil_scan & ar01, + cadangan tiap jam.');
}

function hapusJadwalRekap() {
  hapusTrigger_('kirimRekapWA');
  hapusTrigger_('perbaruiRekapSheet');
  hapusTrigger_('rekapSaatBerubah');
  Logger.log('Jadwal rekap WhatsApp dimatikan.');
}

// ===== Cari ID grup WhatsApp (jalankan sekali setelah FONNTE_TOKEN diisi) =====
// Hasil ditulis di log dan sheet "wa_grup". Salin ID grup tujuan ke Properti skrip WA_GROUP_ID.
function cariGrupWA() {
  const token = prop_('FONNTE_TOKEN');
  if (!token) { Logger.log('Isi FONNTE_TOKEN dulu di Properti skrip.'); return; }
  const opt = { method: 'post', muteHttpExceptions: true, headers: { Authorization: token } };
  UrlFetchApp.fetch('https://api.fonnte.com/fetch-group', opt);            // perbarui daftar grup di Fonnte
  const res = UrlFetchApp.fetch('https://api.fonnte.com/get-whatsapp-group', opt);
  let j = {};
  try { j = JSON.parse(res.getContentText()); } catch (e) {}
  if (!j.status || !Array.isArray(j.data)) { Logger.log('Gagal mengambil grup: ' + res.getContentText().slice(0, 300)); return; }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName('wa_grup');
  if (!sh) sh = ss.insertSheet('wa_grup');
  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['ID grup (salin ke WA_GROUP_ID)', 'Nama grup']]).setFontWeight('bold');
  if (j.data.length) sh.getRange(2, 1, j.data.length, 2).setValues(j.data.map(function (g) { return [g.id, g.name]; }));
  Logger.log(j.data.map(function (g) { return g.name + '  →  ' + g.id; }).join('\n') || 'Tidak ada grup.');
}

// ====== SETUP (jalankan sekali dari editor) ======
// Memberi izin + membuat semua folder lokasi di dalam folder tujuan.
function setupFolders() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  LOCATIONS.forEach(function (l) { getOrCreate_(root, l); });
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  Logger.log('OK: ' + LOCATIONS.length + ' folder lokasi siap di "' + root.getName() + '"');
}

