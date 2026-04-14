const axios = require('axios');
const cheerio = require('cheerio');

async function testDDG(query) {
    try {
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        };
        const res = await axios.get(url, { headers });
        const $ = cheerio.load(res.data);
        const results = [];
        
        $('.result').each((i, el) => {
            const title = $(el).find('.result__a').text();
            const link = $(el).find('.result__a').attr('href');
            const snippet = $(el).find('.result__snippet').text();
            if (title && link) {
                results.push({ title: title.trim(), link, snippet: snippet.trim() });
            }
        });
        
        console.log(`Found ${results.length} results from DuckDuckGo`);
        if (results.length > 0) {
            console.log('Sample result:', results[0]);
        }
    } catch (err) {
        console.error('DDG Scrape Error:', err.message);
    }
}

testDDG('sammy lugina');
