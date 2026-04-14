const axios = require('axios');
const cheerio = require('cheerio');

async function testYahoo(query) {
    try {
        const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&setlang=id`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        };
        const res = await axios.get(url, { headers });
        const $ = cheerio.load(res.data);
        const results = [];
        
        $('.algo').each((i, el) => {
            const title = $(el).find('h3 a').text();
            const link = $(el).find('h3 a').attr('href');
            const snippet = $(el).find('.compText').text();
            if (title && link) {
                results.push({ title: title.trim(), link, snippet: snippet.trim() });
            }
        });
        
        console.log(`Found ${results.length} results from Yahoo`);
        if (results.length > 0) {
            console.log('Sample result:', results[0]);
        }
    } catch (err) {
        console.error('Yahoo Scrape Error:', err.message);
    }
}

testYahoo('sammy lugina');
