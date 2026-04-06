const axios = require('axios');
const XLSX = require('xlsx');
const dbDashboard = require('../config/dbDashboard');
const nayaxaStandalone = require('./nayaxaStandalone');
const exportService = require('./exportService');

/**
 * DeepSeek Service with DSML Parser
 * Special handling for DeepSeek's native tool call format if standard tool_calls fail.
 */

const toolFunctions = {
    search_internet: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.searchInternet(query);
        return { internet_result: jsonResult };
    },
    execute_sql_query: async ({ query }) => {
        const jsonResult = await nayaxaStandalone.executeReadOnlyQuery(query);
        return { database_result: jsonResult };
    },
    search_database: async ({ query }) => { // Map AI-hallucinated name
        return await toolFunctions.execute_sql_query({ query });
    },
    generate_document: async ({ format, content, filename }, { baseUrl }) => {
        try {
            const downloadUrl = await (format === 'excel' ? exportService.generateExcel(content, filename) :
                                format === 'pdf' ? exportService.generatePDF(content, filename) :
                                exportService.generateWord(content, filename));
            
            return { success: true, download_url: downloadUrl, message: `File ${format.toUpperCase()} siap! Berikan link ini ke user: ${downloadUrl}` };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    generate_chart: async ({ type, title, data, series, unit, color }) => {
        try {
            let chartSpec;
            if (series) {
                chartSpec = { type: type || 'line', title, series: JSON.parse(series), unit, color };
            } else {
                chartSpec = { type: type || 'bar', title, data: JSON.parse(data), unit, color };
            }
            const b64 = Buffer.from(JSON.stringify(chartSpec)).toString('base64');
            return { success: true, chart_marker: `[NAYAXA_CHART]${b64}[/NAYAXA_CHART]`, message: 'Chart ready.' };
        } catch (err) {
            return { success: false, error: err.message };
        }
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

/**
 * Parses DSML-style function calls from raw text.
 * Example: < | DSML | invoke name="execute_sql_query">< | DSML | parameter name="query" string="true">SELECT...
 */
const parseDSML = (text) => {
    const toolCalls = [];
    const DSML_REGEX = /< \| DSML \| invoke name="([^"]+)">([\s\S]*?)<\/ \| DSML \| invoke>/g;
    const PARAM_REGEX = /< \| DSML \| parameter name="([^"]+)"(?:\s+string="true")?>([\s\S]*?)<\/ \| DSML \| parameter>/g;

    let match;
    while ((match = DSML_REGEX.exec(text)) !== null) {
        const fnName = match[1];
        const paramsRaw = match[2];
        const args = {};
        
        let pMatch;
        while ((pMatch = PARAM_REGEX.exec(paramsRaw)) !== null) {
            args[pMatch[1]] = pMatch[2].trim();
        }
        
        toolCalls.push({
            id: `dsml_call_${Math.random().toString(36).substr(2, 9)}`,
            function: { name: fnName, arguments: JSON.stringify(args) }
        });
    }
    return toolCalls;
};

const DEEPSEEK_TOOLS = [
    { 
        type: "function", 
        function: { 
            name: "execute_sql_query", 
            description: "Query SQL mentah untuk mengambil data dashboard. PENTING: Anda WAJIB menyertakan filter instansi_id (sesuai profil user) di setiap query untuk menjaga akurasi data.", 
            parameters: { type: "object", properties: { query: { type: "string", description: "Query SQL SELECT. Gunakan JOIN jika perlu." } }, required: ["query"] } 
        } 
    },
    { type: "function", function: { name: "search_internet", description: "Cari internet menggunakan Polyglot Search (Resilience Mode).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { 
        name: "generate_chart", 
        description: "Membuat grafik/chart interaktif.", 
        parameters: { 
            type: "object", 
            properties: { 
                type: { type: "string", description: "bar, column, line, pie, donut" },
                title: { type: "string", description: "Judul grafik" },
                data: { type: "string", description: "JSON string [{label, value}]" },
                series: { type: "string", description: "JSON string [{name, data:[{label,value}]}]" },
                unit: { type: "string", description: "Satuan data" },
                color: { type: "string", description: "Warna tema" }
            }, 
            required: ["type", "title"] 
        } 
    } },
    { type: "function", function: { 
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
    } },
    { type: "function", function: { 
        name: "ingest_to_knowledge", 
        description: "Menyimpan informasi dari dokumen ke dalam memori pengetahuan (Knowledge Base) Nayaxa.", 
        parameters: { 
            type: "object", 
            properties: { 
                category: { type: "string", description: "Kategori informasi" },
                content: { type: "string", description: "Intisari informasi penting" },
                source_file: { type: "string", description: "Nama file sumber" }
            }, 
            required: ["category", "content", "source_file"] 
        } 
    } },
    { type: "function", function: { 
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
    } }
];

