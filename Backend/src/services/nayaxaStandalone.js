const pool = require('../config/dbDashboard');
const axios = require('axios');

/**
 * Nayaxa Standalone Engine (Adapted for Standalone Service)
 * This engine now queries the Dashboard DB using a readonly connection.
 */

const applyInstansiFilter = (alias, instansi_id) => {
    const prefix = alias ? `${alias}.` : '';
    return instansi_id ? `${prefix}instansi_id = ?` : '1=1';
};

const nayaxaStandalone = {

    getPegawaiStatistics: async (instansi_id, month, year) => {
        try {
            const params = instansi_id ? [instansi_id] : [];
            const filterClauseEmpty = applyInstansiFilter('', instansi_id);
            const [pegawai] = await pool.query(
                `SELECT COUNT(id) as total_pegawai FROM profil_pegawai WHERE ${filterClauseEmpty} AND is_active = 1`,
                params
            );

            const filterClauseP = applyInstansiFilter('p', instansi_id);
            const [activities] = await pool.query(`
                SELECT tipe_kegiatan, COUNT(*) as total_kegiatan
                FROM kegiatan_harian_pegawai k
                JOIN profil_pegawai p ON k.profil_pegawai_id = p.id
                WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
                GROUP BY tipe_kegiatan
                ORDER BY total_kegiatan DESC
            `, [...params, month, year]);

            const [activePegawai] = await pool.query(`
                SELECT COUNT(DISTINCT k.profil_pegawai_id) as active_count
                FROM kegiatan_harian_pegawai k
                JOIN profil_pegawai p ON k.profil_pegawai_id = p.id
                WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
            `, [...params, month, year]);

            const totalPegawai = pegawai[0].total_pegawai || 0;
            const activeCount = activePegawai[0].active_count || 0;
            const fillRate = totalPegawai > 0 ? ((activeCount / totalPegawai) * 100).toFixed(2) : 0;

            return {
                total_pegawai: totalPegawai,
                active_pegawai: activeCount,
                fill_rate_percentage: parseFloat(fillRate),
                activity_breakdown: activities
            };
        } catch (error) {
            console.error('Nayaxa Engine - Error in getPegawaiStatistics:', error);
            throw error;
        }
    },

    calculateScoring: async (instansi_id, month, year) => {
        try {
            const filterClauseP = applyInstansiFilter('p', instansi_id);
            const params = instansi_id ? [month, year, instansi_id] : [month, year];

            const [scores] = await pool.query(`
                SELECT 
                    p.id, p.nama_lengkap, b.nama_bidang, j.jabatan,
                    COUNT(k.id) as total_kegiatan,
                    SUM(CASE WHEN k.tipe_kegiatan LIKE 'RM%' THEN 2 ELSE 1 END) as weighted_score
                FROM profil_pegawai p
                LEFT JOIN kegiatan_harian_pegawai k ON p.id = k.profil_pegawai_id AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
                LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                LEFT JOIN master_jabatan j ON p.jabatan_id = j.id
                WHERE ${filterClauseP} AND p.is_active = 1
                GROUP BY p.id
                ORDER BY weighted_score DESC
            `, params);

            const highestScore = scores.length > 0 ? scores[0].weighted_score : 1;
            const rankedPegawai = scores.map((s, index) => ({
                rank: index + 1,
                nama: s.nama_lengkap,
                jabatan: s.jabatan || 'Tanpa Jabatan',
                bidang: s.nama_bidang || 'Tanpa Bidang',
                total_kegiatan: s.total_kegiatan,
                raw_score: s.weighted_score || 0,
                normalized_score: s.weighted_score ? Math.round((s.weighted_score / highestScore) * 100) : 0
            }));

            const bidangMap = {};
            rankedPegawai.forEach(p => {
                if (!bidangMap[p.bidang]) bidangMap[p.bidang] = { total_score: 0, count: 0 };
                bidangMap[p.bidang].total_score += p.raw_score;
                bidangMap[p.bidang].count += 1;
            });

            const rankedBidang = Object.keys(bidangMap).map(bidang => ({
                bidang,
                average_score: Math.round(bidangMap[bidang].total_score / bidangMap[bidang].count) || 0
            })).sort((a, b) => b.average_score - a.average_score);

            return { top_pegawai: rankedPegawai.slice(0, 5), bottom_pegawai: rankedPegawai.slice(-5).reverse(), ranked_bidang: rankedBidang, all_scores: rankedPegawai };
        } catch (error) {
            console.error('Nayaxa Engine Error:', error);
            throw error;
        }
    },

    detectAnomalies: async (instansi_id) => {
        try {
            const filterClauseP = applyInstansiFilter('p', instansi_id);
            const params = instansi_id ? [instansi_id] : [];
            const [anomalies] = await pool.query(`
                SELECT p.id, p.nama_lengkap, b.nama_bidang, MAX(k.tanggal) as last_activity_date, DATEDIFF(CURRENT_DATE, MAX(k.tanggal)) as days_inactive
                FROM profil_pegawai p
                LEFT JOIN kegiatan_harian_pegawai k ON p.id = k.profil_pegawai_id
                LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                WHERE ${filterClauseP} AND p.is_active = 1
                GROUP BY p.id
                HAVING days_inactive > 3 OR last_activity_date IS NULL
                ORDER BY days_inactive DESC
            `, params);
            return { inactive_alerts: anomalies.map(a => ({ nama: a.nama_lengkap, bidang: a.nama_bidang || 'Umum', days_inactive: a.days_inactive === null ? 'N/A' : a.days_inactive, last_activity: a.last_activity_date })) };
        } catch (error) { throw error; }
    },

    forecastTrends: async (instansi_id, currentMonth, currentYear) => {
        try {
            const filterClauseP = applyInstansiFilter('p', instansi_id);
            const paramsCurrent = instansi_id ? [instansi_id, currentMonth, currentYear] : [currentMonth, currentYear];
            let lastM = currentMonth - 1; let lastY = currentYear;
            if (lastM === 0) { lastM = 12; lastY -= 1; }
            const paramsPast = instansi_id ? [instansi_id, lastM, lastY] : [lastM, lastY];

            const [curr] = await pool.query(`SELECT COUNT(k.id) as cnt FROM kegiatan_harian_pegawai k JOIN profil_pegawai p ON k.profil_pegawai_id = p.id WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?`, paramsCurrent);
            const [past] = await pool.query(`SELECT COUNT(k.id) as cnt FROM kegiatan_harian_pegawai k JOIN profil_pegawai p ON k.profil_pegawai_id = p.id WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?`, paramsPast);

            const c = curr[0].cnt; const p = past[0].cnt;
            const growth = p > 0 ? (((c - p) / p) * 100).toFixed(2) : 0;
            return { current_month_total: c, last_month_total: p, growth_percentage: parseFloat(growth), trend_status: growth > 5 ? 'Naik' : (growth < -5 ? 'Turun' : 'Stabil') };
        } catch (error) { throw error; }
    },

    getDatabaseSchema: async () => {
        try {
            const [rows] = await pool.query(`SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
            const schemaMap = {};
            rows.forEach(r => {
                if (!schemaMap[r.TABLE_NAME]) schemaMap[r.TABLE_NAME] = [];
                schemaMap[r.TABLE_NAME].push(r.COLUMN_NAME);
            });
            let s = "PETA DATABASE DASHBOARD:\n";
            for (const t in schemaMap) s += `Tabel: ${t} (Kolom: ${schemaMap[t].join(', ')})\n`;
            return s;
        } catch (error) { return "Error skema."; }
    },

    getMasterDataGlossary: async () => {
        try {
            const [bidang] = await pool.query('SELECT nama_bidang, singkatan FROM master_bidang_instansi LIMIT 50');
            const [instansi] = await pool.query('SELECT instansi, singkatan FROM master_instansi_daerah LIMIT 50');
            return `GLOSARIUM:\n- Instansi: ${instansi.map(i => i.instansi).join(', ')}\n- Bidang: ${bidang.map(b => b.nama_bidang).join(', ')}`;
        } catch (error) { return ""; }
    },

    executeReadOnlyQuery: async (q) => {
        try {
            const up = q.trim().toUpperCase();
            if (!up.startsWith('SELECT')) return { error: "Hanya SELECT." };
            const [rows] = await pool.query(up.includes('LIMIT') ? q : `${q} LIMIT 100`);
            return rows;
        } catch (error) { return { error: error.message }; }
    },

    searchInternet: async (query) => {
        try {
            console.log(`[Nayaxa] Searching Internet (Free/Multi-Source) for: ${query}`);
            const results = [];
            const cheerio = require('cheerio');

            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            };

            const scrapeGoogle = async (searchQuery) => {
                try {
                    // Force hl=id and gl=id to avoid wrong languages
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&gbv=1&hl=id&gl=id`;
                    const gRes = await axios.get(googleUrl, { headers, timeout: 6000 });
                    const $g = cheerio.load(gRes.data);
                    $g('div.ZIN8ne, div.g').each((i, el) => {
                        const title = $g(el).find('h3').text();
                        const linkRaw = $g(el).find('a').attr('href');
                        const snippet = $g(el).find('.VwiC3b, .kCrYT, div').last().text();
                        if (title && linkRaw && (linkRaw.includes('/url?q=') || linkRaw.startsWith('http'))) {
                            let link = linkRaw.startsWith('http') ? linkRaw : decodeURIComponent(linkRaw.split('/url?q=')[1].split('&')[0]);
                            if (link.startsWith('http')) {
                                results.push({ source: 'Google', title: title.trim(), snippet: snippet.trim() || 'No snippet', link });
                            }
                        }
                    });
                } catch (err) { console.error('Google Scrape Error:', err.message); }
            };

            const scrapeBing = async (searchQuery) => {
                try {
                    // Force setlang=id, hl=id, and cc=ID
                    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&setlang=id&hl=id&cc=ID`;
                    const response = await axios.get(searchUrl, { headers, timeout: 6000 });
                    const $ = cheerio.load(response.data);
                    $('.b_algo').each((i, el) => {
                        const title = $(el).find('h2').text() || $(el).find('a').first().text();
                        let link = $(el).find('h2 a').attr('href') || $(el).find('a').attr('href');
                        const snippet = $(el).find('.b_caption p, .b_algo_snippet').text();
                        if (title && link && link.startsWith('http')) {
                            results.push({ source: 'Bing', title: title.trim(), snippet: snippet.trim() || 'No snippet', link });
                        }
                    });
                } catch (err) { console.error('Bing Scrape Error:', err.message); }
            };

            const scrapeDuckDuckGo = async (searchQuery) => {
                try {
                    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                    const dRes = await axios.get(ddgUrl, { headers, timeout: 10000 });
                    const $d = cheerio.load(dRes.data);
                    $('.links_main.result__body').each((i, el) => {
                        const title = $d(el).find('.result__title a').text();
                        const link = $d(el).find('.result__title a').attr('href');
                        const snippet = $d(el).find('.result__snippet').text();
                        if (title && link) {
                            results.push({ source: 'DuckDuckGo', title: title.trim(), snippet: snippet.trim() || 'No snippet', link });
                        }
                    });
                } catch (err) { console.error('DDG Scrape Error:', err.message); }
            };

            // 1. Concurrent Parallel Search
            await Promise.all([scrapeGoogle(query), scrapeBing(query), scrapeDuckDuckGo(query)]);

            // 2. Wikipedia (Factual)
            try {
                const wikiRes = await axios.get(`https://id.wikipedia.org/w/api.php`, {
                    params: { action: 'query', format: 'json', list: 'search', srsearch: query, srlimit: 2 },
                    headers: { 'User-Agent': 'NayaxaAssistant/1.1' }
                });
                if (wikiRes.data.query?.search) {
                    wikiRes.data.query.search.forEach(s => {
                        results.push({ source: 'Wikipedia', title: s.title, snippet: s.snippet.replace(/<[^>]*>/g, ''), link: `https://id.wikipedia.org/wiki/${encodeURIComponent(s.title)}` });
                    });
                }
            } catch (err) { console.error('Wiki Error:', err.message); }

            const keywordMatch = (text) => {
                const words = query.toLowerCase().split(' ').filter(w => w.length > 2);
                if (words.length === 0) return true;
                // At least 50% of the query words must match for a name search
                const matches = words.filter(w => text.toLowerCase().includes(w));
                return matches.length >= Math.ceil(words.length / 2);
            };

            // Filter out junk
            const filteredResults = [];
            const seenLinks = new Set();
            for (const res of results) {
                if (!seenLinks.has(res.link)) {
                    // Strict match: Must contain significant overlap with query
                    if (keywordMatch(res.title + ' ' + res.snippet)) {
                        seenLinks.add(res.link);
                        filteredResults.push(res);
                    }
                }
            }

            if (filteredResults.length === 0) {
                // If nothing found for the name, try a contextual fallback (e.g., adding "indonesia")
                if (query.split(' ').length <= 3 && !query.includes('indonesia')) {
                    console.log('[Nayaxa] No results, trying contextual fallback...');
                    await scrapeDuckDuckGo(query + ' indonesia');
                    // Repeat filtering for the fallback results
                    for (const res of results) {
                        if (!seenLinks.has(res.link) && keywordMatch(res.title + ' ' + res.snippet)) {
                            seenLinks.add(res.link);
                            filteredResults.push(res);
                        }
                    }
                }
            }

            if (filteredResults.length === 0) {
                if (results.length > 0) {
                    return { message: "Hasil pencarian ditemukan tetapi tidak relevan dengan kueri Anda. Sila coba dengan kata kunci yang lebih spesifik." };
                }
                return { message: "Maaf, hasil pencarian tidak ditemukan saat ini." };
            }

            return { 
                success: true, 
                query,
                results: filteredResults.slice(0, 6),
                search_engine_used: 'Polyglot Search (Free Scrape)'
            };
        } catch (error) {
            console.error('Search Internet Error:', error);
            return { error: "Terjadi gangguan saat mengakses internet." };
        }
    }
};

module.exports = nayaxaStandalone;
