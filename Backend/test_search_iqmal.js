const nayaxaStandalone = require('./src/services/nayaxaStandalone');

async function testSearch() {
    try {
        const results = await nayaxaStandalone.searchPegawai('Iqmal', 2);
        console.log('Search Result for Iqmal:', JSON.stringify(results, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

testSearch();
