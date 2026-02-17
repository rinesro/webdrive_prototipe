
# WebDrive Prototipe

WebDrive Prototipe adalah aplikasi berbasis web yang dirancang sebagai solusi manajemen penyimpanan file digital. Proyek ini difokuskan pada kemudahan akses, pengorganisasian dokumen, dan efisiensi pengelolaan data.

## 🚀 Fitur Utama

- **Dashboard File:** Visualisasi folder dan file yang tersimpan.
- **Upload & Download:** Manajemen transfer file antar perangkat dan cloud.
- **Organisasi Data:** Pengelompokan file berdasarkan kategori atau tipe.
- **Keamanan:** Proteksi akses untuk memastikan data hanya bisa dikelola oleh user yang sah.

## 🛠️ Teknologi yang Digunakan

- **Frontend:** Next.js (React Framework)
- **Styling:** Tailwind CSS
- **Database:** [Isi dengan Database kamu, misal: MongoDB/PostgreSQL]
- **Storage:** [Isi dengan Storage kamu, misal: Firebase Storage/AWS S3/Local Storage]

## 📋 Prasyarat

Pastikan perangkat kamu sudah terinstal:
- Node.js (versi 18 ke atas)
- Package Manager (NPM/Yarn/PNPM)

## ⚙️ Cara Menjalankan Proyek

1. **Clone repositori:**
   ```bash
   git clone [https://github.com/rinesro/webdrive_prototipe.git](https://github.com/rinesro/webdrive_prototipe.git)
   cd webdrive_prototipe

```

2. **Instal dependensi:**
```bash
npm install

```


3. **Konfigurasi Environment:**
Buat file `.env` di direktori utama dan tambahkan variabel yang dibutuhkan (lihat `.env.example` jika ada).
4. **Jalankan aplikasi:**
```bash
npm run dev

```


Aplikasi dapat diakses melalui `http://localhost:3000`.

## 📁 Struktur Proyek

```text
├── src/
│   ├── components/  # Komponen UI
│   ├── pages/       # Routing halaman
│   ├── styles/      # Konfigurasi CSS
│   └── lib/         # Konfigurasi database/utility
├── public/          # Aset gambar dan ikon
└── .gitignore       # File yang diabaikan oleh Git

```

---

**Developed by [Sandhika Hamzah**]()

```

### Biar makin akurat, boleh kasih tahu dikit:
1. Kamu pakai database apa untuk simpan data filenya (Prisma, Supabase, atau SQL biasa)?
2. Untuk penyimpanan file aslinya (*storage*), apakah disimpan di folder lokal atau pakai layanan seperti Firebase/Cloudinary?

Kalau kamu kasih tahu dua hal itu, saya bisa langsung update bagian **Teknologi** dan **Konfigurasi** di atas supaya lebih pas! Mau saya bantu tambahkan bagian cara *deployment* juga?

