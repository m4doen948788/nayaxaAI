const nayaxaStandalone = require('./src/services/nayaxaStandalone');

// Disable APIs temporarily for testing the raw scraper
process.env.SERPER_API_KEY = '';
process.env.TAVILY_API_KEY = '';
process.env.SERPAPI_API_KEY = '';
process.env.BING_API_KEY = '';

async function testBingScraper() {
    console.log("--- TESTING RAW BING SCRAPER ---");
    console.log("Disabled all API Keys to test Lapis 0 (Bing Scraper)...");
    
    try {
        const query = "berita gempa terkini hari ini";
        console.log(`Query: "${query}"\n`);
        
        const result = await nayaxaStandalone.searchInternet(query);
        
        if (result && result.results && result.results.length > 0) {
            console.log(`✅ BERHASIL: Menemukan ${result.results.length} hasil dari scraper.`);
            result.results.forEach((r, i) => {
                console.log(`${i+1}. [${r.source}] ${r.title}`);
                console.log(`   ${r.link}`);
                console.log(`   ${r.snippet.substring(0, 100)}...`);
            });
        } else {
            console.log("❌ GAGAL/DIBLOKIR: Scraper mengembalikan hasil kosong.");
            console.log(result);
        }
    } catch (e) {
        console.error("Terjadi Error:", e);
    }
}

testBingScraper();
