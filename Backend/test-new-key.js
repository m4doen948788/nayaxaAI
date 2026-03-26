const axios = require('axios');
require('dotenv').config();

async function testNewKey() {
    const apiKey = process.env.GEMINI_API_KEY;
    const models = ['gemini-2.0-flash', 'gemini-2.5-flash'];
    
    for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
            await axios.post(url, {
                contents: [{ parts: [{ text: "p" }] }]
            });
            console.log(`Model ${model} is AVAILABLE for this key.`);
        } catch (e) {
            console.log(`Model ${model} is NOT available: ${e.message}`);
        }
    }
}

testNewKey();
