const axios = require('axios');
require('dotenv').config({path: './.env'});

async function test() {
    try {
        const code = require('fs').readFileSync('./src/services/nayaxaDeepSeekService.js', 'utf8');
        const toolsStr = code.substring(code.indexOf('const DEEPSEEK_TOOLS = ['), code.indexOf('// --- CODING AGENT TOOLS'));
        
        // Make it an eval-able expression
        const executableCode = toolsStr.replace('const DEEPSEEK_TOOLS = ', '(') + ');';
        const DEEPSEEK_TOOLS = eval(executableCode);
        
        await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-v4-flash',
            messages: [{role: 'user', content: 'Halo'}],
            tools: DEEPSEEK_TOOLS,
            temperature: 0.1,
            max_tokens: 8192
        }, {
            headers: {'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY}
        });
        console.log('OK');
    } catch (e) {
        console.error('ERROR:', e.message);
        if (e.response && e.response.data) {
            console.error('DATA:', JSON.stringify(e.response.data));
        }
    }
}
test();
