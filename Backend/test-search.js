const axios = require('axios');
require('dotenv').config();
const nayaxaStandalone = require('./src/services/nayaxaStandalone');

async function testSearch() {
    const query = "Muflikha Mayazi";
    console.log(`Testing search for: ${query}`);
    
    try {
        const result = await nayaxaStandalone.searchInternet(query);
        console.log('--- SEARCH RESULT ---');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log(`Success! Found ${result.results.length} results using ${result.search_engine_used}.`);
        } else {
            console.log('No results found or error occurred.');
        }
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testSearch();
