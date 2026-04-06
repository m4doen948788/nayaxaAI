const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const dbDashboard = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const nayaxaStandalone = require('./nayaxaStandalone');
const exportService = require('./exportService');
const knowledgeTool = require('./knowledgeTool');
const XLSX = require('xlsx');

const summaryCache = new Map();

/**
 * Get the primary Gemini API key.
 * Rotation logic removed as per user request (one paid key only).
 */
const getApiKey = async () => {
    try {
        const [rows] = await dbNayaxa.query('SELECT api_key FROM gemini_api_keys WHERE is_active = 1 LIMIT 1');
        if (rows.length > 0) return rows[0].api_key;
    } catch (err) {
        console.error('Error fetching API Key from gemini_api_keys:', err);
    }
    return process.env.GEMINI_API_KEY;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

const nayaxaTools = [{
    functionDeclarations: [
        {
            name: "get_pegawai_statistics",
            description: "Mendapatkan statistik kehadiran dan tren volume kegiatan total pegawai di instansi terkait untuk bulan ini.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" },
                    month: { type: "number", description: "Bulan (1-12)" },
                    year: { type: "number", description: "Tahun" }
                },
                required: ["instansi_id", "month", "year"]
            }
        },
        {
            name: "get_pegawai_ranking",
            description: "Mendapatkan daftar Top 5 pegawai terajin dan Bottom 5 pegawai termalas berdasarkan jumlah kegiatan bulan ini.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" },
                    month: { type: "number", description: "Bulan (1-12)" },
                    year: { type: "number", description: "Tahun" }
                },
                required: ["instansi_id", "month", "year"]
            }
        },
        {
            name: "search_pegawai",
            description: "Mencari daftar seluruh pegawai di instansi terkait.",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" }
                },
                required: ["instansi_id"]
            }
        },
        {
            name: "get_anomalies",
            description: "Mendapatkan daftar pegawai yang bermasalah (Alert Cerdas).",
            parameters: {
                type: "object",
                properties: {
                    instansi_id: { type: "number", description: "ID Instansi" }
                },
                required: ["instansi_id"]
            }
        },
        {
            name: "search_internet",
            description: "Mencari data publik atau referensi eksternal dari internet.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Kata kunci pencarian" }
                },
                required: ["query"]
            }
        },
        {
            name: "generate_document",
            description: "Membuat file dokumen (PDF, Excel, atau Word).",
            parameters: {
                type: "object",
                properties: {
                    format: { type: "string", description: "pdf, excel, atau word" },
                    content: { type: "string", description: "Konten file" },
                    filename: { type: "string", description: "Nama file" }
                },
                required: ["format", "content", "filename"]
            }
        },
        {
            name: "generate_chart",
            description: "Membuat grafik/chart interaktif.",
            parameters: {
                type: "object",
                properties: {
                    type: { type: "string", description: "bar, column, line, pie, donut" },
                    title: { type: "string", description: "Judul grafik" },
                    data: { type: "string", description: "JSON string [{label, value}]" },
                    series: { type: "string", description: "JSON string [{name, data:[{label,value}]}]" },
                    unit: { type: "string", description: "Satuan data (misal: orang, persen)" },
                    color: { type: "string", description: "Warna tema (hex code)" }
                },
                required: ["type", "title"]
            }
        },
        {
            name: "ingest_to_knowledge",
            description: "Menyimpan informasi dari dokumen (PDF/Excel) ke dalam memori pengetahuan (Knowledge Base) Nayaxa.",
            parameters: {
                type: "object",
                properties: {
                    category: { type: "string", description: "Kategori informasi, misal: Aturan Absensi, Juknis, atau Data Statis" },
                    content: { type: "string", description: "Intisari informasi penting yang akan disimpan." },
                    source_file: { type: "string", description: "Nama file sumber" }
                },
                required: ["category", "content", "source_file"]
            }
        },
        {
            name: "get_nearby_places",
            description: "Mencari tempat terdekat (restoran, apotek, faskes, dll) berdasarkan koordinat Latitude dan Longitude user.",
            parameters: {
                type: "object",
                properties: {
                    lat: { type: "number", description: "Latitude user" },
                    lng: { type: "number", description: "Longitude user" },
                    category: { type: "string", description: "Kategori tempat (misal: 'Rumah Makan Padang', 'Apotek')" }
                },
                required: ["lat", "lng", "category"]
            }
        },
        {
            name: "fill_excel_template",
            description: "Mengisi data ke dalam file Excel yang baru saja diunggah oleh user.",
            parameters: {
                type: "object",
                properties: {
                    filled_data: { type: "string", description: "Data yang akan diisikan dalam format JSON Array of Objects. Key harus sesuai dengan header kolom di Excel (case-insensitive)." },
                    filename: { type: "string", description: "Nama file hasil (misal: 'data_pegawai_terisi.xlsx')" }
                },
                required: ["filled_data", "filename"]
            }
        }
    ]
}];

