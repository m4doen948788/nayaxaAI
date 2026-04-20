const nayaxaMindService = require('./src/services/nayaxaMindService');
const dbDashboard = require('./src/config/dbDashboard');
const dbNayaxa = require('./src/config/dbNayaxa');

async function main() {
    try {
        console.log('[Maintenance] Manual Snapshot Refresh Triggered...');
        
        // Disable signature check to force refresh
        console.log('[Maintenance] Forcing snapshot generation (ignoring database signature)...');
        
        // We temporarily override checkDatabaseChanges to always return changed: true
        const originalCheck = nayaxaMindService.checkDatabaseChanges;
        nayaxaMindService.checkDatabaseChanges = async () => ({ changed: true, signature: 'MANUAL_REFRESH_' + Date.now() });

        await nayaxaMindService.generateSystemSnapshot();
        
        // Restore original check
        nayaxaMindService.checkDatabaseChanges = originalCheck;

        console.log('[Maintenance] Snapshot refresh complete.');
        
        // Clean up old snapshots to avoid confusion (Optional)
        // console.log('[Maintenance] Cleaning up very old snapshots...');
        // await dbNayaxa.query("DELETE FROM nayaxa_knowledge WHERE category = 'System Snapshot' AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)");

    } catch (err) {
        console.error('[Maintenance] Refresh Failed:', err);
    } finally {
        process.exit(0);
    }
}

main();
