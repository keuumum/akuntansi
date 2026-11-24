// Penghubung aplikasi -> server (Apps Script doPost). Meniru google.script.run agar logika form lama bisa dipakai apa adanya.
(function () {
  const LS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const APP = window.APP = window.APP || {};
  APP.pin = () => LS('inv-pin');
  APP.device = () => {
    let d = LS('inv-device');
    if (!d) {
      const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
      d = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => abc[b % 32]).join('');
      try { localStorage.setItem('inv-device', d); } catch (e) {}
    }
    return d;
  };
  function offlineErr() { const e = new Error('Tidak ada sinyal / internet.'); e.offline = true; return e; }
  APP.call = async function (fn, args, pinOverride) {
    const pin = pinOverride || APP.pin();
    const url = (window.CONFIG && CONFIG.API_URL) || '';
    if (!/^https:\/\/script\.google\.com\//.test(url)) throw new Error('API_URL belum diisi dengan benar di config.js.');
    if (!pin) throw new Error('Belum login.');
    if (navigator.onLine === false) throw offlineErr();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn: fn, args: args || [], pin: pin, device: APP.device() })
      });
    } catch (e) { throw offlineErr(); }
    let j;
    try { j = await res.json(); }
    catch (e) { throw new Error('Jawaban server tidak valid. Cek API_URL di config.js dan akses deployment harus "Siapa saja".'); }
    if (!j.ok) {
      if (/PIN salah/.test(j.error || '') && !pinOverride && APP.onPinInvalid) APP.onPinInvalid();
      throw new Error(j.error || 'Gagal.');
    }
    return j.data;
  };
  function runner(ok, fail) {
    return new Proxy({}, {
      get(_, k) {
        if (k === 'withSuccessHandler') return f => runner(f, fail);
        if (k === 'withFailureHandler') return f => runner(ok, f);
        if (k === 'withUserObject') return () => runner(ok, fail);
        if (typeof k !== 'string') return undefined;
        return (...a) => {
          APP.call(k, a).then(r => ok && ok(r), async e => {
            // tanpa sinyal: pakai versi offline (cari dari data di HP, simpan ke antrian)
            if (e && e.offline && APP.offline && APP.offline[k]) {
              try { const r = await APP.offline[k](...a); ok && ok(r); } catch (e2) { fail && fail(e2); }
            } else fail && fail(e);
          });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };
})();
