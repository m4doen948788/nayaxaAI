# MASTER REFERENCE: NAYAXA v4.6.1 (STABLE)

**Tanggal:** 22 April 2026  
**Status:** Produksi / Stabil  
**Platform:** Dashboard Widget (copy-dashboard) & Standalone Chat (nayaxa-engine)

---

## 1. Ringkasan Fitur Utama

### A. Smart Per-File Action (Dropdown)
Nayaxa v4.6.1 memperkenalkan kontrol presisi untuk setiap dokumen yang diunggah.
*   **Analisis (Default):** Melakukan tinjauan umum dan memberikan wawasan mendalam.
*   **Jadikan Acuan Bahan:** Memaksa Nayaxa menggunakan file tersebut sebagai sumber fakta mentah utama.
*   **Jadikan Acuan Format:** Nayaxa akan meniru gaya bahasa, struktur, dan tata letak file tersebut (Sangat berguna untuk pembuatan draf Perbup/Laporan).
*   **Buatkan Ringkasan + Notulen (+ Word):** Aksi cepat untuk merangkum hasil rapat langsung ke format Word.

### B. Rich Table Copy (Clipboard Pro)
*   Menyalin tabel dari chat Nayaxa kini menyertakan **Properti HTML**.
*   Saat di-paste ke **MS Word** atau **Excel**, tabel akan tetap rapi dengan border, warna header, dan padding yang sesuai.

### C. Intelligence Logic & Brain Selection
Nayaxa menggunakan sistem multi-brain yang adaptif (Anonymized UI):
*   **Otak Utama:** Digunakan untuk analisis dokumen mendalam, penulisan draf formal, dan logika berjenjang.
*   **Otak Cadangan:** Digunakan untuk salam proaktif, analisis visual, dan jalur alternatif jika sistem utama sibuk.
*   **Anonymity:** Nama teknis seperti "DeepSeek" atau "Gemini" telah dihapus dari antarmuka pengguna untuk menjaga estetika premium.

### D. Fact-Based Research Protocol (2024-2029)
Protokol pencarian data pejabat dan politik untuk periode 2024-2029:
*   **Prioritas Sumber:** WAJIB mengutamakan domain pemerintah (`.go.id`) dan sumber berita terverifikasi.
*   **Akurasi Kabinet:** Nayaxa sudah dibekali data Kabinet Merah Putih (2024-2029) untuk mencegah halusinasi data lama.
*   **Transparency Footer:** Setiap riset data publik menyertakan catatan validasi fakta di bagian bawah jawaban.

### E. Native Stability Hardening (v4.6.1)
Fitur untuk menjamin koneksi tidak terputus, setara dengan aplikasi asli:
*   **Keep-Alive Heartbeat:** Server mengirimkan sinyal "detak jantung" setiap 5 detik selama proses pencarian data untuk mencegah pemutusan koneksi oleh jaringan/proxy.
*   **Auto-Resume Logic:** Jika AI berhenti karena batasan panjang teks (*token limit*), Nayaxa akan otomatis menyambung jawaban tersebut tanpa perlu diminta.
*   **Infinite Timeout:** Socket timeout dinonaktifkan khusus untuk sesi chat aktif agar riset kompleks tidak terhenti di tengah jalan.

### F. Context & Honesty Guardrail (v4.6.1)
*   **File Priority:** Nayaxa wajib memprioritaskan dokumen yang baru saja diunggah. Jika topik berubah, Nayaxa harus meninggalkan konteks lama.
*   **Anti-Hallucination:** Jika informasi tidak ditemukan dalam file, Nayaxa dilarang mengarang dan wajib menyatakan tidak bisa menjawab secara jujur.
*   **Silent Search:** Seluruh proses pencarian internal (query) disembunyikan dari layar chat agar tampilan tetap bersih.

### G. UX & Auto-Scroll Optimasi
*   **Streaming Scroll:** Jendela chat otomatis mengikuti teks ke bawah selama Nayaxa mengetik.
*   **Focus Guard:** Dropdown file tidak akan menutup sendiri saat diklik (Masalah auto-focus sudah diperbaiki).
*   **Preview Stability:** Chat tidak akan tertutup/minimize otomatis setelah Anda menutup jendela pratinjau dokumen.

---

## 2. Pengaturan Teknis & Guardrails (Backend)

### A. Protokol Dokumen Panjang (Long Document Protocol)
Nayaxa dilarang keras menulis draf dokumen yang sangat panjang (seperti Perbup/Laporan Lengkap) langsung di dalam chat bubble.
*   **Logika:** Hemat token dan menjaga kebersihan chat.
*   **Eksekusi:** Nayaxa wajib menggunakan tool `generate_document` dan hanya memberikan ringkasan serta link unduh di chat.

### B. Pembersihan Output (Centralized Cleanup)
Semua respon Nayaxa melalui proses filter di `nayaxaController.js` untuk menghapus jejak teknis:
*   Menghapus tag `<thought>`, `[invoke]`, dan elemen `DSML` yang tidak perlu.
*   Memastikan jawaban terlihat premium dan manusiawi.

### C. Batasan Waktu (API Timeout)
*   **Timeout:** 120 Detik (2 Menit).
*   Memberikan ruang bagi AI untuk menganalisis dokumen PDF yang sangat kompleks tanpa terputus di tengah jalan.

---

## 3. Daftar File Kritis v4.6.1

| Lokasi File | Peran Utama |
| :--- | :--- |
| `d:\copy-dashboard\Frontend\src\components\NayaxaAssistant.tsx` | Logika Widget & Dropdown Aksi (Dashboard) |
| `d:\nayaxa-engine\Frontend\src\pages\Chat.tsx` | Logika Omni Chat Utama & Rich Table Copy |
| `d:\nayaxa-engine\Backend\src\services\nayaxaDeepSeekService.js` | System Prompt v4.6.1 & Instruksi Per-File |
| `d:\nayaxa-engine\Backend\src\services\exportService.js` | Styling Tabel Word (Mobile Responsive) |
| `d:\nayaxa-engine\Backend\src\controllers\nayaxaController.js` | Filter Pembersihan Output Akhir |

---

## 4. Instruksi Penggunaan (Tips)
1.  **Ingin Format Sama?** Upload file contoh, pilih **"Jadikan Acuan Format"** di dropdown, lalu minta Nayaxa buatkan draf baru.
2.  **Tabel Berantakan di Word?** Jangan khawatir, di v4.6.1 tabel sudah otomatis diatur set-lebar 100% dan rata tengah agar cantik di layar HP.
3.  **Chat Stuck di Tengah?** Masalah ini sudah diperbaiki, namun jika terjadi, cukup tekan Enter sekali lagi atau refresh halaman.

---
*Dokumen ini dibuat untuk memastikan stabilitas Nayaxa v4.6.1 terjaga. Jangan melakukan perubahan pada logika scroll atau focus management tanpa merujuk pada catatan ini.*
