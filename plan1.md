# OpsPanel Next Milestone: Ops Hardening di atas JSON Config

## Summary
- Milestone berikutnya fokus membuat MVP yang sekarang benar-benar operasional, bukan menambah CRUD admin atau migrasi ke Postgres dulu.
- Stack tetap SvelteKit, source of truth tetap `opspanel.config.json`, log realtime tetap SSE.
- Perubahan inti: status service harus jadi authoritative dari remote host melalui `statusCommand`, SSH execution harus lebih aman/stabil, dan UI harus menampilkan state/error yang benar.

## Key Changes
- Perluas schema service config dengan `statusCommand` sebagai field wajib untuk milestone ini.
- Definisikan kontrak `statusCommand`: stdout harus bernilai `running`, `stopped`, `failed`, atau `unknown` secara case-insensitive; jika output tidak valid atau command non-zero exit, status dipetakan ke `unknown` dan note error disimpan.
- Pertahankan `startCommand`, `stopCommand`, `logCommand`, dan `remoteLogFile` seperti sekarang; jangan tambah service type preset di milestone ini.
- Backend service layer harus memisahkan empat jalur eksekusi: `start`, `stop`, `status`, dan `logs`, dengan shared SSH wrapper untuk timeout, stderr capture, dan error normalization.
- Tambahkan timeout default yang eksplisit: SSH connect 8 detik, `statusCommand` 5 detik, `start`/`stop` 20 detik, log stream tanpa hard timeout.
- Tambahkan per-service action lock. Jika ada action kedua saat service yang sama masih `starting`/`stopping`, backend mengembalikan `409` dan UI tetap disable tombol terkait.
- Endpoint `GET /api/services` dan `GET /api/services/[id]` harus mengembalikan status hasil remote check, bukan hanya state lokal. Gunakan cache status pendek 5 detik per service agar dashboard tidak membanjiri SSH tiap render.
- Response service perlu menambah `lastCheckedAt` dan `status.note` agar UI bisa membedakan “running”, “unknown karena error SSH”, dan “belum pernah dicek”.
- Action `start` dan `stop` tetap mengubah state transisional lokal (`starting`/`stopping`), lalu setelah action selesai backend langsung menjalankan `statusCommand` sekali untuk sinkronisasi authoritative state.
- Bulk action tetap paralel, tetapi hasil per service harus berisi `ok`, `message`, dan authoritative status terbaru setelah sinkronisasi.
- SSE log tetap dipakai. Endpoint log harus selalu mengirim `snapshot` dari buffer lebih dulu, lalu live lines; saat koneksi putus, stream remote harus ditutup bersih tanpa mengubah status service menjadi error.
- UI dashboard tetap refresh otomatis tiap 10 detik, tetapi status card dan row harus menampilkan sumber state yang baru: label status, `lastCheckedAt`, dan error/note singkat jika remote check gagal.
- UI logs page tetap punya reconnect manual, tetapi indikator koneksi harus hanya merefleksikan state stream SSE, bukan state service.
- Mock mode harus ikut mendukung `statusCommand` secara simulatif agar seluruh flow bisa dites lokal tanpa SSH.

## Public Interface Changes
- `opspanel.config.json`
  - Tambah `statusCommand` pada setiap service.
- `GET /api/services`
  - Tambah `lastCheckedAt` dan `status.note`.
  - `status.state` sekarang authoritative hasil remote check.
- `GET /api/services/[serviceId]`
  - Bentuk response mengikuti perubahan di atas.
- `POST /api/services/[serviceId]/action`
  - Jika action bentrok dengan lock service, return `409`.
  - Success response harus memuat authoritative status sesudah sync.
- `POST /api/services/bulk`
  - Result per service harus menyertakan authoritative status final.
- SSE logs
  - Event tetap `ready`, `snapshot`, `line`, `end`, `error`; tidak migrasi ke WebSocket di milestone ini.

## Test Plan
- Login flow tetap berjalan dengan kredensial saat ini.
- Mock mode:
  - `start` mengubah service ke `starting` lalu `running`.
  - `stop` mengubah service ke `stopping` lalu `stopped`.
  - `statusCommand` simulatif mengembalikan state yang konsisten dengan action terakhir.
  - Double-click start/stop untuk service yang sama menghasilkan `409`.
- SSH mode:
  - `statusCommand` valid menghasilkan `running`/`stopped` yang tampil di dashboard.
  - `statusCommand` timeout atau non-zero exit menghasilkan `unknown` plus `status.note`.
  - `start` diikuti sync status benar-benar memperbarui dashboard ke status remote, bukan sekadar `running` lokal.
  - `stop` diikuti sync status benar-benar memperbarui dashboard ke status remote.
- Dashboard:
  - Auto-refresh 10 detik memperbarui state tanpa reload halaman.
  - Error check status tidak mematikan seluruh dashboard; hanya service terkait yang menunjukkan note error.
- Logs:
  - SSE reconnect tetap menampilkan `snapshot` buffer.
  - Menutup tab log menghentikan stream remote tanpa meninggalkan koneksi menggantung.
- Regression:
  - `npm run build` tetap lulus.
  - Routing login, dashboard, logs, dan logout tetap bekerja.

## Assumptions and Defaults
- Scope tetap single-user internal; tidak ada RBAC, multi-user, atau audit log di milestone ini.
- Remote host diasumsikan Linux-like dan command shell-compatible seperti contoh PRD sekarang.
- JSON config tetap source of truth; tidak ada UI CRUD server/service pada milestone ini.
- SSE tetap dipertahankan; migrasi ke WebSocket ditunda ke milestone berikutnya jika nanti benar-benar dibutuhkan.
- Adapter/deploy polish tidak masuk milestone ini kecuali ada bug yang langsung menghambat pengujian ops hardening.
