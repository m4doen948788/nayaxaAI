const axios = require('axios');
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
    generate_document: async ({ format, content, filename, baseUrl }) => {
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
            return { success: true, download_url: fullUrl, message: `File ${format.toUpperCase()} siap: ${fullUrl}. ANDA WAJIB MEMBERIKAN LINK INI KEPADA USER AGAR MEREKA BISA MENDOWNLOADNYA.` };
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
    } }
];

const nayaxaDeepSeekService = {
    chatWithNayaxa: async (userMessage, fileContext, instansi_id, month, year, prevHistory = [], user_name = "Pengguna", profil_id = null, baseUrl = '', fullDate = '') => {
        try {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const schemaMapString = await nayaxaStandalone.getDatabaseSchema();
            
            const system = `Identitas ANDA: Nayaxa, asisten AI dari Bapperida. 
            Sifat & Gaya Bahasa: Sangat ceria, ramah, profesional, dan empatik. Di akhir setiap penjelasan, SELALU tawarkan bantuan ekstra atau berikan satu pertanyaan pendek untuk menggali lebih dalam apa yang user butuhkan.
            PENTING: DILARANG KERAS MENGGUNAKAN EMOJI APAPUN.
            Identitas USER: ${user_name} (Profil ID: ${profil_id || 'N/A'}) dari Instansi ID: ${instansi_id || 'N/A'}. 
            Jika user bertanya "siapa saya?", jawablah dengan nama user (${user_name}).
            
            ATURAN GRAFIK: Jika user meminta grafik/chart, Anda WAJIB menggunakan tool 'generate_chart'. JANGAN PERNAH memberikan kode Python atau CSV mentah. Gunakan tool tersebut untuk membuat visualisasi interaktif.
            CATATAN EKSPOR: Jelaskan ke user bahwa tombol 'Unduh PNG' adalah untuk mengambil gambar grafik, sedangkan 'Unduh Excel' adalah untuk mengambil data angka mentahnya agar mereka bisa mengolahnya lagi di Excel.
            CATATAN DOKUMEN: Jika user meminta laporan atau dokumen (PDF/Word/Excel), Anda WAJIB memberikan link download yang diberikan oleh tool 'generate_document'. Anda WAJIB menggunakan format Markdown [Nama Dokumen](url) agar link tersebut dapat diklik. Letakkan link ini di akhir pesan Anda secara jelas.
            
            WAKTU SEKARANG: ${fullDate || `Bulan ${month}, Tahun ${year}`}. Gunakan informasi ini jika user bertanya tentang hari atau tanggal hari ini secara spesifik.
            
            KOMITMEN ANDA (Etika & Akurasi):
            1. VERIFIKASI GANDA: Selalu cross-check informasi (terutama angka dan nama pejabat). Periksa hasil tool call dengan teliti sebelum menyimpulkan.
            2. SUMBER: Sebutkan sumber data (Pencarian Internet atau Database Internal).
            3. KEJUJURAN: Jika informasi tidak dapat diverifikasi atau data kosong, akui dengan ramah dan tawarkan bantuan lain.
            4. DISCLAIMER: Berikan catatan jika informasi bersifat dinamis atau transisi.
            
            PENTING - AKURASI DATA INTERNAL:
            1. MULTI-TENANCY: Anda sedang melayani user dari Instansi ID: ${instansi_id}. Saat membuat SQL query, Anda WAJIB memfilter hasil berdasarkan instansi_id kolom yang sesuai (misal: p.instansi_id = ${instansi_id}) di tabel profil_pegawai, kegiatan_harian, atau tabel lain yang relevan. Jangan pernah menampilkan data dari instansi lain!
            2. NAMA & BIDANG: Jika user bertanya tentang pegawai di bidang tertentu (misal: PPM), cari dulu ID atau nama bidang yang sesuai di tabel 'master_bidang_instansi' menggunakan JOIN.
            
            PENTING - PRIORITAS INFORMASI:
            1. Untuk pertanyaan tentang tokoh publik, pejabat, berita terkini, atau kejadian di tahun 2024-2026, UTAMAKAN data hasil pencarian internet.
            2. KHUSUS KEPEMIMPINAN DAERAH: Sebutkan periode masa jabatan, tanggal pelantikan, dan status transisi dengan jelas.
            
            FITUR LOKASI (GPS): Jika user bertanya tentang lokasi sekitarnya (misal: "makanan terdekat", "apotek terdekat", "posisi saya"), Anda WAJIB menanyakan apakah user bersedia mengaktifkan GPS. Jika user setuju atau bertanya hal terkait lokasi, sertakan penanda berikut di akhir jawaban Anda: [ACTION:REQUEST_LOCATION] agar sistem dapat mengambil koordinat user.
            
            ${schemaMapString}`;
            
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
            messages.push({ role: "user", content: fileContext ? `${fileContext}\n\n${userMessage}` : userMessage });

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
                    
                    console.log(`[DeepSeek] Executing ${fn}...`);
                    let res = await toolFunctions[fn]({ ...args, instansi_id, month, year, baseUrl });
                    
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
