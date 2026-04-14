const axios = require('axios');
const fs = require('fs');

async function debugHtml() {
    const query = "Muflikha Mayazi";
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gbv=1`;
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });
        fs.writeFileSync('google-debug.html', response.data);
        console.log('HTML saved to google-debug.html');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

debugHtml();
