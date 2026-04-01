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

    getInstansiName: async (instansi_id) => {
        try {
            if (!instansi_id) return 'N/A';
            const [rows] = await pool.query('SELECT instansi, singkatan FROM master_instansi_daerah WHERE id = ?', [instansi_id]);
            if (rows.length > 0) {
                return rows[0].singkatan ? `${rows[0].instansi} (${rows[0].singkatan})` : rows[0].instansi;
            }
            return 'N/A';
        } catch (error) {
            console.error('Error in getInstansiName:', error);
            return 'N/A';
        }
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

            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
            ];
            const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

            const commonHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
                'Referer': 'https://www.google.com/',
                'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'no-cache'
            };
            // Use random UA if available, otherwise fallback to our premium header
            if (typeof userAgents !== 'undefined' && userAgents.length > 0) {
                commonHeaders['User-Agent'] = userAgents[Math.floor(Math.random() * userAgents.length)];
            }

            const scrapeGoogle = async (searchQuery) => {
                try {
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=id&gl=id`;
                    const gRes = await axios.get(googleUrl, { headers: commonHeaders, timeout: 12000 });
                    const $g = cheerio.load(gRes.data);
                    
                    $g('div.g, div.ZIN6rb, div.MjjYud').each((i, el) => {
                        const title = $g(el).find('h3, div.vv77S, div.BNeawe.vv77S.AP7Wnd').first().text();
                        let link = $g(el).find('a').attr('href');
                        const snippet = $g(el).find('div.s3v9rd, div.VwiC3b, div.BNeawe.s3v9rd.AP7Wnd, .VwiC3b').first().text();
                        
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
                    const response = await axios.get(searchUrl, { headers: commonHeaders, timeout: 12000 });
                    const $ = cheerio.load(response.data);
                    
                    $('.b_algo, li.b_ans').each((i, el) => {
                        const title = $(el).find('h2, h3, .b_title').text();
                        let link = $(el).find('a').attr('href');
                        const snippet = $(el).find('.b_caption p, .b_algo_snippet, .b_lineclamp3, .b_vlist2col, .st, .b_snippet').text();
                        
                        if (title && link && link.startsWith('http') && !link.includes('bing.com')) {
                            results.push({ source: 'Bing', title: title.trim(), snippet: snippet.trim() || 'Klik untuk detail selengkapnya.', link });
                        }
                    });
                } catch (err) { console.error('Bing Scrape Error:', err.message); }
            };

            const scrapeBingNews = async (searchQuery) => {
                try {
                    const newsUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(searchQuery)}&setlang=id`;
                    const response = await axios.get(newsUrl, { headers: commonHeaders, timeout: 10000 });
                    const $ = cheerio.load(response.data);
                    
                    $('.news-card, .news_card').each((i, el) => {
                        const title = $(el).find('.title, a.title').text();
                        const link = $(el).find('a.title').attr('href');
                        const snippet = $(el).find('.snippet, .news_snippet').text();
                        const source = $(el).find('.source, .news_source').text();
                        
                        if (title && link && link.startsWith('http')) {
                            results.push({ 
                                source: `Bing News (${source || 'Berita'})`, 
                                title: title.trim(), 
                                snippet: snippet.trim() || 'Klik untuk membaca berita lengkap...', 
                                link 
                            });
                        }
                    });
                } catch (err) { console.error('Bing News Scrape Error:', err.message); }
            };


            // ============================================================
            // QUERY AUGMENTATION: Smart Rewrite + Dynamic Period Detection
            // ============================================================
            const currentYear = new Date().getFullYear(); // e.g. 2026
            const isTransitionYear = [2024, 2025, 2026, 2027].includes(currentYear);

            // Dynamic period calculation
            // Regional: elections every 5 years, last wave 2024 → 2025-2030
            const latestRegionalPeriodStart = currentYear <= 2026 ? 2025 : Math.floor((currentYear - 2025) / 5) * 5 + 2025;
            const latestRegionalPeriod = `${latestRegionalPeriodStart}-${latestRegionalPeriodStart + 5}`;
            // Previous period (still valid for cross-check: could be 2020-2025 etc)
            const prevRegionalPeriod   = `${latestRegionalPeriodStart - 5}-${latestRegionalPeriodStart}`;

            // 1. PRE-PROCESSOR: Strip noise words
            const noiseWords = [/cari di internet/gi, /search for/gi, /siapakah/gi, /jelaskan tentang/gi, /mencari/gi, /siapa itu/gi];
            let cleanQuery = query;
            noiseWords.forEach(regex => { cleanQuery = cleanQuery.replace(regex, '').trim(); });

            const isLeadershipQuery = /bupati|walikota|gubernur|wali kota|kepala daerah|pejabat|pelantikan|presiden|menteri/i.test(cleanQuery);
            const isElectionQuery   = /pilkada|pilwalkot|pilgub|kpu|hasil pemilihan|pemenang pemilu/i.test(cleanQuery);
            const isPublicFigure    = /jabatan|pemimpin|kepala(?! desa)|gubernur|bupati|walikota|menteri|direktur|presiden|wakil/i.test(cleanQuery);

            let queriesToTry = [cleanQuery]; // Cleaned query always first
            if (cleanQuery !== query) queriesToTry.push(query); // Original as backup

            if (isLeadershipQuery || isElectionQuery || isPublicFigure) {
                // Strip leading "siapa " and trailing "sekarang/saat ini"
                let rewritten = query
                    .replace(/^siapa\s+/i, '')
                    .replace(/\bsekarang\b|\bsaat ini\b/gi, '')
                    .trim();

                const isRegionalLeader = /bupati|walikota|wali kota|gubernur|kepala daerah/i.test(query);
                const isNationalLeader = /menteri|presiden|wakil presiden|dirjen|komisioner/i.test(query);

                if (isRegionalLeader) {
                    const isGubernur = /gubernur/i.test(query);
                    const isBupati = /bupati/i.test(query);
                    const isWalikota = /walikota|wali kota/i.test(query);
                    const abbrev = isGubernur ? "gub" : (isBupati ? "bup" : "walkot");
                    const regionOnly = rewritten.replace(/gubernur|bupati|walikota|wali kota/gi, '').trim();

                    // MULTI-QUERY STRATEGY from prompt
                    queriesToTry.unshift(`${rewritten} periode baru ${latestRegionalPeriod}`);
                    queriesToTry.unshift(`Pelantikan serentak ${rewritten} 2025`); // Absolute highest priority
                    queriesToTry.push(`Pelantikan ${rewritten} 20 Februari 2025`);
                    queriesToTry.push(`${rewritten} terpilih 2024 hasil pilkada`);
                    queriesToTry.push(`Pemilihan ${rewritten}`);
                    queriesToTry.push(`Pil${abbrev} ${regionOnly} ${currentYear}`);
                    queriesToTry.push(`Pil${abbrev} ${regionOnly} ${currentYear - 1}`);
                    queriesToTry.push(`Pil${abbrev} ${regionOnly} ${currentYear - 2}`);

                    if (isTransitionYear) {
                        queriesToTry.push(`${rewritten} ${prevRegionalPeriod}`);
                    }
                } else if (isNationalLeader) {
                    queriesToTry.unshift(`${rewritten} 2024-2029 Kabinet Indonesia Maju`);
                    queriesToTry.push(`${rewritten} Prabowo 2024`);
                } else if (isElectionQuery) {
                    queriesToTry.push(`${cleanQuery} hasil resmi KPU 2024`);
                    queriesToTry.push(`${cleanQuery} site:pilkada2024.kpu.go.id`);
                } else {
                    queriesToTry.push(`${rewritten} ${currentYear - 1} ${currentYear}`);
                }
            } else {
                // BRANCH: GENERAL PERSON / ENTITY (e.g. Sammy Lugina)
                // If it's not a known official query, focus on personal profiling
                const personQuery = cleanQuery.replace(/^siapa\s+/i, '').trim();
                if (personQuery.length > 3) {
                    queriesToTry.push(`${personQuery} profil biografi`);
                    queriesToTry.push(`${personQuery} karir linkedin`);
                    queriesToTry.push(`${personQuery} prestasi profil`);
                    queriesToTry.push(`${personQuery} berita terbaru`);
                }
            }

            // ============================================================
            // EXECUTE SEARCH SOURCES: TURBO MODE (PARALLEL PER QUERY)
            // Parallelizes Google, Bing, and News search within each block,
            // but maintains a short sequential delay between different queries.
            // ============================================================
            const delay = (ms) => new Promise(res => setTimeout(res, ms));
            
            for (const q of queriesToTry) {
                // AGGRESSIVE EARLY EXIT: If we have high-confidence results (Score > 180)
                // This means a 2025-2030 definitive leader has already been correctly identified.
                const highConfidenceResults = results.filter(r => r.totalScore >= 180).length;
                if (highConfidenceResults >= 2) {
                    console.log(`[Turbo] Cukup hasil yakin (${highConfidenceResults}), memotong antrean kueri...`);
                    break; 
                }

                console.log(`[Turbo Search] Mencari: ${q}...`);
                // Parallelize sources within this specific query block
                await Promise.all([
                    scrapeGoogle(q),
                    scrapeBing(q),
                    scrapeBingNews(q)
                ]);

                // Faster human-like delay between 500ms to 900ms
                const jitter = 500 + Math.floor(Math.random() * 400);
                await delay(jitter);
            }

            // Wikipedia (API) — Use enriched query to avoid stale regional articles
            try {
                // For leadership queries, search with the period-specific rewritten query.
                // This targets "Bupati Bogor 2025-2030" instead of just "Bupati Bogor",
                // ensuring Wikipedia returns the elected official's page, not the outdated region page.
                const wikiQuery = (isLeadershipQuery || isPublicFigure)
                    ? (queriesToTry[0] || query)  // Use the highest-priority enriched query
                    : query;

                const wikiPromises = [
                    axios.get(`https://id.wikipedia.org/w/api.php`, {
                        params: { action: 'query', format: 'json', list: 'search', srsearch: wikiQuery, srlimit: 3 },
                        headers: { 'User-Agent': 'NayaxaBot/1.1' }
                    })
                ];

                // For leadership & transition year: also search the 2025 serentak inauguration index page
                if ((isLeadershipQuery || isPublicFigure) && isTransitionYear) {
                    wikiPromises.push(
                        axios.get(`https://id.wikipedia.org/w/api.php`, {
                            params: { action: 'query', format: 'json', list: 'search', srsearch: 'Pelantikan kepala daerah serentak Indonesia 2025', srlimit: 2 },
                            headers: { 'User-Agent': 'NayaxaBot/1.1' }
                        })
                    );
                }

                const wikiResults = await Promise.allSettled(wikiPromises);
                wikiResults.forEach(r => {
                    if (r.status === 'fulfilled' && r.value.data.query?.search) {
                        r.value.data.query.search.forEach(s => {
                            results.push({
                                source: 'Wikipedia',
                                title: s.title,
                                snippet: s.snippet.replace(/<[^>]*>/g, ''),
                                link: `https://id.wikipedia.org/wiki/${encodeURIComponent(s.title)}`
                            });
                        });
                    }
                });
            } catch (err) {}

            // ============================================================
            // SCORING: Trusted Source + Period Confidence Scoring
            // ============================================================
            const TRUSTED_DOMAINS = [
                { pattern: /pilkada2024\.kpu\.go\.id/, score: 120 },
                { pattern: /kpu\.go\.id/,              score: 110 },
                { pattern: /\.go\.id/,                 score: 100 },
                { pattern: /detik\.com/,                score:  90 },
                { pattern: /kompas\.com/,               score:  90 },
                { pattern: /antara\.news|antaranews\.com/, score: 85 },
                { pattern: /cnnindonesia\.com/,         score:  80 },
                { pattern: /tempo\.co/,                 score:  80 },
                { pattern: /wikipedia\.org/,            score:  40 }, // Demoted as user requested to check news first
            ];

            const getTrustedScore = (link) => {
                for (const td of TRUSTED_DOMAINS) {
                    if (td.pattern.test(link)) return td.score;
                }
                return 0;
            };

            /**
             * Period Confidence Scoring:
             * - +50 if text mentions the latest period (e.g. "2025-2030")
             * - +30 if text mentions a year >= latestRegionalPeriodStart
             * - -30 if the period in text is clearly expired (end year <= currentYear - 1 AND start != latestRegionalPeriodStart)
             */
            const getPeriodScore = (textBlock) => {
                let score = 0;
                const text = textBlock.toLowerCase();

                // Look for explicit period patterns like "2025-2030"
                const periodMatches = [...text.matchAll(/(20\d\d)[–\-](20\d\d)/g)];
                for (const m of periodMatches) {
                    const startY = parseInt(m[1]);
                    const endY   = parseInt(m[2]);

                    if (startY === latestRegionalPeriodStart) {
                        score += 60; // Latest period explicitly mentioned (High Confidence)
                    } else if (endY < currentYear) {
                        score -= 50; // Period already expired → Heavy penalty
                    } else if (startY >= currentYear - 2) {
                        score += 20; // Recent-ish period
                    }
                }

                // Check for single years
                const yearMatches = [...text.matchAll(/(202[4-9])/g)];
                yearMatches.forEach(m => {
                    const y = parseInt(m[1]);
                    if (y === latestRegionalPeriodStart) score += 20;
                    if (y === 2025) score += 50; // Special 2025 boost
                });

                // TIMELINE VERIFICATION: Boost "terpilih" over "sedang menjabat" or "lama"
                if (/pelantikan|dilantik|terpilih|pemenang/.test(text)) {
                    const hasRecentYear = yearMatches.length > 0;
                    if (hasRecentYear) {
                        score += 50; // High probability it's talking about the NEW leader
                    }
                }

                // MASSIVE BOOST for exact inauguration context to override old strong wikipedia pages
                if (/pelantikan serentak/i.test(text) && /2025/.test(text)) {
                    score += 200;
                }
                if (/20 februari 2025/i.test(text)) {
                    score += 250;
                }
                
                // Penalty for keywords indicating Acting/Temporary status (High risk of being outdated)
                // We ONLY penalize Pj for verified leadership queries to avoid hurting regular people with similar names.
                if (isLeadershipQuery && /penjabat|pj\.|pelaksana tugas|plt\.|pejabat sementara|pjs\./i.test(text)) {
                    score -= 150;
                }

                // Penalty for keywords indicating old period
                if (/mantan|demisioner|berakhir|masa jabatan habis|eks-/.test(text)) {
                    score -= 100;
                }

                // Penalty for old period years
                if (/2018-2023|2019-2024|2023-2024/.test(text)) {
                    score -= 100;
                }

                return score;
            };

            const keywordMatch = (text) => {
                const words = query.toLowerCase().split(' ').filter(w => w.length > 2);
                if (words.length === 0) return true;
                return words.some(w => text.toLowerCase().includes(w));
            };

            const filteredResults = [];
            const seenLinks = new Set();
            for (const res of results) {
                if (!seenLinks.has(res.link)) {
                    const isBotBlock = res.snippet.toLowerCase().includes('please click here') || 
                                     res.snippet.toLowerCase().includes('trouble accessing') ||
                                     res.snippet.toLowerCase().includes('detecting unusual traffic');
                    const trustedScore = getTrustedScore(res.link);
                    const periodScore  = (isLeadershipQuery || isPublicFigure)
                        ? getPeriodScore(res.title + ' ' + res.snippet)
                        : 0;

                    if (!isBotBlock && (trustedScore > 0 || keywordMatch(res.title + res.snippet) || res.source === 'Wikipedia' || res.source === 'DuckDuckGo')) {
                        seenLinks.add(res.link);
                        
                        let totalScore = trustedScore + periodScore;

                        filteredResults.push({ ...res, trustedScore, periodScore, totalScore });
                    }
                }
            }

            // Sort: highest combined score (trusted + period) first
            filteredResults.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

            if (filteredResults.length === 0 && results.length > 0) {
                results.slice(0, 3).forEach(r => filteredResults.push({ ...r, trustedScore: 0 }));
            }

            const searchDate = new Date().toLocaleDateString('id-ID', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            // WATERFALL API FALLBACK
            const hasWebScraperResults = filteredResults.some(r => ['Google', 'Bing', 'Bing News'].includes(r.source));
            if (!hasWebScraperResults || filteredResults.length === 0) {
                console.log('[Nayaxa] Web Scraper Kosong/Diblokir. Memulai Waterfall API Fallback...');
                let apiSuccess = false;
                if (!apiSuccess) {
                    if (process.env.SERPER_API_KEY) {
                        try {
                            console.log('[Waterfall Lapis 1] Menggunakan Serper.dev...');
                            const fallbackQuery = queriesToTry[0] || query;
                            const serperData = JSON.stringify({ "q": fallbackQuery, "gl": "id", "hl": "id" });
                            const serperRes = await axios.post('https://google.serper.dev/search', serperData, {
                                headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
                                timeout: 10000
                            });
                            
                            if (serperRes.data && serperRes.data.organic && serperRes.data.organic.length > 0) {
                                serperRes.data.organic.slice(0, 5).forEach(r => {
                                    filteredResults.push({ source: 'Google (API Lapis 1)', title: r.title, snippet: r.snippet, link: r.link, trustedScore: getTrustedScore(r.link) });
                                });
                                apiSuccess = true;
                            }
                        } catch (err) { console.error('[Waterfall Lapis 1] Gagal:', err.message); }
                    } else {
                        console.log('[Waterfall Lapis 1] Lewati: SERPER_API_KEY tidak diatur.');
                    }
                }

                // Lapis 2: Tavily API
                if (!apiSuccess) {
                    if (process.env.TAVILY_API_KEY) {
                        try {
                            console.log('[Waterfall Lapis 2] Menggunakan Tavily API...');
                            const fallbackQuery = queriesToTry[0] || query;
                            const tavilyData = JSON.stringify({ 
                                api_key: process.env.TAVILY_API_KEY, 
                                query: fallbackQuery,
                                search_depth: "basic",
                                max_results: 5
                            });
                            const tavilyRes = await axios.post('https://api.tavily.com/search', tavilyData, {
                                headers: { 'Content-Type': 'application/json' },
                                timeout: 10000
                            });
                            
                            if (tavilyRes.data && tavilyRes.data.results && tavilyRes.data.results.length > 0) {
                                tavilyRes.data.results.slice(0, 5).forEach(r => {
                                    filteredResults.push({ source: 'Tavily (API Lapis 2)', title: r.title, snippet: r.content, link: r.url, trustedScore: getTrustedScore(r.url) });
                                });
                                apiSuccess = true;
                            }
                        } catch (err) { console.error('[Waterfall Lapis 2] Gagal:', err.message); }
                    } else {
                        console.log('[Waterfall Lapis 2] Lewati: TAVILY_API_KEY tidak diatur.');
                    }
                }

                // Lapis 3: SerpApi
                if (!apiSuccess) {
                    if (process.env.SERPAPI_API_KEY) {
                        try {
                            console.log('[Waterfall Lapis 3] Menggunakan SerpApi...');
                            const fallbackQuery = queriesToTry[0] || query;
                            const serpApiRes = await axios.get(`https://serpapi.com/search.json?q=${encodeURIComponent(fallbackQuery)}&hl=id&gl=id&api_key=${process.env.SERPAPI_API_KEY}`, {
                                timeout: 10000
                            });
                            
                            if (serpApiRes.data && serpApiRes.data.organic_results && serpApiRes.data.organic_results.length > 0) {
                                serpApiRes.data.organic_results.slice(0, 5).forEach(r => {
                                    filteredResults.push({ source: 'Google (API Lapis 3)', title: r.title, snippet: r.snippet, link: r.link, trustedScore: getTrustedScore(r.link) });
                                });
                                apiSuccess = true;
                            }
                        } catch (err) { console.error('[Waterfall Lapis 3] Gagal:', err.message); }
                    } else {
                        console.log('[Waterfall Lapis 3] Lewati: SERPAPI_API_KEY tidak diatur.');
                    }
                }
            }


            if (filteredResults.length === 0) {
                return {
                    success: false,
                    search_date: searchDate,
                    message: "Informasi tidak ditemukan. Mesin pencari Nayaxa kesulitan menemukan informasi yang tepat atau mungkin dilarang oleh server tujuan. Sumber alternatif: id.wikipedia.org, pilkada2024.kpu.go.id, detik.com, kompas.com"
                };
            }

            const labeledResults = filteredResults.slice(0, 6).map(r => ({
                ...r,
                trust_level: r.trustedScore > 0 ? 'TERVERIFIKASI (Sumber Terpercaya)' : 'BELUM TERVERIFIKASI'
            }));

            return {
                success: true,
                query,
                search_date: searchDate,
                results: labeledResults,
                search_engine_used: 'Polyglot Search (Resilience Mode + Trusted Source Priority)'
            };
        } catch (error) {
            console.error('Search Critical Error:', error.message);
            return { error: "Terjadi gangguan koneksi internet pada server Nayaxa." };
        }
    }
};

module.exports = nayaxaStandalone;
