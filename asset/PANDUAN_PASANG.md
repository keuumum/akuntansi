# Aplikasi HP Inven UPKL v1.1 – update dari v1.0

Baru: login pakai NIP, dan mode OFFLINE (cari aset & simpan tanpa sinyal, terkirim + dicek AI otomatis saat ada sinyal).

## 1. Sheet pegawai: tambah kolom NIP (C)
Ganti rumus di A1 sheet `pegawai` (pengaturan Indonesia):
={"Nama"\"Jabatan"\"NIP"; QUERY(IMPORTRANGE("1-qdihyX2QWdhxMtmRGGu3f2jLKAUm2cGoI5KqnJSMR8"; "Dapeg!A2:D"); "select Col2, Col4, Col1 where Col2 is not null order by Col2"; 0)}
NIP hanya dibaca server untuk login, tidak pernah dikirim ke HP.

## 2. Apps Script
- Ganti isi **Code.gs** (beda dengan v21 hanya 2 baris; STIKER_PIN 'UPKL' tetap baris 19) dan **api.gs**. Simpan.
- Terapkan → Kelola deployment → pilih deployment **API aplikasi HP** (…ouVdF/exec) → ✏️ Edit → Versi: **Versi baru** → Terapkan.
  (URL tetap sama. Deployment web form TIDAK perlu diubah.)
- APP_PIN tetap dipakai sebagai PIN tim untuk non-pegawai. Kosongkan bila hanya ingin login NIP.

## 3. GitHub
config.js di paket ini SUDAH berisi URL API Anda. Upload ulang semua file di folder `app` (timpa yang lama).
HP yang sudah membuka aplikasi akan melihat "Versi baru aplikasi tersedia → Perbarui".

## 4. Pakai offline
- Buka aplikasi SEKALI saat ada sinyal (login + buka tab Cari) agar daftar aset & aplikasi tersimpan di HP.
- Tanpa sinyal: scan/ketik kode → data aset muncul dari HP → isi, foto, Verifikasi (ditandai Offline) → Simpan.
- Data masuk "Antrian offline" (bar kuning di bawah). Saat ada sinyal terkirim otomatis, foto dicek AI saat itu,
  dan waktu inven tercatat sesuai saat diisi di lapangan.
- Jangan hapus data browser / uninstall aplikasi sebelum antrian kosong.
