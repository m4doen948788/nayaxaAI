const pool = require('../config/dbDashboard');
const dbNayaxa = require('../config/dbNayaxa');
const axios = require('axios');

/**
 * Nayaxa Standalone Engine (Adapted for Standalone Service)
 * This engine now queries the Dashboard DB using a readonly connection.
 */

const applyInstansiFilter = (alias, instansi_id) => {
    const prefix = alias ? `${alias}.` : '';
    return instansi_id ? `${prefix}instansi_id = ?` : '1=1';
};

// --- IN-MEMORY CACHE for Speed Optimization ---
const _nayaxaCache = {
    schema: { data: null, ts: 0 },
    glossary: { data: null, ts: 0 },
    ttl: 3600 * 1000 // 1 hour
};

const nayaxaStandalone = {
    getPersonalStatistics: async (profil_id, month, year) => {
        try {
            const [activities] = await pool.query(`
                SELECT 
                    tipe_kegiatan,
                    CASE 
                        WHEN UPPER(tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN COUNT(DISTINCT tanggal)
                        ELSE COUNT(*)
                    END as total_kegiatan
                FROM kegiatan_harian_pegawai 
                WHERE profil_pegawai_id = ? AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
                GROUP BY tipe_kegiatan
            `, [profil_id, month, year]);

            const [total] = await pool.query(`
                SELECT (
                    COUNT(DISTINCT CASE WHEN UPPER(tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN tanggal END) +
                    COUNT(CASE WHEN UPPER(tipe_kegiatan) NOT IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN id END)
                ) as total
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
            const filterClauseP = applyInstansiFilter('p', instansi_id);

            // 1. Total Employees in the agency (The '89' figure)
            const [totalPegawaiRows] = await pool.query(
                `SELECT COUNT(id) as count FROM profil_pegawai WHERE ${filterClauseEmpty}`,
                params
            );
            const totalPegawaiCount = totalPegawaiRows[0].count;

            // 2. Active Employees (is_active = 1)
            const [activePegawaiRows] = await pool.query(
                `SELECT COUNT(id) as count FROM profil_pegawai WHERE ${filterClauseEmpty} AND is_active = 1`,
                params
            );
            const activePegawaiCount = activePegawaiRows[0].count;

            // 3. Activity Breakdown
            const [activities] = await pool.query(`
                SELECT tipe_kegiatan, SUM(total_kegiatan_per_pegawai) as total_kegiatan
                FROM (
                    SELECT 
                        profil_pegawai_id,
                        tipe_kegiatan,
                        CASE 
                            WHEN UPPER(tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN COUNT(DISTINCT tanggal)
                            ELSE COUNT(*)
                        END as total_kegiatan_per_pegawai
                    FROM kegiatan_harian_pegawai k
                    JOIN profil_pegawai p ON k.profil_pegawai_id = p.id
                    WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
                    GROUP BY profil_pegawai_id, tipe_kegiatan
                ) as sub
                GROUP BY tipe_kegiatan
                ORDER BY total_kegiatan DESC
            `, [...params, month, year]);

            // 4. Monthly Reporting Count (How many people actually filed reports this month)
            const [monthlyReportingRows] = await pool.query(`
                SELECT COUNT(DISTINCT k.profil_pegawai_id) as count
                FROM kegiatan_harian_pegawai k
                JOIN profil_pegawai p ON k.profil_pegawai_id = p.id
                WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
            `, [...params, month, year]);
            const monthlyReportingCount = monthlyReportingRows[0].count;

            const fillRate = totalPegawaiCount > 0 ? ((monthlyReportingCount / totalPegawaiCount) * 100).toFixed(2) : 0;

            return {
                total_pegawai: totalPegawaiCount,
                active_pegawai: activePegawaiCount, // Status based active
                reporting_pegawai: monthlyReportingCount, // Activity based active
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
            const params = instansi_id ? [month, year, instansi_id] : [month, year];

            const [scores] = await pool.query(`
                SELECT 
                    p.id, p.nama_lengkap, b.nama_bidang, j.jabatan,
                    (
                        COUNT(DISTINCT CASE WHEN UPPER(k.tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.tanggal END) +
                        COUNT(CASE WHEN k.tipe_kegiatan IS NOT NULL AND UPPER(k.tipe_kegiatan) NOT IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.id END)
                    ) as total_kegiatan,
                    SUM(CASE WHEN k.tipe_kegiatan LIKE 'RM%' THEN 2 ELSE 1 END) as weighted_score
                FROM profil_pegawai p
                LEFT JOIN kegiatan_harian_pegawai k ON p.id = k.profil_pegawai_id 
                    AND (k.tanggal IS NULL OR (MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?))
                LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                LEFT JOIN master_jabatan j ON p.jabatan_id = j.id
                WHERE ${instansi_id ? 'p.instansi_id = ?' : '1=1'} AND p.is_active = 1
                GROUP BY p.id, p.nama_lengkap, b.nama_bidang, j.jabatan
                ORDER BY weighted_score DESC, total_kegiatan DESC
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

            const [curr] = await pool.query(`
                SELECT (
                    COUNT(DISTINCT CASE WHEN UPPER(k.tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.tanggal END) +
                    COUNT(CASE WHEN k.tipe_kegiatan IS NOT NULL AND UPPER(k.tipe_kegiatan) NOT IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.id END)
                ) as cnt 
                FROM kegiatan_harian_pegawai k 
                JOIN profil_pegawai p ON k.profil_pegawai_id = p.id 
                WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
            `, paramsCurrent);

            const [past] = await pool.query(`
                SELECT (
                    COUNT(DISTINCT CASE WHEN UPPER(k.tipe_kegiatan) IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.tanggal END) +
                    COUNT(CASE WHEN k.tipe_kegiatan IS NOT NULL AND UPPER(k.tipe_kegiatan) NOT IN ('DLB', 'DL', 'S', 'C', 'CUTI', 'SAKIT') THEN k.id END)
                ) as cnt 
                FROM kegiatan_harian_pegawai k 
                JOIN profil_pegawai p ON k.profil_pegawai_id = p.id 
                WHERE ${filterClauseP} AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
            `, paramsPast);

            const c = curr[0].cnt; const p = past[0].cnt;
            const growth = p > 0 ? (((c - p) / p) * 100).toFixed(2) : 0;
            return { current_month_total: c, last_month_total: p, growth_percentage: parseFloat(growth), trend_status: growth > 5 ? 'Naik' : (growth < -5 ? 'Turun' : 'Stabil') };
        } catch (error) { throw error; }
    },

    getPegawaiRanking: async (instansi_id, month, year, limit = 5) => {
        try {
            // Re-use calculateScoring logic to get rankings
            const res = await nayaxaStandalone.calculateScoring(instansi_id, month, year);
            return {
                top_performer: res.top_pegawai.slice(0, limit),
                bottom_performer: res.bottom_pegawai.slice(0, limit),
                bidang_ranking: res.ranked_bidang
            };
        } catch (error) {
            console.error('Error in getPegawaiRanking:', error);
            throw error;
        }
    },

    searchPegawai: async (query, instansi_id) => {
        try {
            const filterClauseEmpty = applyInstansiFilter('', instansi_id);
            const params = instansi_id ? [`%${query}%`, `%${query}%`, instansi_id] : [`%${query}%`, `%${query}%`];
            
            const [rows] = await pool.query(`
                SELECT 
                    p.id, p.nama_lengkap, p.nip, p.is_active,
                    b.nama_bidang as bidang,
                    j.jabatan,
                    i.instansi as nama_instansi
                FROM profil_pegawai p
                LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                LEFT JOIN master_jabatan j ON p.jabatan_id = j.id
                LEFT JOIN master_instansi_daerah i ON p.instansi_id = i.id
                WHERE (p.nama_lengkap LIKE ? OR p.nip LIKE ?) 
                AND ${filterClauseEmpty}
                ORDER BY p.nama_lengkap ASC
                LIMIT 50
            `, params);
            return rows;
        } catch (error) {
            console.error('Error in searchPegawai:', error);
            throw error;
        }
    },

    getDatabaseSchema: async () => {
        const now = Date.now();
        if (_nayaxaCache.schema.data && (now - _nayaxaCache.schema.ts < _nayaxaCache.ttl)) {
            return _nayaxaCache.schema.data;
        }
        try {
            const [rows] = await pool.query(`SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
            const schemaMap = {};
            rows.forEach(r => {
                if (!schemaMap[r.TABLE_NAME]) schemaMap[r.TABLE_NAME] = [];
                schemaMap[r.TABLE_NAME].push(r.COLUMN_NAME);
            });
            let s = "PETA DATABASE DASHBOARD:\n";
            for (const t in schemaMap) s += `Tabel: ${t} (Kolom: ${schemaMap[t].join(', ')})\n`;
            
            _nayaxaCache.schema.data = s;
            _nayaxaCache.schema.ts = now;
            return s;
        } catch (error) { return "Error skema."; }
    },

    getMasterDataGlossary: async () => {
        const now = Date.now();
        if (_nayaxaCache.glossary.data && (now - _nayaxaCache.glossary.ts < _nayaxaCache.ttl)) {
            return _nayaxaCache.glossary.data;
        }
        try {
            const [bidang] = await pool.query('SELECT nama_bidang, singkatan FROM master_bidang_instansi');
            const [instansi] = await pool.query('SELECT instansi, singkatan FROM master_instansi_daerah');
            const [tipe] = await pool.query('SELECT kode, nama FROM master_tipe_kegiatan');
            
            const glossaryBidang = bidang.map(b => b.singkatan ? `${b.nama_bidang} (${b.singkatan})` : b.nama_bidang).join(', ');
            const glossaryInstansi = instansi.map(i => i.singkatan ? `${i.instansi} (${i.singkatan})` : i.instansi).join(', ');
            const glossaryTipe = tipe.map(t => `${t.kode} (${t.nama})`).join(', ');
            
            const s = `GLOSARIUM RESMI:\n- DAFTAR INSTANSI: ${glossaryInstansi}\n- DAFTAR BIDANG: ${glossaryBidang}\n- DEFINISI KODE KEGIATAN: ${glossaryTipe}`;
            
            _nayaxaCache.glossary.data = s;
            _nayaxaCache.glossary.ts = now;
            return s;
        } catch (error) { 
            console.error('Error fetching glossary:', error);
            return "GLOSARIUM: [Data tidak tersedia]"; 
        }
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

    getPegawaiProfile: async (profil_id, user_name = null) => {
        try {
            if (!profil_id) return null;
            // 1. Fetch Basic Profile
            const [rows] = await pool.query(`
                SELECT 
                    p.id, p.nama_lengkap, p.nip, p.bidang_id,
                    b.nama_bidang as bidang, 
                    j.jabatan,
                    i.instansi as nama_instansi
                FROM profil_pegawai p
                LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                LEFT JOIN master_jabatan j ON p.jabatan_id = j.id
                LEFT JOIN master_instansi_daerah i ON p.instansi_id = i.id
                WHERE p.id = ?
                LIMIT 1
            `, [profil_id]);
            
            if (rows.length === 0) {
                // 2. SMART FALLBACK: If ID lookup fails, try matching by Nama Lengkap (if provided)
                if (user_name) {
                    console.log(`[Nayaxa] Profile ID ${profil_id} not found. Attempting Smart Lookup for: ${user_name}`);
                    const [nameRows] = await pool.query(`
                        SELECT 
                            p.id, p.nama_lengkap, p.nip, p.bidang_id,
                            b.nama_bidang as bidang, 
                            j.jabatan,
                            i.instansi as nama_instansi
                        FROM profil_pegawai p
                        LEFT JOIN master_bidang_instansi b ON p.bidang_id = b.id
                        LEFT JOIN master_jabatan j ON p.jabatan_id = j.id
                        LEFT JOIN master_instansi_daerah i ON p.instansi_id = i.id
                        WHERE p.nama_lengkap LIKE ?
                        LIMIT 1
                    `, [`%${user_name}%`]);
                    
                    if (nameRows.length > 0) {
                        console.log(`[Nayaxa] Smart Lookup SUCCESS: Found profile for ${user_name}`);
                        return nameRows[0];
                    }
                }
                return null;
            }
            const profile = rows[0];

            // 2. Fetch Managed Instances (Pengampuan)
            if (profile.bidang_id) {
                const [instansis] = await pool.query(`
                    SELECT DISTINCT i.instansi
                    FROM mapping_bidang_pengampu m
                    JOIN master_instansi_daerah i ON m.instansi_id = i.id
                    WHERE m.bidang_instansi_id = ?
                `, [profile.bidang_id]);
                profile.instansi_diampu = instansis.map(r => r.instansi);

                const [urusans] = await pool.query(`
                    SELECT DISTINCT u.urusan
                    FROM mapping_bidang_pengampu m
                    JOIN master_urusan u ON m.urusan_id = u.id
                    WHERE m.bidang_instansi_id = ?
                `, [profile.bidang_id]);
                profile.urusan_diampu = urusans.map(r => r.urusan);
            }

            return profile;
        } catch (error) {
            console.error('Error fetching Pegawai Profile:', error);
            return null;
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

    executeSystemQuery: async (q) => {
        try {
            const up = q.trim().toUpperCase();
            // Allow SELECT, UPDATE, DELETE, INSERT, ALTER, DROP, CREATE, TRUNCATE, DESCRIBE, SHOW
            const [rows] = await pool.query(q);
            return {
                message: "Query berhasil dieksekusi",
                affectedRows: rows.affectedRows || 0,
                result: up.startsWith('SELECT') || up.startsWith('SHOW') || up.startsWith('DESCRIBE') ? rows : []
            };
        } catch (error) { 
            console.error('[Nayaxa_DB_Update_Error]', error);
            return { error: error.message }; 
        }
    },

    /**
     * Get the absolute latest activity of a user across all major tables.
     * Used for contextual greetings.
     */
    getLastUserActivity: async (profil_id, user_id) => {
        try {
            if (!profil_id && !user_id) return null;

            // Define queries for different activity types
            const queries = [
                // 1. Logbook entries
                {
                    query: `SELECT 'Menambah kegiatan harian' as aksi, nama_kegiatan as objek, created_at as ts 
                            FROM kegiatan_harian_pegawai WHERE profil_pegawai_id = ? ORDER BY created_at DESC LIMIT 1`,
                    params: [profil_id]
                },
                // 2. Logbook updates (Edit History)
                {
                    query: `SELECT aksi, keterangan as objek, created_at as ts 
                            FROM kegiatan_edit_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
                    params: [user_id]
                },
                // 3. Document/File uploads
                {
                    query: `SELECT 'Mengunggah file' as aksi, nama_file as objek, uploaded_at as ts 
                            FROM dokumen_upload WHERE uploaded_by = ? AND is_deleted = 0 ORDER BY uploaded_at DESC LIMIT 1`,
                    params: [user_id]
                },
                // 4. Document updates (Edit History)
                {
                    query: `SELECT aksi, keterangan as objek, created_at as ts 
                            FROM dokumen_edit_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
                    params: [user_id]
                },
                // 5. Managed Activities (Management)
                {
                    query: `SELECT 'Menyiapkan kegiatan' as aksi, nama_kegiatan as objek, created_at as ts 
                            FROM kegiatan_manajemen WHERE created_by = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`,
                    params: [user_id]
                }
            ];

            const results = await Promise.all(queries.map(q => pool.query(q.query, q.params).catch(() => [[]])));
            
            const activities = results
                .map(r => r[0] && r[0][0] ? r[0][0] : null)
                .filter(a => a && a.ts)
                .sort((a, b) => new Date(b.ts) - new Date(a.ts));

            if (activities.length === 0) return null;

            const latest = activities[0];
            const timeAgo = Math.floor((new Date() - new Date(latest.ts)) / 60000); // in minutes
            
            // Only return if it happened in the last 24 hours (to keep it relevant)
            if (timeAgo > 1440) return null;

            let timeStr = timeAgo < 1 ? 'baru saja' : `${timeAgo} menit yang lalu`;
            if (timeAgo >= 60) timeStr = `${Math.floor(timeAgo / 60)} jam yang lalu`;

            return {
                description: `${latest.aksi} '${latest.objek}'`,
                time_ago: timeStr,
                timestamp: latest.ts
            };
        } catch (error) {
            console.error('Error in getLastUserActivity:', error);
            return null;
        }
    },

    searchLibrary: async (query) => {
        try {
            // Normalize query for acronyms
            let expandedQuery = query.toLowerCase();
            let isKLA = false;
            if (expandedQuery.includes('kabupaten layak anak') || expandedQuery.includes('kota layak anak') || expandedQuery.includes('kla')) {
                expandedQuery += ' kla layak anak';
                isKLA = true;
            }

            const searchTerms = expandedQuery.split(' ').filter(t => t.length > 1);
            if (searchTerms.length === 0) return [];

            // 1. Search Files & Thematic Mapping (dbDashboard)
            const fileConditions = searchTerms.map(() => '(du.nama_file LIKE ? OR du.path LIKE ?)').join(' OR ');
            const fileParams = searchTerms.flatMap(t => [`%${t}%`, `%${t}%`]);

            // Add thematic search if KLA detected or general search
            let thematicIds = [];
            if (isKLA) {
                const [tRows] = await pool.query("SELECT id FROM master_tematik WHERE (nama LIKE '%KLA%' OR nama LIKE '%Layak Anak%')");
                thematicIds = tRows.map(r => r.id);
            }

            const thematicClause = thematicIds.length > 0 ? `OR dt.tematik_id IN (${thematicIds.join(',')})` : '';

            const [fileRows] = await pool.query(`
                SELECT DISTINCT du.id, du.nama_file, du.path, du.ukuran, du.uploaded_at, mt.nama as tematik
                FROM dokumen_upload du
                LEFT JOIN dokumen_tematik dt ON du.id = dt.dokumen_id
                LEFT JOIN master_tematik mt ON dt.tematik_id = mt.id
                WHERE du.is_deleted = 0
                AND (${fileConditions} ${thematicClause})
                LIMIT 10
            `, fileParams);
            
            const files = fileRows.map(r => ({
                id: r.id,
                type: 'FILE',
                title: r.nama_file,
                url: `/uploads/dashboard/${r.path.replace(/^\/uploads\//, '')}`,
                category: r.tematik || 'Umum',
                details: `Kategori: ${r.tematik || 'Umum'}, Ukuran: ${(r.ukuran / 1024 / 1024).toFixed(2)} MB, Uploaded: ${new Date(r.uploaded_at).toLocaleDateString('id-ID')}`
            }));

            // 2. Search Knowledge (dbNayaxa) - Knowledge base specific entries
            const knowledgeConditions = searchTerms.map(() => '(category LIKE ? OR content LIKE ? OR source_file LIKE ?)').join(' OR ');
            const knowledgeParams = searchTerms.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);

            let knowledgeRows = [];
            try {
                [knowledgeRows] = await dbNayaxa.query(`
                    SELECT id, category, content, source_file, created_at
                    FROM nayaxa_knowledge
                    WHERE (${knowledgeConditions})
                    AND is_active = 1
                    LIMIT 5
                `, knowledgeParams);
            } catch (knErr) {
                console.error('Knowledge Search secondary error:', knErr.message);
            }

            const knowledge = knowledgeRows.map(r => ({
                id: r.id,
                type: 'KNOWLEDGE',
                title: r.source_file || r.category || 'Materi Belajar',
                content_preview: r.content.substring(0, 500) + '...',
                category: r.category || 'Knowledge',
                details: `Kategori: ${r.category || 'Umum'}, Tanggal: ${new Date(r.created_at).toLocaleDateString('id-ID')}`
            }));

            // Merge and prioritize by relevance (files first if KLA)
            return [...files, ...knowledge];
        } catch (error) { 
            console.error('Search Library Critical Error:', error);
            // Return empty instead of throwing to prevent white screen
            return []; 
        }
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
            console.log(`[Nayaxa] Searching Internet (Resilience Mode 2.0) for: ${query}`);
            const results = [];
            const cheerio = require('cheerio');

            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            ];
            const commonHeaders = {
                'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            };

            let isBlocked = false;

            const scrapeGoogle = async (searchQuery) => {
                if (isBlocked) return;
                try {
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=id&gl=id`;
                    const gRes = await axios.get(googleUrl, { headers: commonHeaders, timeout: 8000 });
                    if (gRes.data.includes('detected unusual traffic') || gRes.data.includes('captcha')) {
                        console.log('[Nayaxa] Google Block Detected (CAPTCHA/Traffic).');
                        isBlocked = true;
                        return;
                    }
                    const $g = cheerio.load(gRes.data);
                    $g('div.g, div.ZIN6rb, div.MjjYud').each((i, el) => {
                        const title = $g(el).find('h3').first().text();
                        let link = $g(el).find('a').attr('href');
                        const snippet = $g(el).find('div.VwiC3b, div.BNeawe.s3v9rd.AP7Wnd').first().text();
                        if (link && link.includes('/url?q=')) link = decodeURIComponent(link.split('/url?q=')[1].split('&')[0]);
                        if (title && link && link.startsWith('http') && !link.includes('google.com')) {
                            results.push({ source: 'Google', title: title.trim(), snippet: snippet.trim() || '...', link });
                        }
                    });
                } catch (err) { 
                    if (err.response?.status === 429) {
                        console.log('[Nayaxa] Google Block Detected (429).');
                        isBlocked = true;
                    }
                }
            };

            const scrapeBing = async (searchQuery) => {
                try {
                    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&setlang=id`;
                    const response = await axios.get(searchUrl, { headers: commonHeaders, timeout: 8000 });
                    const $ = cheerio.load(response.data);
                    $('.b_algo').each((i, el) => {
                        const title = $(el).find('h2').text();
                        let link = $(el).find('a').attr('href');
                        const snippet = $(el).find('.b_caption p, .b_algo_snippet').text();
                        if (title && link && link.startsWith('http') && !link.includes('bing.com')) {
                            results.push({ source: 'Bing', title: title.trim(), snippet: snippet.trim() || '...', link });
                        }
                    });
                } catch (err) { console.error('[Nayaxa] Bing Scrape Error:', err.message); }
            };

            // WATERFALL API HELPER
            const searchViaAPIs = async (searchQuery, limit = 5) => {
                console.log(`[Nayaxa] Fetching from Trusted APIs for: ${searchQuery}`);
                // 1. Serper.dev (Highest Priority)
                if (process.env.SERPER_API_KEY) {
                    try {
                        const res = await axios.post('https://google.serper.dev/search', { q: searchQuery, gl: "id", hl: "id" }, {
                            headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
                            timeout: 10000
                        });
                        if (res.data?.organic?.length > 0) {
                            return res.data.organic.slice(0, limit).map(r => ({ source: 'Google (Serper)', title: r.title, snippet: r.snippet, link: r.link }));
                        }
                    } catch (e) { console.error('[Nayaxa] Serper API Error:', e.message); }
                }
                // 2. Tavily (Secondary)
                if (process.env.TAVILY_API_KEY) {
                    try {
                        const res = await axios.post('https://api.tavily.com/search', { api_key: process.env.TAVILY_API_KEY, query: searchQuery, max_results: limit }, { timeout: 10000 });
                        if (res.data?.results?.length > 0) {
                            return res.data.results.map(r => ({ source: 'Tavily (API)', title: r.title, snippet: r.content, link: r.url }));
                        }
                    } catch (e) { console.error('[Nayaxa] Tavily API Error:', e.message); }
                }
                // 3. SerpApi (Tertiary)
                if (process.env.SERPAPI_API_KEY) {
                    try {
                        const res = await axios.get('https://serpapi.com/search', {
                            params: { q: searchQuery, gl: 'id', hl: 'id', api_key: process.env.SERPAPI_API_KEY },
                            timeout: 10000
                        });
                        if (res.data?.organic_results?.length > 0) {
                            return res.data.organic_results.slice(0, limit).map(r => ({ source: 'SerpApi', title: r.title, snippet: r.snippet, link: r.link }));
                        }
                    } catch (e) { console.error('[Nayaxa] SerpApi Error:', e.message); }
                }
                // 4. HasData (Quaternary)
                if (process.env.HASDATA_API_KEY) {
                    try {
                        const res = await axios.get('https://api.hasdata.com/scrape/google/serp', {
                            params: { q: searchQuery, gl: 'id', hl: 'id' },
                            headers: { 'x-api-key': process.env.HASDATA_API_KEY },
                            timeout: 10000
                        });
                        const organicResults = res.data?.organicResults || res.data?.organic_results;
                        if (organicResults?.length > 0) {
                            return organicResults.slice(0, limit).map(r => ({ source: 'HasData', title: r.title, snippet: r.snippet || r.description, link: r.link || r.url }));
                        }
                    } catch (e) { console.error('[Nayaxa] HasData API Error:', e.response ? e.response.data : e.message); }
                }
                // 5. Scrape.do (Quinary)
                if (process.env.SCRAPEDO_API_KEY) {
                    try {
                        const res = await axios.get('https://api.scrape.do/plugin/google/search', {
                            params: { q: searchQuery, token: process.env.SCRAPEDO_API_KEY, gl: 'id', hl: 'id' },
                            timeout: 10000
                        });
                        const organicResults = res.data?.organicResults || res.data?.organic_results;
                        if (organicResults?.length > 0) {
                            return organicResults.slice(0, limit).map(r => ({ source: 'Scrape.do', title: r.title, snippet: r.snippet || r.description, link: r.link || r.url }));
                        }
                    } catch (e) { console.error('[Nayaxa] Scrape.do API Error:', e.response ? e.response.data : e.message); }
                }
                return [];
            };

            // QUERY AUGMENTATION
            const currentYear = new Date().getFullYear();
            const latestRegionalPeriodStart = currentYear <= 2026 ? 2025 : Math.floor((currentYear - 2025) / 4) * 4 + 2025;
            const latestRegionalPeriod = `${latestRegionalPeriodStart}-${latestRegionalPeriodStart + 4}`;
            
            let cleanQuery = query.replace(/cari di internet|search for|siapakah|jelaskan tentang|mencari|siapa itu/gi, '').trim();
            const isHeavyQuery = /bupati|walikota|gubernur|wali kota|kepala daerah|pejabat|pelantikan|presiden|menteri|pilkada|pilwalkot|pilgub|kpu/i.test(cleanQuery);
            const isResearchIntent = /riset|penelitian|jurnal|ilmiah|biologi|antariksa|angkasa|astronomi|sains|penemuan terbaru|studi kasus|eksperimen/i.test(cleanQuery);
            
            let queriesToTry = [cleanQuery];
            if (isHeavyQuery) {
                let rewritten = cleanQuery.replace(/^siapa\s+/i, '').replace(/\bsekarang\b|\bsaat ini\b/gi, '').trim();
                const isMinister = /menteri/i.test(rewritten);
                const currentMonth = new Date().toLocaleString('id-ID', { month: 'long' });
                const currentYear = new Date().getFullYear();

                if (isMinister) {
                    queriesToTry.unshift(`${rewritten} Kabinet Merah Putih terbaru`);
                    queriesToTry.push(`Siapa ${rewritten} reshuffle ${currentYear}`);
                    queriesToTry.push(`${rewritten} Prabowo ${currentMonth} ${currentYear}`);
                } else {
                    queriesToTry.unshift(`Pelantikan serentak ${rewritten} 2024 2025`); 
                    queriesToTry.push(`${rewritten} periode ${latestRegionalPeriod}`);
                    queriesToTry.push(`${rewritten} terbaru ${currentMonth} ${currentYear}`);
                }
            } else if (isResearchIntent) {
                // Add research focus for scientific topics
                queriesToTry.unshift(`${cleanQuery} jurnal ilmiah resmi`);
                if (/antariksa|angkasa|astronomi|mars|bulan|bintang/i.test(cleanQuery)) {
                    queriesToTry.push(`${cleanQuery} nasa esa update`);
                } else if (/biologi|sel|dna|genetika|kesehatan/i.test(cleanQuery)) {
                    queriesToTry.push(`${cleanQuery} research biology journal`);
                }
                queriesToTry.push(`${cleanQuery} site:brin.go.id`);
            }

            // EXECUTION: New Aggressive API Strategy
            const hasAnyAPI = (process.env.SERPER_API_KEY || process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY || process.env.HASDATA_API_KEY || process.env.SCRAPEDO_API_KEY);
            
            // 1. Try APIs first if available
            if (hasAnyAPI) {
                const apiLimit = isHeavyQuery ? 8 : 5;
                const searchQ = isHeavyQuery ? queriesToTry[0] : cleanQuery;
                const apiResults = await searchViaAPIs(searchQ, apiLimit);
                if (apiResults.length > 0) results.push(...apiResults);
            }
            
            // 2. Fetch Wikipedia Immediately
            try {
                const wikiQ = isHeavyQuery ? queriesToTry[0] : cleanQuery;
                const wikiRes = await axios.get(`https://id.wikipedia.org/w/api.php`, {
                    params: { action: 'query', format: 'json', list: 'search', srsearch: wikiQ, srlimit: 2 },
                    headers: { 'User-Agent': 'NayaxaBot/1.1' },
                    timeout: 5000
                });
                if (wikiRes.data.query?.search) {
                    wikiRes.data.query.search.forEach(s => results.push({ source: 'Wikipedia', title: s.title, snippet: s.snippet.replace(/<[^>]*>/g, ''), link: `https://id.wikipedia.org/wiki/${encodeURIComponent(s.title)}` }));
                }
            } catch (err) {}

            // 3. Fallback to Native Scraper if results are too few (Lapis 0)
            if (results.length < 5) {
                console.log(`[Nayaxa] API & Wikipedia hits too low (${results.length}), falling back to Native Scrapers...`);
                // Give Bing an edge to reduce Google blocks but try both
                await Promise.all([scrapeGoogle(cleanQuery), scrapeBing(queriesToTry[1] || cleanQuery)]);
            }

            // SCORING & FILTERING
            const TRUSTED_DOMAINS = [
                // Science & Research (Global & National)
                { pattern: /nature\.com|science\.org|sciencemag\.org|nasa\.gov|esa\.int|pubmed\.ncbi\.nlm\.nih\.gov|sciencedirect\.com|arxiv\.org|jstor\.org|cell\.com|thelancet\.com|pnas\.org|nejm\.org|scholar\.google\.com|researchgate\.net|brin\.go\.id|sinta\.kemdikbud\.go\.id|garuda\.kemdikbud\.go\.id|lipi\.go\.id|ristekdikti\.go\.id|\.edu|\.ac\.id/, score: 150, type: 'RESEARCH' },
                // Government & Official (Absolute Priority)
                { pattern: /pilkada2024\.kpu\.go\.id|infopemilu\.kpu\.go\.id/, score: 300, type: 'OFFICIAL' },
                { pattern: /kemendagri\.go\.id|setneg\.go\.id|kominfo\.go\.id/, score: 250, type: 'OFFICIAL' },
                { pattern: /\.go\.id/, score: 110, type: 'OFFICIAL' },
                // News Media
                { pattern: /detik\.com|kompas\.com|cnnindonesia\.com|tempo\.co|antara\.news|antaranews\.com|liputan6\.com|tribunnews\.com|republika\.co\.id|jawapos\.com/, score: 80, type: 'NEWS' },
                // General Info
                { pattern: /wikipedia\.org/, score: 40, type: 'GENERAL' }
            ];

            // RELEVANCE FILTER (UNIVERSAL)
            const calculateRelevance = (query, res) => {
                const words = query.toLowerCase()
                    .replace(/[^a-z0-9 ]/g, '')
                    .split(/\s+/)
                    .filter(w => w.length > 2); // Only significant words
                
                if (words.length === 0) return 100; // Failsafe for very short queries
                
                const text = (res.title + ' ' + res.snippet).toLowerCase();
                let matches = 0;
                words.forEach(w => { if (text.includes(w)) matches++; });
                
                return (matches / words.length) * 100;
            };

            const getScore = (res) => {
                let score = 0;
                let type = 'GENERAL';
                for (const td of TRUSTED_DOMAINS) {
                    if (td.pattern.test(res.link)) {
                        score += td.score;
                        type = td.type;
                    }
                }
                const text = (res.title + ' ' + res.snippet).toLowerCase();
                // Research keyword detection
                if (/abstrak|metodologi|kesimpulan|hasil penelitian|riset|jurnal|ilmiah|biologi|antariksa|angkasa|astronomi|sains|penemuan terbaru|studi kasus|eksperimen/i.test(text)) score += 30;
                
                // Identity Boosting (Hardening v4.8.0)
                if (/sjafrie sjamsoeddin|budi gunadi sadikin|prabowo subianto presiden|sugiono menteri/i.test(text)) score += 120;
                if (/kabinet merah putih/i.test(text)) score += 100;

                // Timeline detection (preserved)
                if (text.includes('2025-2029') || text.includes('2025')) score += 150;
                if (text.includes('pelantikan') || text.includes('terpilih')) score += 50;
                
                // Recency Penalty (Hardening v4.6.1)
                // If query is for 'current' but result mentions old years, penalize heavily.
                const oldYears = /\b(2018|2019|2020|2021|2022)\b/;
                if (oldYears.test(text) || oldYears.test(res.link)) {
                    score -= 200;
                }

                if (/penjabat|pj\.|plt\.|pjs\.|pelaksana tugas/i.test(text)) score -= 80;
                
                return { score, type };
            };

            const finalResults = [];
            const seen = new Set();
            for (const r of results) {
                if (!seen.has(r.link)) {
                    seen.add(r.link);
                    
                    // Universal Relevance Check
                    const relevance = calculateRelevance(cleanQuery, r);
                    if (relevance < 15 && !r.link.includes('.go.id')) { // Ignore irrelevant, except official govt sites
                        continue;
                    }
                    
                    const { score, type } = getScore(r);
                    finalResults.push({ ...r, totalScore: score, source_type: type, relevance_score: Math.round(relevance) });
                }
            }
            finalResults.sort((a, b) => b.totalScore - a.totalScore);

            const validateLink = async (result) => {
                try {
                    // Fast HEAD check for 404s
                    const res = await axios.head(result.link, { 
                        headers: commonHeaders, 
                        timeout: 3000, 
                        maxRedirects: 3,
                        validateStatus: (status) => status < 400 || status === 403 // Discard 404+
                    });
                    return result;
                } catch (err) {
                    if (err.response?.status === 404) {
                        console.warn(`[Nayaxa] Filtering Dead Link (404): ${result.link}`);
                        return null;
                    }
                    // For other errors (timeout, 403, 500, etc.), we keep it as fallback 
                    // unless it's a confirmed 404
                    return result;
                }
            };

            const candidateResults = finalResults.slice(0, 10);
            const validatedResults = await Promise.allSettled(candidateResults.map(r => validateLink(r)));
            const activeResults = validatedResults
                .filter(res => res.status === 'fulfilled' && res.value !== null)
                .map(res => res.value);

            const searchDate = new Date().toLocaleString('id-ID', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' 
            });
            return activeResults.length > 0 ? {
                success: true,
                query,
                search_date: searchDate,
                results: activeResults.slice(0, 6).map(r => ({ ...r, trust_level: r.totalScore > 100 ? 'TERVERIFIKASI' : 'BELUM TERVERIFIKASI' })),
                search_engine_used: isBlocked ? 'API Waterfall (Scraper Blocked)' : (isHeavyQuery ? 'Hybrid API (Priority)' : 'Polyglot Search 2.0')
            } : { success: false, search_date: searchDate, message: "Informasi tidak ditemukan atau mesin pencari diblokir." };

        } catch (error) {
            console.error('Search Critical Error:', error.message);
            return { error: "Gangguan koneksi internet pada server Nayaxa." };
        }
    }
};

module.exports = nayaxaStandalone;
