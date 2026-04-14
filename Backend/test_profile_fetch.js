const nayaxaStandalone = require('./src/services/nayaxaStandalone');

async function testProfile() {
    try {
        console.log("Testing profile retrieval for one user...");
        // Assuming there is at least one profile in the DB.
        // We can find one by querying first.
        const [rows] = await require('./src/config/dbDashboard').query('SELECT id FROM profil_pegawai LIMIT 1');
        
        if (rows.length > 0) {
            const profilId = rows[0].id;
            const profile = await nayaxaStandalone.getPegawaiProfile(profilId);
            console.log("SUCCESS: Profile found:");
            console.log(JSON.stringify(profile, null, 2));
        } else {
            console.log("SKIP: No data in profil_pegawai table.");
        }
    } catch (e) {
        console.error("FAILED:", e);
    }
}

testProfile();