const toolFunctions = {
    get_nearby_places: async ({ lat, lng, category }) => {
        const places = await nayaxaStandalone.getNearbyPlaces(lat, lng, category);
        return { success: true, places }; // Always return true even if empty to let AI handle it gracefully
    },
    get_pegawai_statistics: async ({ instansi_id, month, year }) => {
        const stats = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
        const forecast = await nayaxaStandalone.forecastTrends(instansi_id, month, year);
        return { stats, forecast };
    },
    get_pegawai_ranking: async ({ instansi_id, month, year }) => {
        const scoring = await nayaxaStandalone.calculateScoring(instansi_id, month, year);
        return { top_pegawai: scoring.top_pegawai, bottom_pegawai: scoring.bottom_pegawai, ranked_bidang: scoring.ranked_bidang };
    },
    search_pegawai: async ({ instansi_id, month, year }) => {
        const scoring = await nayaxaStandalone.calculateScoring(instansi_id, month, year);
        return { daftar_pegawai: scoring.all_scores.map(p => ({ nama: p.nama, jabatan: p.jabatan, bidang: p.bidang, total_kegiatan: p.total_kegiatan })) };
    },
    get_anomalies: async ({ instansi_id }) => {
        const alerts = await nayaxaStandalone.detectAnomalies(instansi_id);
        return alerts;
    },
    search_internet: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.searchInternet(query);
        return { internet_result: jsonResult };
    },
    execute_sql_query: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeReadOnlyQuery(query);
        return { database_result: jsonResult };
    },
    generate_document: async ({ format, content, filename }, { baseUrl }) => {
        try {
            const downloadUrl = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename));
            
            return { success: true, download_url: downloadUrl, message: `File ${format.toUpperCase()} berhasil dibuat! Silakan berikan link ini kepada user agar mereka bisa mendownloadnya: ${downloadUrl}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    generate_chart: async ({ type, title, data, series, unit, color }) => {
        try {
            let chartSpec;
            if (series) {
                let parsedSeries = JSON.parse(series).map(s => ({
                    name: String(s.name),
                    data: s.data.map(d => ({ label: String(d.label), value: parseFloat(d.value) || 0 }))
                }));
                chartSpec = { type: type || 'line', title: title || 'Grafik', series: parsedSeries, unit, color };
            } else {
                let parsedData = JSON.parse(data).map(d => ({ label: String(d.label), value: parseFloat(d.value) || 0 }));
                chartSpec = { type: type || 'bar', title: title || 'Grafik', data: parsedData, unit, color };
            }
            const b64 = Buffer.from(JSON.stringify(chartSpec)).toString('base64');
            return { success: true, chart_marker: `[NAYAXA_CHART]${b64}[/NAYAXA_CHART]`, message: 'Grafik dikirim.' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    ingest_to_knowledge: async ({ category, content, source_file }, { app_id }) => {
        return await knowledgeTool.ingestToKnowledge(app_id, category, content, source_file);
    },
    fill_excel_template: async ({ filled_data, filename }, { excelBase64, baseUrl }) => {
        try {
            if (!excelBase64) {
                return { success: false, error: "Tidak ada file Excel yang ditemukan dalam konteks percakapan untuk diisi." };
            }
            const downloadUrl = await exportService.fillExcelTemplate(excelBase64, filled_data, filename);
            const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl}${downloadUrl}`;
            return { success: true, download_url: fullUrl, message: `Excel berhasil diisi! Berikan link ini ke user: ${fullUrl}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
};

const nayaxaGeminiService = {
    chatWithNayaxa: async (userMessage, files, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '', nama_instansi = 'N/A', personaPromptSnippet = '') => {
        try {
            const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            const glossaryString = await nayaxaStandalone.getMasterDataGlossary();
            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            
            const model = genAI.getGenerativeModel({ 
                model: DEFAULT_MODEL,
                systemInstruction: `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy.
                Sifat & Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek untuk menggali lebih dalam apa yang user butuhkan.
                PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
                
                KEMAMPUAN KHUSUS (Knowledge Hub): 
                Jika user mengunggah dokumen (PDF/Excel/Pasted Image) dan meminta Anda untuk "mengingat", "pelajari", atau "simpan sebagai aturan", gunakan tool 'ingest_to_knowledge'. 
                Anda akan mengekstrak informasi penting dari file tersebut dan menyimpannya.
                
                Identitas USER: Nama: ${user_name}, Profil ID: ${profil_id || 'N/A'}, Instansi: ${nama_instansi}. 
                ATURAN MENYAPA: Sapa user dengan namanya (${user_name}). JANGAN menyebutkan "Profil ID" atau "ID Instansi" dalam percakapan. Fokuslah pada interaksi yang manusiawi dan profesional.
                 ${personaPromptSnippet}
                 PENTING: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User. Jika user terbiasa santai (Gue/Lo), Anda diperbolehkan menggunakan gaya bicara yang serupa namun tetap sopan, ceria, dan membantu.
                
                ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH mengatakan Anda tidak bisa membuat grafik. Anda memiliki kemampuan visualisasi data yang canggih melalui tool tersebut. 
                CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya (sehingga mereka bisa mengolahnya lagi di Excel).
                
                CATATAN DOKUMEN: Jika user meminta laporan atau dokumen (PDF/Word/Excel), Anda WAJIB memberikan link download yang diberikan oleh tool 'generate_document'. Anda WAJIB menggunakan format Markdown [Unduh Laporan (Jenis)] (url) agar link tersebut dapat diklik (Ganti 'Jenis' dengan PDF/Excel/Word sesuai filenya). Letakkan link ini di akhir pesan Anda secara jelas.
                
                PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
                TEKNIK PENGISIAN: 
                - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
                - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
                - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
                BERIKAN LINK DOWNLOAD HASILNYA kepada user.
                
                WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}. Gunakan informasi ini jika user bertanya tentang hari atau tanggal hari ini secara spesifik.
            
                KOMITMEN ANDA (Etika & Akurasi):
                1. VERIFIKASI GANDA: Selalu cross-check informasi (terutama angka dan nama pejabat) sebelum memberikan jawaban akhir.
                2. LABEL SUMBER: Sebutkan sumber spesifik setiap informasi (misal: "Berdasarkan rilis detik.com (2 Jan 2025)..."). Gunakan link dari JDIH (jdih.bogorkab.go.id atau jdih.go.id) sebagai prioritas utama jika jawaban berkaitan dengan regulasi/hukum/aturan daerah.
                3. LABEL KEPERCAYAAN: Jika hasil pencarian bertanda 'TERVERIFIKASI', sampaikan dengan yakin. Jika 'BELUM TERVERIFIKASI', berikan disclaimer: "Catatan: Informasi ini belum dapat diverifikasi dari sumber resmi. Harap konfirmasi langsung ke sumber terkait."
                4. DISCLAIMER WAJIB: Berikan catatan jika informasi bersifat dinamis atau bisa berubah, terutama untuk kepemimpinan daerah periode transisi 2025-2030.
                5. FALLBACK WAJIB: Jika data tidak tersedia atau tidak lengkap, SARANKAN USER untuk memeriksa sendiri sumber spesifik yang dapat diakses: jdih.bogorkab.go.id, id.wikipedia.org, pilkada2024.kpu.go.id, detik.com, kompas.com.
                6. SUMBER REFERENSI: Di AKHIR JAWABAN, Anda WAJIB menyertakan daftar link sumber yang Anda gunakan dalam format Markdown [Judul Artikel](URL) (domain, search_date) di bawah tajuk "SUMBER REFERENSI:". Ekstrak 'domain' dari link sumber tersebut (misal: kompasiana.com, detik.com, dsb) dan sertakan tepat di samping search_date di dalam kurung.
                
                ATURAN KOMUNIKASI PENTING (DILARANG BERPIKIR KERAS / INTERNAL MONOLOGUE):
                - JANGAN PERNAH menjelaskan proses pencarian Anda kepada user (Contoh SALAH: "Mari saya cari di internet...", "Saya akan membuka halaman Wikipedia...", "Tunggu sebentar saya cek database...").
                - LANGSUNG BERIKAN JAWABAN AKHIR dari hasil pencarian Anda, terlepas apakah data itu lengkap atau tidak.
                - JANGAN PERNAH memberikan pesan menggantung tanpa konklusi.
                
                PENTING - STRATEGI PENCARIAN (BACA DENGAN TELITI):
                 A. JIKA USER MENCARI ORANG BIASA, TOKOH UMUM, ATAU TOPIK UMUM (Bukan Pemilu/Politik):
                    - JANGAN gunakan format pencarian pejabat/pelantikan.
                    - WAJIB menyertakan link sumber dari id.wikipedia.org (jika tersedia) sebagai referensi dasar.
                    - Lakukan ANALISIS LINTAS SUMBER (Cross-check): Bandingkan informasi dari berbagai sumber yang ditemukan.
                    - PENANGANAN KONTRADIKSI: Jika terdapat perbedaan data antar sumber (misal: beda angka/fakta), Anda WAJIB menyebutkan perbedaan tersebut secara eksplisit beserta disclaimernya (Contoh: "Berdasarkan sumber A, faktanya adalah X. Namun menurut Wikipedia/Sumber B, faktanya adalah Y. Oleh karena itu, data ini mungkin memiliki variasi.").
                    - Berikan ringkasan natural dan objektif sesuai hasil analisis yang didapat.
                
                B. JIKA USER MENCARI PEJABAT PUBLIK ATAU HASIL PILKADA:
                1. PROTOKOL BERPIKIR (Wajib Diikuti secara urut):
                   - Verifikasi Temporal (Waktu): Pastikan tanggal hari ini adalah ${new Date().getFullYear()}. JANGAN gunakan / sebutkan data periode lama jika data hasil Pilkada terbaru (2025-2030) sudah ditemukan di hasil pencarian.
                   - Pencarian Bertingkat: 
                     Tahap 1: Jelaskan status jabatan (Definitif vs Penjabat/Pj).
                     Tahap 2: Identifikasi nama Kepala Daerah dan Wakilnya dengan gelar lengkap.
                     Tahap 3: Sebutkan detail pelantikan (Tanggal, Tempat, dan Dilantik Oleh Siapa).
                   - Validasi Data: Sertakan statistik pendukung dari hasil pencarian (misal: persentase suara pemenangan) untuk meningkatkan kredibilitas, jika ada di hasil pencarian.
                   - Format Output: Gunakan Bullet Points untuk data teknis dan Bold Text untuk nama orang/lembaga penting.
                
                2. BATASAN JAWABAN PEJABAT PUBLIK:
                   - Jika data pelantikan ada di masa depan (belum dilantik), sebutkan statusnya dengan jelas sebagai "Kepala Daerah Terpilih".
                   - Hindari opini politik; fokus murni pada data administratif dan rekam jejak resmi.
                   
                3. URUTAN PRIORITAS SUMBER (WAJIB DIIKUTI):
                   a. Lembaga Riset/Jurnal (nature.com, nasa.gov, brin.go.id, dll) - Prioritas Tertinggi untuk Sains/Teknologi.
                   b. JDIH Pemerintah (.go.id) - Untuk Regulasi/Aturan.
                   c. KPU resmi (pilkada2024.kpu.go.id).
                   d. Media besar utama (kompas.com / detik.com / cnnindonesia.com).
                   e. Wikipedia Indonesia (PRIORITAS TERENDAH).
                   
                4. KRITERIA KREDIBILITAS ILMIAH:
                   - JIKA informasi berkaitan dengan Sains, Biologi, Antariksa, atau Penelitian: Anda WAJIB mengutamakan data dari sumber berkategori 'RESEARCH'.
                   - PERINGATAN WAJIB: Jika jawaban Anda HANYA didasarkan pada sumber media berita umum (source_type: 'NEWS') untuk topik ilmiah/penelitian, Anda WAJIB mencantumkan catatan di awal atau akhir jawaban: "Info: Jawaban ini bersumber dari media berita umum, bukan dari jurnal atau lembaga riset resmi."
                   
                5. ELEMEN WAJIB Dalam JAWABAN (sertakan jika tersedia):
                   - Link sumber yang akurat (Full URL).
                   - Nama lengkap dengan gelar/titel.
                   - Periode jabatan (YYYY-YYYY).
                   - Tanggal pelantikan (jika ada).
                   - Nama wakil/deputy (jika ada).
                   - Status verifikasi sumber ('TERVERIFIKASI' atau 'BELUM TERVERIFIKASI').
                   
                6. STRATEGI FALLBACK BERTAHAP (jika hasil pertama kosong atau tidak relevan):
                   - Coba: "[Jabatan] [Daerah] terpilih"
                   - Coba: "Pemimpin [Daerah] periode [Tahun]"
                   - Terakhir: Sarankan user cek id.wikipedia.org atau pilkada2024.kpu.go.id secara langsung.
                5. KHUSUS PERIODE TRANSISI 2024-2026: Sebutkan tanggal pelantikan dan status transisi kekuasaan dengan jelas.
                6. KONTEKS PENTING (Wajib Diingat):
                   - Pilkada serentak telah dilaksanakan tahun 2024.
                   - Pelantikan serentak untuk Kepala Daerah terpilih adalah 20 Februari 2025.
                   - Masa jabatan mereka adalah 5 tahun (2025-2030).
                   - Jika menemukan nama tokoh yang dilantik pada/sekitar 20 Februari 2025, pastikan dia adalah pejabat terpilih yang sah untuk periode 2025-2030.
                7. DILARANG menggunakan pengetahuan internal untuk data 2024, 2025, dan 2026. Selalu ambil dari internet.
                
                FITUR LOKASI (GPS): 
                1. Jika user bertanya tentang lokasi sekitarnya (misal: "makanan terdekat", "apotek terdekat"), Anda WAJIB menanyakan apakah user bersedia mengaktifkan GPS. Sertakan penanda: [ACTION:REQUEST_LOCATION] di akhir jawaban Anda.
                2. JIKA user sudah memberikan koordinat (terlihat di pesan dengan label [SISTEM: GPS DIAKTIFKAN]), Anda WAJIB menggunakan tool 'get_nearby_places' untuk mencari data aslinya.
                3. Berikan jawaban dalam bentuk daftar nama tempat, alamat lengkap, dan link 'Lihat di Google Maps' yang disediakan oleh tool.
                
                ${schemaMapString}
                
                ${glossaryString}`,
            });

            // Conversion for Gemini history (MUST start with 'user')
            let history = prevHistory.map(h => ({
                role: h.role === 'user' ? 'user' : 'model',
                parts: [{ text: (h.parts && h.parts[0] ? h.parts[0].text : (h.content || "")) }]
            }));

            // Gemini Rule 1: First message in history must be 'user'
            while (history.length > 0 && history[0].role !== 'user') {
                history.shift();
            }

            // Gemini Rule 2: Current message should NOT be in history when using startChat + sendMessage
            if (history.length > 0) {
                history.pop();
            }

            let userText = userMessage;
            if (fileContext) userText = `${fileContext}\n\n${userText}`;
            
            const chat = model.startChat({
                history: history,
                generationConfig: {
                    maxOutputTokens: 4096,
                },
            });
            // --- MULTI-FILE PRE-PROCESSOR ---
            const parts = [];
            const attachmentList = Array.isArray(files) ? files : [];
            
            for (const file of attachmentList) {
                const { base64, mimeType } = file;
                if (!base64 || !mimeType) continue;

                const isExcel = mimeType.includes('spreadsheetml') || mimeType.includes('excel') || mimeType.includes('officedocument.spreadsheetml.sheet');
                const isCSV = mimeType.includes('csv');

                if (isExcel || isCSV) {
                    try {
                        console.log(`[Nayaxa] Pre-processing ${isExcel ? 'Excel' : 'CSV'} file...`);
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const workbook = XLSX.read(buffer, { type: 'buffer' });
                        let sheetData = "";
                        workbook.SheetNames.forEach(sheetName => {
                            const sheet = workbook.Sheets[sheetName];
                            const csv = XLSX.utils.sheet_to_csv(sheet);
                            sheetData += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                        });
                        userText = `${userText}\n\nDATA FILE (${isExcel ? 'EXCEL' : 'CSV'}): \n${sheetData}`;
                    } catch (err) {
                        console.error('File Pre-process Error:', err);
                    }
                } else {
                    const cleanBase64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                    parts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: cleanBase64
                        }
                    });
                }
            }

            parts.unshift({ text: userText });

            let result = await chat.sendMessage(parts);
            let response = result.response;
            
            const generatedChartMarkers = [];
            let loop = 0;

            while (response.functionCalls()?.length > 0 && loop < 5) {
                loop++;
                const callResponses = [];
                for (const call of response.functionCalls()) {
                    // Capture the first Excel file's base64 for filling purposes
                    const excelFile = attachmentList.find(f => f.mimeType.includes('spreadsheetml') || f.mimeType.includes('excel') || f.mimeType.includes('officedocument.spreadsheetml.sheet'));
                    const excelBase64 = excelFile ? excelFile.base64 : null;

                    let execResult = await toolFunctions[call.name]({ ...call.args, instansi_id, month, year }, { app_id: 1, baseUrl, excelBase64 }); 
                    if (call.name === 'generate_chart' && execResult.success) {
                        generatedChartMarkers.push(execResult.chart_marker);
                        execResult = { success: true, message: 'Chart ready.' };
                    }
                    callResponses.push({ functionResponse: { name: call.name, response: execResult } });
                }
                result = await chat.sendMessage(callResponses);
                response = result.response;
            }

            let finalText = response.text();
            if (generatedChartMarkers.length > 0) finalText += "\n\n" + generatedChartMarkers.join("\n\n");
            return finalText;
        } catch (error) {
            console.error('--- GEMINI CRITICAL ERROR ---');
            console.error('Message:', error.message);
            
            // Specific 429 (Rate Limit) Handling
            if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
                return "Maaf, Nayaxa sedang sibuk, silakan coba lagi.";
            }

            return `Maaf, terjadi kesalahan teknis pada Nayaxa Engine: ${error.message}`;
        }
    }
};

module.exports = nayaxaGeminiService;