const nayaxaDeepSeekService = {
    chatWithNayaxa: async (userMessage, fileContext, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, baseUrl = '', fullDate = '', files = [], nama_instansi = 'N/A', personaPromptSnippet = '') => {
        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            
            const system = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida yang dibuat oleh Sammy. 
            Sifat & Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek untuk menggali lebih dalam apa yang user butuhkan.
            PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
            Identitas USER: ${user_name} (Profil ID: ${profil_id || 'N/A'}) dari Instansi: ${nama_instansi}. 
            Jika user bertanya "siapa saya?", jawablah dengan nama user (${user_name}).
            ${personaPromptSnippet}
            PENTING: Sesuaikan tingkat formalitas Anda dengan Profil Kepribadian User. Jika user terbiasa santai (Gue/Lo), Anda diperbolehkan menggunakan gaya bicara yang serupa namun tetap sopan, ceria, dan membantu.
            
            ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH memberikan kode Python atau CSV mentah. Gunakan tool tersebut untuk membuat visualisasi interaktif.
            CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya agar mereka bisa mengolahnya lagi di Excel.
            CATATAN DOKUMEN: Jika user meminta laporan atau dokumen (PDF/Word/Excel), Anda WAJIB memberikan link download yang diberikan oleh tool 'generate_document'. Anda WAJIB menggunakan format Markdown [Unduh Laporan (Jenis)] (url) agar link tersebut dapat diklik (Ganti 'Jenis' dengan PDF/Excel/Word sesuai filenya). Letakkan link ini di akhir pesan Anda secara jelas.
            
            PENGISIAN EXCEL: Jika user mengunggah file Excel (Template) dan meminta Anda untuk "mengisi", "lengkapi", atau "masukkan data" ke dalamnya, gunakan tool 'fill_excel_template'. 
            TEKNIK PENGISIAN: 
            - Gunakan key "uraian" atau "label" untuk mencocokkan baris yang ingin diisi. 
            - Gunakan key lain yang sesuai dengan Nama Header Kolom (misal: "hasil verifikasi", "rekomendasi", "keterangan") untuk mengisi nilainya.
            - Contoh: [{"uraian": "Lokasi", "rekomendasi": "Masukkan alamat lengkap"}] akan mencari baris yang mengandung kata 'Lokasi' dan mengisi kolom 'REKOMENDASI' di baris tersebut.
            BERIKAN LINK DOWNLOAD HASILNYA kepada user.
            
            WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}. Gunakan informasi ini jika user bertanya tentang hari atau tanggal hari ini secara spesifik.
            
            KOMITMEN ANDA (Etika & Akurasi):
            1. VERIFIKASI GANDA: Selalu cross-check informasi (terutama angka dan nama pejabat). Periksa hasil tool call dengan teliti sebelum menyimpulkan.
            2. LABEL SUMBER: Sebutkan sumber spesifik setiap informasi (misal: "Berdasarkan rilis detik.com (2 Jan 2025)..."). Gunakan link dari JDIH (jdih.bogorkab.go.id atau jdih.go.id) sebagai prioritas utama jika jawaban berkaitan dengan regulasi/hukum/aturan daerah.
            3. LABEL KEPERCAYAAN: Jika hasil pencarian bertanda 'TERVERIFIKASI', sampaikan dengan yakin. Jika 'BELUM TERVERIFIKASI', berikan disclaimer: "Catatan: Informasi ini belum dapat diverifikasi dari sumber resmi. Harap konfirmasi langsung ke sumber terkait."
            4. DISCLAIMER WAJIB: Berikan catatan jika informasi bersifat dinamis atau bisa berubah, terutama untuk kepemimpinan daerah periode transisi.
            5. FALLBACK WAJIB: Jika data tidak tersedia atau tidak lengkap, SARANKAN USER untuk memeriksa sendiri sumber spesifik: jdih.bogorkab.go.id, id.wikipedia.org, pilkada2024.kpu.go.id, detik.com, kompas.com.
            6. SUMBER REFERENSI: Di AKHIR JAWABAN, Anda WAJIB menyertakan daftar link sumber yang Anda gunakan dalam format Markdown [Judul Artikel](URL) (domain, search_date) di bawah tajuk "SUMBER REFERENSI:". Ekstrak 'domain' dari link sumber tersebut (misal: kompasiana.com, detik.com, dsb) dan sertakan tepat di samping search_date di dalam kurung.
            
            ATURAN KOMUNIKASI PENTING (DILARANG BERPIKIR KERAS / INTERNAL MONOLOGUE):
            - JANGAN PERNAH menjelaskan proses pencarian Anda kepada user (Contoh SALAH: "Mari saya cari di internet...", "Saya akan membuka halaman Wikipedia...", "Tunggu sebentar saya cek database...").
            - LANGSUNG BERIKAN JAWABAN AKHIR dari hasil pencarian Anda, terlepas apakah data itu lengkap atau tidak.
            - JANGAN PERNAH memberikan pesan menggantung tanpa konklusi.
            
            PENTING - AKURASI DATA INTERNAL:
            1. MULTI-TENANCY: Anda sedang melayani user dari Instansi: ${nama_instansi} (ID Internal: ${instansi_id}). Saat membuat SQL query, Anda WAJIB memfilter hasil berdasarkan instansi_id kolom yang sesuai (misal: p.instansi_id = ${instansi_id}) di tabel profil_pegawai, kegiatan_harian, atau tabel lain yang relevan. Jangan pernah menampilkan data dari instansi lain!
            2. NAMA & BIDANG: Jika user bertanya tentang pegawai di bidang tertentu (misal: PPM), cari dulu ID atau nama bidang yang sesuai di tabel 'master_bidang_instansi' menggunakan JOIN.
            
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
               - SKEPTISISME PJ (ACTING): Di tahun 2026, Gubernur/Bupati/Walikota seharusnya adalah PEJABAT DEFINITIF terpilih hasil Pilkada 2024 (dilantik 20 Feb 2025). Jika hasil pencarian menyebutkan nama Penjabat (Pj), Plt, atau Pjs, periksa apakah ada nama lain yang berstatus "Terpilih" atau "Dilantik 2025". Jika ada, nama Pj tersebut adalah MANTAN/TIDAK LAGI MENJABAT.
               - ANTI-HALUSINASI JABAR: Bey Machmudin adalah Penjabat (Pj). Dedi Mulyadi adalah yang Terpilih 2025-2030. JANGAN PERNAH menyebut Bey Machmudin sebagai pejabat "Terpilih" atau "Definitif" di Jawa Barat.
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
               
            5. ELEMEN WAJIB DALAM JAWABAN (sertakan jika tersedia):
               - Link sumber yang akurat (Full URL).
               - Nama lengkap dengan gelar/titel.
               - Periode jabatan (YYYY-YYYY).
               - Tanggal pelantikan (jika ada).
               - Nama wakil/deputy (jika ada).
               - Status verifikasi sumber ('TERVERIFIKASI' atau 'BELUM TERVERIFIKASI').
               
            6. STRATEGI FALLBACK BERTAHAP (jika hasil pertama kosong/tidak relevan):
               - Coba query alternatif: "[Jabatan] [Daerah] terpilih"
               - Kemudian: "Pemimpin [Daerah] periode [Tahun]"
               - Terakhir: Sarankan user cek langsung id.wikipedia.org atau pilkada2024.kpu.go.id.
            5. KHUSUS PERIODE TRANSISI 2024-2026: Sebutkan tanggal pelantikan dan status transisi kekuasaan dengan jelas.
            6. KONTEKS PENTING (Wajib Diingat):
               - Pilkada serentak telah dilaksanakan tahun 2024.
               - Pelantikan serentak untuk Kepala Daerah terpilih adalah 20 Februari 2025.
               - Masa jabatan mereka adalah 5 tahun (2025-2030).
               - Jika menemukan nama tokoh yang dilantik pada/sekitar 20 Februari 2025, pastikan dia adalah pejabat terpilih yang sah untuk periode 2025-2030.
               - PERINGATAN TOKOH TRANSISI: Hindari menyebut Hassanudin (Sumut), Iwan Setiawan (Bogor), Bey Machmudin (Jabar), atau Pj lainnya sebagai "Gubernur/Bupati Sekarang" jika ada data pelantikan Feb 2025 untuk Bobby Nasution (Sumut), Rudy Susmanto (Bogor), Dedi Mulyadi (Jabar), dsb.
               - CALON TUNGGAL: JANGAN menyebut seseorang terpilih sebagai "Calon Tunggal" kecuali hasil pencarian secara eksplisit (dari KPU/Detik/Kompas) menyatakan demikian.
            7. DILARANG menggunakan pengetahuan internal untuk data 2024, 2025, 2026. Selalu ambil dari internet.
            
            FITUR LOKASI (GPS): Jika user bertanya tentang lokasi sekitarnya, Anda WAJIB menanyakan apakah user bersedia mengaktifkan GPS. Sertakan penanda: [ACTION:REQUEST_LOCATION] di akhir jawaban Anda.
            
            ${schemaMapString}`;
            
            // --- MULTI-FILE PRE-PROCESSOR ---
            let firstImage = null;
            const attachmentList = Array.isArray(files) ? files : [];

            for (const file of attachmentList) {
                const { base64, mimeType } = file;
                if (!base64 || !mimeType) continue;

                const isExcel = mimeType.includes('spreadsheetml') || mimeType.includes('excel') || mimeType.includes('officedocument.spreadsheetml.sheet');
                const isCSV = mimeType.includes('csv');
                
                if (isExcel || isCSV) {
                    try {
                        console.log(`[DeepSeek] Pre-processing ${isExcel ? 'Excel' : 'CSV'} file...`);
                        const cleanB64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const workbook = XLSX.read(buffer, { type: 'buffer' });
                        let sheetData = "";
                        workbook.SheetNames.forEach(sheetName => {
                            const sheet = workbook.Sheets[sheetName];
                            const csv = XLSX.utils.sheet_to_csv(sheet);
                            sheetData += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                        });
                        fileContext = (fileContext ? fileContext + '\n\n' : '') + `DATA FILE (${isExcel ? 'EXCEL' : 'CSV'}):\n${sheetData}`;
                    } catch (err) {
                        console.error('DeepSeek File Pre-process Error:', err);
                    }
                } else if (mimeType.startsWith('image/') && !firstImage) {
                    // DeepSeek currently only supports one image via image_url in most compatible implementations
                    const cleanBase64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
                    firstImage = { mimeType, data: cleanBase64 };
                } else {
                    console.warn(`[DeepSeek] Unsupported file type detected and skipped: ${mimeType}`);
                }
            }

            let messages = [{ role: "system", content: system }];
            let historyToUse = [...prevHistory];
            // DeepSeek Rule: Current message should NOT be in history when we push it explicitly at the end
            if (historyToUse.length > 0) {
                historyToUse.pop();
            }

            historyToUse.forEach(h => {
                const role = h.role === 'user' ? 'user' : 'assistant';
                messages.push({ role, content: h.parts ? h.parts[0].text : h.content });
            });
            const userTextPart = fileContext ? `${fileContext}\n\n${userMessage}` : userMessage;
            if (firstImage) {
                messages.push({
                    role: "user",
                    content: [
                        { type: "text", text: userTextPart },
                        { type: "image_url", image_url: { url: `data:${firstImage.mimeType};base64,${firstImage.data}` } }
                    ]
                });
            } else {
                messages.push({ role: "user", content: userTextPart });
            }

            const callDeepSeek = async (msgs) => {
                return await axios.post('https://api.deepseek.com/v1/chat/completions', {
                    model: "deepseek-chat",
                    messages: msgs,
                    tools: DEEPSEEK_TOOLS,
                    temperature: 0.1,
                    max_tokens: 8192
                }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            };

            let response = await callDeepSeek(messages);
            let message = response.data.choices[0].message;
            const generatedChartMarkers = [];
            let loop = 0;

            while (loop < 5) {
                const nativeToolCalls = message.tool_calls || [];
                const dsmlToolCalls = parseDSML(message.content || "");
                const combinedToolCalls = [...nativeToolCalls, ...dsmlToolCalls];

                if (combinedToolCalls.length === 0) break;
                loop++;

                messages.push(message);

                for (const call of combinedToolCalls) {
                    const fn = call.function.name;
                    const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
                    
                    // Capture the first Excel file's base64 for filling purposes
                    const excelFile = attachmentList.find(f => f.mimeType.includes('spreadsheetml') || f.mimeType.includes('excel') || f.mimeType.includes('officedocument.spreadsheetml.sheet'));
                    const excelBase64 = excelFile ? excelFile.base64 : null;

                    console.log(`[DeepSeek] Executing ${fn}...`);
                    let res = await toolFunctions[fn]({ ...args, instansi_id, month, year }, { excelBase64, baseUrl });
                    
                    if (fn === 'generate_chart' && res.success) {
                        generatedChartMarkers.push(res.chart_marker);
                        res = { success: true, message: 'Chart ready.' };
                    }
                    
                    messages.push({ 
                        role: "tool", 
                        tool_call_id: call.id, 
                        content: JSON.stringify(res) 
                    });
                }
                
                response = await callDeepSeek(messages);
                message = response.data.choices[0].message;
            }

            let text = message.content || "";
            // Remove DSML tags from final text if they leaked through
            text = text.replace(/< \| DSML \| [\s\S]*?>/g, '').replace(/<\/ \| DSML \| [\s\S]*?>/g, '').trim();
            
            if (generatedChartMarkers.length > 0) text += "\n\n" + generatedChartMarkers.join("\n\n");
            return text;
        } catch (error) {
            console.error('DeepSeek Error:', error.message);
            // Specific 429 (Rate Limit) Handling
            if (error.response?.status === 429 || error.message?.includes('429')) {
                return "Maaf, Nayaxa sedang sibuk, silakan coba lagi.";
            }
            return `Maaf, terjadi gangguan saat Nayaxa memproses data: ${error.message}`;
        }
    }
};

module.exports = nayaxaDeepSeekService;
