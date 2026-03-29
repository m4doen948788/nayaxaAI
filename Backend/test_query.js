const axios = require('axios');
const fs = require('fs');

(async () => {
    try {
        const query = 'sammy lugina';
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`;
        const desktopHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
        };
        const response = await axios.get(searchUrl, { headers: desktopHeaders, timeout: 12000 });
        fs.writeFileSync('bing_test.html', response.data);
        console.log('Bing HTML saved');
    } catch (e) {
        console.error("Error:", e.response ? e.response.status : e.message);
    }
})();
