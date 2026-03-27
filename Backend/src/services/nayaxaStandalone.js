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
    getPersonalStatistics: async (profil_id, month, year) => {
        try {
            const [activities] = await pool.query(`
                SELECT tipe_kegiatan, COUNT(*) as total_kegiatan
                FROM kegiatan_harian_pegawai
                WHERE profil_pegawai_id = ? AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
                GROUP BY tipe_kegiatan
                ORDER BY total_kegiatan DESC
            `, [profil_id, month, year]);

            const [total] = await pool.query(`
                SELECT COUNT(*) as total
                FROM kegiatan_harian_pegawai
                WHERE profil_pegawai_id = ? AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
            `, [profil_id, month, year]);

            return {
                personal_total_kegiatan: total[0].total || 0,
                personal_activity_breakdown: activities
            };
        } catch (error) {
            console.error('Error in getPersonalStatistics:', error);
            throw error;
        }
    },

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

    getNearbyPlaces: async (lat, lng, query) => {
        try {
            console.log(`[Nayaxa] Searching for ${query} near: ${lat}, ${lng}`);
            const results = [];
            
            // 1. Try Nominatim (Fast, Local)
            try {
                const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lng}&format=json&limit=5`;
                const res = await axios.get(url, { headers: { 'User-Agent': 'NayaxaBot/1.1' }, timeout: 6000 });
                if (res.data && res.data.length > 0) {
                    res.data.forEach(p => {
                        const isLocal = Math.abs(parseFloat(p.lat) - lat) < 0.5; 
                        if (isLocal) {
                            results.push({
                                name: p.display_name.split(',')[0],
                                address: p.display_name,
                                lat: p.lat,
                                lng: p.lon,
                                gmaps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.display_name)}`
                            });
                        }
                    });
                }
            } catch (e) { console.error('Nominatim Error:', e.message); }

            // 2. Fallback to Resilience Internet Search
            if (results.length === 0) {
                console.log('[Nayaxa] Falling back to Internet Search for places...');
                const searchRes = await nayaxaStandalone.searchInternet(`${query} terdekat`);
                if (searchRes.results?.length > 0) {
                    searchRes.results.slice(0, 3).forEach(r => {
                        results.push({
                            name: r.title,
                            address: r.snippet,
                            gmaps_url: r.link.includes('google.com/maps') ? r.link : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.title)}`
                        });
                    });
                }
            }

            // 3. Failsafe: If STILL empty, provide a Direct Google Maps Search Link
            if (results.length === 0) {
                results.push({
                    name: `Pencarian Google Maps: ${query}`,
                    address: `Sila klik link ini untuk melihat hasil pencarian ${query} langsung di Google Maps sesuai posisi Anda.`,
                    gmaps_url: `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${lat},${lng},15z`
                });
            }

            return results.slice(0, 5);
        } catch (error) {
            console.error('Nearby Places Critical Error:', error.message);
            return [{
                name: `Pencarian ${query}`,
                address: `Saya mengalami kendala teknis dalam mengambil data otomatis, namun Anda bisa melihat peta di sini.`,
                gmaps_url: `https://www.google.com/maps/search/${encodeURIComponent(query)}/@${lat},${lng},15z`
            }];
        }
    },

    searchInternet: async (query) => {
        try {
            console.log(`[Nayaxa] Searching Internet (Polyglot Search - Resilience) for: ${query}`);
            const results = [];
            const cheerio = require('cheerio');

            const mobileHeaders = {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache'
            };

            const scrapeGoogle = async (searchQuery) => {
                try {
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=id&gl=id`;
                    const gRes = await axios.get(googleUrl, { headers: mobileHeaders, timeout: 12000 });
                    const $g = cheerio.load(gRes.data);
                    
                    // Improved Selectors for modern Google Mobile Results
                    $g('div.ZIN6rb, div.MjjYud').each((i, el) => {
                        const title = $g(el).find('div.vv77S, h3, div.BNeawe.vv77S.AP7Wnd').first().text();
                        let link = $g(el).find('a').attr('href');
                        const snippet = $g(el).find('div.s3v9rd, div.VwiC3b, div.BNeawe.s3v9rd.AP7Wnd').first().text();
                        
                        if (link && link.includes('/url?q=')) {
                            link = decodeURIComponent(link.split('/url?q=')[1].split('&')[0]);
                        }

                        if (title && link && link.startsWith('http') && !link.includes('google.com')) {
                            results.push({ source: 'Google', title: title.trim(), snippet: snippet.trim() || 'Lihat detail di web...', link });
                        }
                    });
                } catch (err) { console.error('Google Scrape Error:', err.message); }
            };

            const scrapeBing = async (searchQuery) => {
                try {
                    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&setlang=id`;
                    const response = await axios.get(searchUrl, { headers: mobileHeaders, timeout: 12000 });
                    const $ = cheerio.load(response.data);
                    $('.b_algo, li.b_ans').each((i, el) => {
                        const title = $(el).find('h2, .b_title').text();
                        let link = $(el).find('a').attr('href');
                        const snippet = $(el).find('.b_caption p, .b_algo_snippet, .b_lineclamp3, .b_vlist2col').text();
                        if (title && link && link.startsWith('http') && !link.includes('bing.com')) {
                            results.push({ source: 'Bing', title: title.trim(), snippet: snippet.trim() || 'Klik untuk detail selengkapnya.', link });
                        }
                    });
                } catch (err) { console.error('Bing Scrape Error:', err.message); }
            };

            const scrapeDDG = async (searchQuery) => {
                try {
                    // DuckDuckGo HTML version is more friendly to scrappers
                    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                    const res = await axios.get(ddgUrl, { headers: mobileHeaders, timeout: 10000 });
                    const $ = cheerio.load(res.data);
                    $('.links_main.result__body').each((i, el) => {
                        const title = $(el).find('.result__title').text().trim();
                        const link = $(el).find('.result__url').attr('href')?.trim();
                        const snippet = $(el).find('.result__snippet').text().trim();
                        if (title && link && !link.includes('duckduckgo.com')) {
                            const fullLink = link.startsWith('http') ? link : `https:${link}`;
                            results.push({ source: 'DuckDuckGo', title, snippet: snippet || 'Info lebih lanjut...', link: fullLink });
                        }
                    });
                } catch (err) { 
                    console.error('DDG Scrape Error:', err.message);
                    if (err.message.includes('altnames') || err.message.includes('ECONNRESET')) {
                        console.warn('[Nayaxa] DuckDuckGo restricted by local network filter (Internet Positif). Skipping...');
                    }
                }
            };

            // Query Multiplier / Automatic Improvement
            // If the query is just a name or a singular topic, we expand it.
            let queriesToTry = [query];
            if (!query.includes(' ') || query.length < 15) {
                queriesToTry.push(`${query} profil`);
                queriesToTry.push(`${query} data terbaru`);
            } else if (query.toLowerCase().includes('siapa') || query.toLowerCase().includes('apa')) {
                queriesToTry.push(query.replace(/siapa|apa/i, '').trim() + " 2024 2025 2026");
            }

            // Execute all search sources
            const searchPromises = [];
            queriesToTry.forEach(q => {
                searchPromises.push(scrapeGoogle(q));
                searchPromises.push(scrapeBing(q));
                searchPromises.push(scrapeDDG(q));
            });

            await Promise.all(searchPromises);

            // Wikipedia (API) - Use the original query
            try {
                const wikiRes = await axios.get(`https://id.wikipedia.org/w/api.php`, {
                    params: { action: 'query', format: 'json', list: 'search', srsearch: query, srlimit: 3 },
                    headers: { 'User-Agent': 'NayaxaBot/1.1' }
                });
                if (wikiRes.data.query?.search) {
                    wikiRes.data.query.search.forEach(s => {
                        results.push({ source: 'Wikipedia', title: s.title, snippet: s.snippet.replace(/<[^>]*>/g, ''), link: `https://id.wikipedia.org/wiki/${encodeURIComponent(s.title)}` });
                    });
                }
            } catch (err) {}

            const keywordMatch = (text) => {
                const words = query.toLowerCase().split(' ').filter(w => w.length > 2);
                if (words.length === 0) return true;
                // Resilience: At least one word must match, or many words (smart match)
                return words.some(w => text.toLowerCase().includes(w));
            };

            const filteredResults = [];
            const seenLinks = new Set();
            for (const res of results) {
                if (!seenLinks.has(res.link)) {
                    // Check for quality snippets (avoiding bot block messages)
                    const isBotBlock = res.snippet.toLowerCase().includes('please click here') || 
                                     res.snippet.toLowerCase().includes('trouble accessing') ||
                                     res.snippet.toLowerCase().includes('detecting unusual traffic');
                    
                    if (!isBotBlock && (keywordMatch(res.title + res.snippet) || res.source === 'Wikipedia' || res.source === 'DuckDuckGo')) {
                        seenLinks.add(res.link);
                        filteredResults.push(res);
                    }
                }
            }

            if (filteredResults.length === 0 && results.length > 0) {
                 // If everything was filtered but we have results, maybe we were too strict
                 results.slice(0, 3).forEach(r => filteredResults.push(r));
            }

            if (filteredResults.length === 0) {
                return { 
                    success: false,
                    message: "Maaf, Nayaxa mengalami kendala saat mengakses informasi terkini dari internet (Resilience Mode aktif namun hasil nihil). Silakan coba dengan kata kunci lain." 
                };
            }

            return { 
                success: true, 
                query,
                results: filteredResults.slice(0, 5),
                search_engine_used: 'Polyglot Search (Resilience Mode + Redundant Sources)'
            };
        } catch (error) {
            console.error('Search Critical Error:', error.message);
            return { error: "Terjadi gangguan koneksi internet pada server Nayaxa." };
        }
    }
};

module.exports = nayaxaStandalone;
