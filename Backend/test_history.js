const axios = require('axios');
require('dotenv').config({path: './.env'});

async function testHistory() {
    try {
        await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-v4-flash',
            messages: [
                {role: 'user', content: 'Siapa namamu?'},
                {role: 'assistant', content: 'Namaku Nayaxa'},
                {role: 'user', content: 'Ulangi namamu'}
            ],
            temperature: 0.1,
            max_tokens: 8192
        }, {
            headers: {'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY}
        });
        console.log('HISTORY TEST: OK');
    } catch (e) {
        console.error('HISTORY TEST ERROR:', e.response?.data || e.message);
    }
}
testHistory();
