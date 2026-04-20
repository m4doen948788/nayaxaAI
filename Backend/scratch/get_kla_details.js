const dbNayaxa = require('../src/config/dbNayaxa');

async function getKLADetails() {
    try {
        console.log('--- KLA Related Knowledge Entries ---');
        const [knowledge] = await dbNayaxa.query(
            "SELECT id, category, source_file, content FROM nayaxa_knowledge WHERE (category LIKE '%kla%' OR content LIKE '%kla%' OR source_file LIKE '%kla%') AND is_active = 1"
        );
        
        knowledge.forEach(k => {
            console.log(`ID: ${k.id}`);
            console.log(`Category: ${k.category}`);
            console.log(`Source File: ${k.source_file}`);
            console.log(`Content Preview: ${k.content.substring(0, 200)}...`);
            console.log('---');
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

getKLADetails();
