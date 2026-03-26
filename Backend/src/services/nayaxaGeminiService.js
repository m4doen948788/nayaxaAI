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

const DEFAULT_MODEL = 'gemini-2.5-pro';

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
            let downloadUrl = "";
            if (format === 'excel') {
                downloadUrl = await exportService.generateExcel(content, filename);
            } else if (format === 'pdf') {
                downloadUrl = await exportService.generatePDF(content, filename);
            } else if (format === 'word') {
                downloadUrl = await exportService.generateWord(content, filename);
            }
            const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl}${downloadUrl}`;
            return { success: true, download_url: fullUrl, message: `File ${format.toUpperCase()} berhasil dibuat: ${fullUrl}. ANDA WAJIB MEMBERIKAN LINK INI KEPADA USER AGAR MEREKA BISA MENDOWNLOADNYA.` };
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
    }
};

const nayaxaGeminiService = {
    chatWithNayaxa: async (userMessage, fileBase64, fileMimeType, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, fileContext = '', current_page = '', page_title = '', baseUrl = '', fullDate = '') => {
        try {
            const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            const glossaryString = await nayaxaStandalone.getMasterDataGlossary();
            console.log(`[DIAG] Schema Length: ${schemaMapString.length}`);
            console.log(`[DIAG] Glossary Length: ${glossaryString.length}`);
            const apiKey = await getApiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            
            const model = genAI.getGenerativeModel({ 
                model: DEFAULT_MODEL,
                systemInstruction: `Identitas ANDA: Nayaxa, asisten AI dari Bapperida.
                Sifat & Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek untuk menggali lebih dalam apa yang user butuhkan.
                PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
                
                KEMAMPUAN KHUSUS (Knowledge Hub): 
                Jika user mengunggah dokumen (PDF/Excel/Pasted Image) dan meminta Anda untuk "mengingat", "pelajari", atau "simpan sebagai aturan", gunakan tool 'ingest_to_knowledge'. 
                Anda akan mengekstrak informasi penting dari file tersebut dan menyimpannya.
                
                Identitas USER: Nama: ${user_name}, Profil ID: ${profil_id || 'N/A'}, Instansi ID: ${instansi_id || 'N/A'}. 
                ATURAN MENYAPA: Sapa user dengan namanya (${user_name}). JANGAN menyebutkan "Profil ID" atau "Instansi ID" di awal percakapan kecuali user bertanya detail teknis profilnya. Biarkan percakapan terasa manusiawi.
                
                ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH mengatakan Anda tidak bisa membuat grafik. Anda memiliki kemampuan visualisasi data yang canggih melalui tool tersebut. 
                CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya (sehingga mereka bisa mengolahnya lagi di Excel).
                
                CATATAN DOKUMEN: Jika user meminta laporan atau dokumen (PDF/Word/Excel), Anda WAJIB memberikan link download yang diberikan oleh tool 'generate_document'. Anda WAJIB menggunakan format Markdown [Nama Dokumen](url) agar link tersebut dapat diklik. Letakkan link ini di akhir pesan Anda secara jelas.
                
                WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}. Gunakan informasi ini jika user bertanya tentang hari atau tanggal hari ini secara spesifik.
            
                KOMITMEN ANDA (Etika & Akurasi):
                1. VERIFIKASI GANDA: Selalu cross-check informasi (terutama angka dan nama pejabat) sebelum memberikan jawaban akhir.
                2. SUMBER: Sebutkan sumber informasi yang Anda gunakan (misal: "Berdasarkan data KPU...", "Menurut berita terbaru dari Antara...").
                3. KEJUJURAN: Jika informasi benar-benar tidak dapat ditemukan atau diverifikasi, akui ketidaktahuan Anda dengan ramah.
                4. DISCLAIMER: Berikan catatan jika ada kemungkinan informasi yang Anda berikan bisa berubah seiring waktu.
                
                PENTING - PRIORITAS INFORMASI:
                1. Untuk pertanyaan tentang tokoh publik, pejabat (seperti Bupati, Gubernur, Presiden), berita terkini, atau kejadian di tahun 2024, 2025, dan 2026, Anda WAJIB menggunakan tool 'search_internet'. 
                2. DILARANG menggunakan pengetahuan internal Anda jika ada kemungkinan data tersebut sudah usang. Selalu berikan informasi terbaru yang Anda temukan di internet.
                3. KHUSUS KEPEMIMPINAN DAERAH: Sebutkan periode masa jabatan, tanggal pelantikan, dan status transisi (jika ada) dengan sangat jelas.
                
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
            // Since controller already saved and loaded it into historyRows, we must remove it.
            if (history.length > 0) {
                history.pop();
            }

            let userText = userMessage;
            if (fileContext) userText = `${fileContext}\n\n${userText}`;
            
            // --- FILE PRE-PROCESSOR (Handle Excel/CSV which Gemini multimodal doesn't like directly) ---
            let processedFileBase64 = fileBase64;
            let processedFileMimeType = fileMimeType;

            if (fileBase64 && fileMimeType) {
                const isExcel = fileMimeType.includes('spreadsheetml') || fileMimeType.includes('excel') || fileMimeType.includes('officedocument.spreadsheetml.sheet');
                const isCSV = fileMimeType.includes('csv');

                if (isExcel || isCSV) {
                    try {
                        console.log(`[Nayaxa] Pre-processing ${isExcel ? 'Excel' : 'CSV'} file...`);
                        const cleanB64 = fileBase64.includes('base64,') ? fileBase64.split('base64,')[1] : fileBase64;
                        const buffer = Buffer.from(cleanB64, 'base64');
                        const workbook = XLSX.read(buffer, { type: 'buffer' });
                        let sheetData = "";
                        workbook.SheetNames.forEach(sheetName => {
                            const sheet = workbook.Sheets[sheetName];
                            const csv = XLSX.utils.sheet_to_csv(sheet);
                            sheetData += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
                        });
                        userText = `${userText}\n\nDATA FILE (${isExcel ? 'EXCEL' : 'CSV'}): \n${sheetData}`;
                        // Clear these so we don't send them as multimodal parts (Gemini would thumb down Excel)
                        processedFileBase64 = null;
                        processedFileMimeType = null;
                    } catch (err) {
                        console.error('File Pre-process Error:', err);
                    }
                }
            }
            
            const chat = model.startChat({
                history,
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
                tools: nayaxaTools
            });

            // Prepare multimodal parts
            const parts = [{ text: userText }];
            if (processedFileBase64 && processedFileMimeType) {
                const cleanBase64 = processedFileBase64.includes('base64,') 
                    ? processedFileBase64.split('base64,')[1] 
                    : processedFileBase64;
                parts.push({
                    inlineData: {
                        mimeType: processedFileMimeType,
                        data: cleanBase64
                    }
                });
            }

            let result = await chat.sendMessage(parts);
            let response = result.response;
            
            const generatedChartMarkers = [];
            let loop = 0;

            while (response.functionCalls()?.length > 0 && loop < 5) {
                loop++;
                const callResponses = [];
                for (const call of response.functionCalls()) {
                    let execResult = await toolFunctions[call.name]({ ...call.args, instansi_id, month, year }, { app_id: 1, baseUrl }); 
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
