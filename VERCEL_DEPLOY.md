# Deploy 9Router ke Vercel

Panduan deploy fork ini ke Vercel agar dashboard bisa diakses dari browser dan endpoint `/v1` bisa dipakai sebagai LLM gateway.

## Langkah Deploy

### 1. Import ke Vercel

1. Buka [vercel.com/new](https://vercel.com/new)
2. Pilih repository fork ini (`9router`)
3. Framework Preset: **Next.js** (terdeteksi otomatis)
4. Build Command: `npm run build` (default dari `vercel.json`)
5. Jangan deploy dulu — set environment variables dulu di langkah 2.

### 2. Environment Variables (wajib)

Set di Vercel Dashboard → Project → Settings → Environment Variables.
Tandai semua sebagai **Production** (dan Preview jika ingin test).

| Variable | Nilai | Keterangan |
|---|---|---|
| `JWT_SECRET` | _random string 32+ karakter_ | Secret untuk dashboard auth cookie. Generate sendiri, misal via `openssl rand -hex 32`. |
| `INITIAL_PASSWORD` | _password kuat pilihanmu_ | Password login dashboard pertama. **Jangan pakai `123456`.** |
| `DATA_DIR` | `/tmp/9router-data` | Lokasi database SQLite. `/tmp` adalah satu-satunya direktori writable di Vercel serverless. |
| `NODE_ENV` | `production` | Mode production. |
| `API_KEY_SECRET` | _random string 32+ karakter_ | HMAC secret untuk API key yang di-generate dashboard. |
| `AUTH_COOKIE_SECURE` | `true` | Wajib `true` karena Vercel pakai HTTPS. |
| `REQUIRE_API_KEY` | `true` | **Wajib `true`** — endpoint `/v1/*` hanya bisa diakses dengan Bearer API key. Ini pengaman utama karena URL Vercel bersifat publik. |
| `BASE_URL` | `https://<project>.vercel.app` | URL publik deployment (isi setelah deploy pertama, lalu redeploy). |
| `NEXT_PUBLIC_BASE_URL` | `https://<project>.vercel.app` | Sama seperti di atas, untuk kompatibilitas UI. |

### 3. Deploy & Setup

1. Klik **Deploy** di Vercel.
2. Tunggu build selesai (~3-5 menit, build Next.js + native deps).
3. Buka `https://<project>.vercel.app/dashboard`, login dengan `INITIAL_PASSWORD`.
4. **Segera ganti password** di Settings dashboard.
5. Tambah provider AI → pilih model → generate API key di dashboard.
6. Catat API key tersebut — dipakai sebagai `Authorization: Bearer <key>` untuk `/v1/*`.

### 4. (Opsional) Update BASE_URL lalu Redeploy

Setelah tahu URL publik, update `BASE_URL` dan `NEXT_PUBLIC_BASE_URL` di env vars, lalu redeploy via Vercel Dashboard → Deployments → Redeploy.

## ⚠️ Batasan Penting: Database Ephemeral

9Router menyimpan semua state (provider, API key, setting, usage) di **SQLite** (`$DATA_DIR/db/data.sqlite`).

Di Vercel serverless, filesystem bersifat **ephemeral per instance**:
- Selama instance "warm" (ada traffic), data aman.
- Saat **cold start** (instance baru setelah idle), database kembali kosong dan konfigurasi dashboard hilang — harus setup ulang provider.

**Mitigasi:**
- **Vercel Cron Job** (butuh plan berbayar untuk cron < 1 hari, atau pakai layanan ping eksternal gratis seperti cron-job.org / UptimeRobot) untuk hit endpoint `/api/health` tiap 5 menit agar instance tetap warm.
- Ini **mengurangi** frekuensi cold start tapi **tidak menjamin** — Vercel tetap bisa recycle instance sewaktu-waktu (deploy baru, maintenance infra).
- Untuk pemakaian pribadi dengan traffic rutin (misal bot Telegram yang aktif), instance cenderung tetap warm.

**Jika butuh persistensi penuh**, opsinya adalah migrasi database ke Vercel Postgres/KV — itu butuh modifikasi kode (adapter baru di `src/lib/db/adapters/`), di luar cakupan fork ini.

## Keamanan Checklist

- [ ] `REQUIRE_API_KEY=true` — tanpa ini, siapa pun bisa pakai `/v1` gratis pakai kuotamu
- [ ] `AUTH_COOKIE_SECURE=true` — cookie dashboard hanya lewat HTTPS
- [ ] `INITIAL_PASSWORD` kuat dan langsung diganti setelah login pertama
- [ ] `JWT_SECRET` dan `API_KEY_SECRET` random dan tidak dibagikan
