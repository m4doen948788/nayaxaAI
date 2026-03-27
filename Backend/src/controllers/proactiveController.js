const nayaxaStandalone = require('../services/nayaxaStandalone');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// In-Memory Cache for proactive insights (TTL 30 mins)
const proactiveCache = new Map();

// Mapping routes to specific data fetchers
const routeToDataMap = {
    '/': 'getDashboardInsights',
    '/dashboard': 'getDashboardInsights',
    '/manajemen-pegawai': 'getPegawaiStatistics',
    '/data-pegawai': 'getPegawaiStatistics',
    '/kegiatan-pegawai': 'getPegawaiStatistics',
    '/laporan-kegiatan': 'forecastTrends',
    '/monitoring-anomali': 'detectAnomalies',
};

const appPersonas = {
    'dashboard_bapperida': {
        name: 'Nayaxa',
        role: 'asisten AI Bapperida',
        style: 'cerdas, profesional, dan bangga dengan data pembangunan'
    },
    'puskesmas': {
        name: 'Nayaxa Health',
        role: 'asisten kesehatan cerdas',
        style: 'perhatian, edukatif, dan sangat peduli dengan kesehatan warga'
    },
    'sekolah': {
        name: 'Nayaxa Edu',
        role: 'sahabat pendidikan',
        style: 'inspiratif, mendukung, dan fokus pada kemajuan akademik siswa'
    }
};

const proactiveController = {
    getProactiveInsight: async (req, res) => {
        try {
            const { current_page, instansi_id } = req.query;
            const app = req.nayaxaApp; // From apiKeyMiddleware
            const persona = appPersonas[app.app_name] || appPersonas['dashboard_bapperida'];
            
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();

            const route = current_page || '/';
            // Sort keys by length descending to match most specific route first
            const matchedRoute = Object.keys(routeToDataMap)
                .sort((a, b) => b.length - a.length)
                .find(r => route === r || (r !== '/' && route.startsWith(r)));
            
            const dataFunction = routeToDataMap[matchedRoute] || 'getDashboardInsights';

            const cacheKey = `${instansi_id}_${dataFunction}`;
            if (proactiveCache.has(cacheKey)) {
                const cached = proactiveCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 1800000) {
                    return res.json(cached.data);
                }
            }

            // Fetch relevant data based on route
            let data = null;
            let insightTopic = "";

            switch (dataFunction) {
                case 'getPegawaiStatistics':
                    data = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
                    insightTopic = "Statistik Pegawai";
                    break;
                case 'forecastTrends':
                    data = await nayaxaStandalone.forecastTrends(instansi_id, month, year);
                    insightTopic = "Tren Kegiatan";
                    break;
                case 'detectAnomalies':
                    data = await nayaxaStandalone.detectAnomalies(instansi_id);
                    insightTopic = "Peringatan Anomali";
                    break;
                default:
                    data = await nayaxaStandalone.getPegawaiStatistics(instansi_id, month, year);
                    insightTopic = "Ringkasan Dashboard";
            }

            // Generate a very short proactive insight using Gemini
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
            
            const prompt = `Anda adalah ${persona.name}, ${persona.role}. 
            Gaya bicara Anda: ${persona.style}.
            Berdasarkan data ${insightTopic} berikut: ${JSON.stringify(data)}. 
            Berikan SATU kalimat singkat (maks 20 kata) yang menarik, ceria, dan informatif untuk menyapa user di halaman ${route}. 
            Gunakan bahasa Indonesia yang santun tapi asyik. JANGAN gunakan emoji.`;

            const result = await model.generateContent(prompt);
            const insightText = result.response.text().trim();

            const response = {
                success: true,
                topic: insightTopic,
                insight: insightText,
                data_summary: data
            };

            proactiveCache.set(cacheKey, { timestamp: Date.now(), data: response });
            res.json(response);

        } catch (error) {
            console.error('Proactive Insight Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = proactiveController;
