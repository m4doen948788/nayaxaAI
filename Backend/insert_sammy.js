const pool = require('./src/config/dbDashboard');

async function insertSammy() {
    try {
        console.log('--- INSERTING SUPERADMIN SAMMY (FIX) ---');
        
        // 1. Check if user already exists
        const [existing] = await pool.query('SELECT id FROM profil_pegawai WHERE nama_lengkap = ?', ['superadmin.sammy']);
        
        if (existing.length > 0) {
            console.log(`[!] User superadmin.sammy already exists with ID: ${existing[0].id}`);
            process.exit(0);
        }

        // 2. Insert new user with specific ID 95
        // Using existing columns found: nama_lengkap, email, nip, instansi_id, is_active
        const query = `
            INSERT INTO profil_pegawai (
                id, nama_lengkap, email, nip, instansi_id, is_active, created_at, updated_at
            ) VALUES (
                95, 'superadmin.sammy', 'sammy@nayaxa.ai', 'SUPERADMIN_01', 2, 1, NOW(), NOW()
            )
        `;
        
        await pool.query(query);
        console.log('[✔] User superadmin.sammy successfully created with ID 95.');
        
        process.exit(0);
    } catch (err) {
        console.error('[✘] Failed to insert user:', err);
        process.exit(1);
    }
}

insertSammy();
