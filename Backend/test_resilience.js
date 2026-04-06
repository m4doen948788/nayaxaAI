const nayaxaStandalone = require('./src/services/nayaxaStandalone');
require('dotenv').config();

async function testSearch(query) {
    console.log(`\n=== Testing Search: "${query}" ===`);
    const startTime = Date.now();
    try {
        const result = await nayaxaStandalone.searchInternet(query);
        const duration = (Date.now() - startTime) / 1000;
        
        if (result.success) {
            console.log(`Success! Found ${result.results.length} results in ${duration}s`);
            console.log(`Engine Used: ${result.search_engine_used}`);
            result.results.forEach((r, i) => {
                console.log(`${i+1}. [${r.source}] [${r.source_type}] ${r.title} (${r.trust_level})`);
                console.log(`   Link: ${r.link}`);
            });
        } else {
            console.log(`Failed: ${result.message || result.error}`);
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
    }
}

(async () => {
    // Test 1: Heavy Query (Should trigger API Priority)
    await testSearch('Bupati Bogor terpilih 2025');
    
    // Test 2: General Query (Should try Scraping first)
    await testSearch('Sejarah Kabupaten Bogor');
    // Test 3: Science Query (Should trigger Research Priority)
    await testSearch('perkembangan fusi nuklir terbaru');
})();
