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
Nayaxa menggunakan sistem multi-brain yang adaptif:
*   **DeepSeek (V3/R1):** Otak Utama (Default). Digunakan untuk analisis dokumen mendalam, penulisan draf formal, pemrograman (Coding Mode), dan tugas yang membutuhkan logika berjenjang.
*   **Gemini (1.5 Pro/Flash):** Otak Pendukung & Multimodal. Digunakan untuk salam proaktif (Awakening), analisis gambar/visual, serta sebagai *fallback* jika DeepSeek mengalami antrean panjang.

### D. Fact-Based Research Protocol (2024-2029)
Protokol pencarian data pejabat dan politik untuk periode 2024-2029:
*   **Prioritas Sumber:** WAJIB mengutamakan domain pemerintah (`.go.id`) dan sumber berita terverifikasi.
*   **Akurasi Kabinet:** Nayaxa sudah dibekali data Kabinet Merah Putih (2024-2029) untuk mencegah halusinasi data lama.
*   **Transparency Footer:** Setiap riset data publik menyertakan catatan validasi fakta di bagian bawah jawaban.

### E. UX & Auto-Scroll Optimasi
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
