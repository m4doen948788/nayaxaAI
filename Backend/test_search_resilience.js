
const nayaxaStandalone = require('./src/services/nayaxaStandalone');
require('dotenv').config();

async function testSearch() {
    console.log("Testing Internet Search for 'Lee Min Ho'...");
    try {
        const results = await nayaxaStandalone.searchInternet('Lee Min Ho');
        console.log("Results found:", results.results?.length);
        console.log("First result:", results.results?.[0]);
        if (results.results?.length === 0) {
            console.log("No results returned. Checking for errors in logic...");
        }
    } catch (err) {
        console.error("Search failed with error:", err);
    }
}

testSearch();
