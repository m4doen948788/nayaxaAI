const nayaxaStandalone = require('./src/services/nayaxaStandalone');
const dbNayaxa = require('./src/config/dbNayaxa');

async function test() {
    try {
        const profil_id = 1;
        const user_id = 1;

        console.log('--- Testing Activity Extraction ---');
        const activity = await nayaxaStandalone.getLastUserActivity(profil_id, user_id);
        console.log('Activity:', activity);

        if (activity) {
            console.log('--- Testing Anti-Repetition Check ---');
            // We simulate history.length === 1
            const [dupRows] = await dbNayaxa.query(
                'SELECT id FROM nayaxa_chat_history WHERE user_id = ? AND content LIKE ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1',
                [user_id, `%${activity.description}%`]
            );
            console.log('Already greeted in last hour?', dupRows.length > 0);
            
            if (dupRows.length === 0) {
                console.log('Result: WILL GREET with:', activity.description);
            } else {
                console.log('Result: SKIPPING GREETING (already sent)');
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

test();
