const db = require('./config/db');
const path = require('path');
const fs = require('fs');

async function diag() {
    try {
        console.log('--- DIAGNOSTIC START ---');
        
        // 1. Check Templates
        const [templates] = await db.query('SELECT id, nama_jenis_surat, instansi_id FROM surat_templates');
        console.log('Total templates in DB:', templates.length);
        console.log('Templates data:', templates);

        // 2. Check Paths
        const UPLOAD_PATH = path.join(__dirname, 'uploads');
        console.log('Backend Upload Path:', UPLOAD_PATH);
        if (fs.existsSync(UPLOAD_PATH)) {
            const files = fs.readdirSync(UPLOAD_PATH);
            console.log('Files in uploads:', files.slice(0, 10)); // list first 10
        } else {
            console.error('Upload path does NOT exist!');
        }

        const DASHBOARD_UPLOADS = path.join(__dirname, '../../copy-dashboard/Backend/uploads'); // Path relative to engine/Backend
        console.log('Attempting to find Dashboard Uploads at:', DASHBOARD_UPLOADS);
        if (fs.existsSync(DASHBOARD_UPLOADS)) {
            console.log('Dashboard Uploads folder FOUND.');
            const files = fs.readdirSync(DASHBOARD_UPLOADS);
            console.log('Files in dashboard uploads:', files.slice(0, 10));
        } else {
            console.error('Dashboard Uploads folder NOT FOUND at this path.');
        }

        console.log('--- DIAGNOSTIC END ---');
    } catch (err) {
        console.error('Diagnostic error:', err);
    } finally {
        process.exit();
    }
}

diag();
