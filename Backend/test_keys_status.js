const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const DEEPSEEK_KEY = 'sk-3ecaf0e114ab468db0a61689f0b96a58';
const GEMINI_KEY = 'AIzaSyDQWZuMYdUc7yPxKrSUBgDlw5_7h5xPTJQ';

async function testDeepSeek() {
    console.log('Testing DeepSeek API...');
    try {
        const res = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: "deepseek-chat",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 10
        }, { headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}` } });
        console.log('DeepSeek OK:', res.data.choices[0].message.content);
    } catch (err) {
        console.error('DeepSeek FAILED:', err.response?.status, err.response?.data || err.message);
    }
}

async function testGemini() {
    console.log('\nTesting Gemini API...');
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent("hi");
        console.log('Gemini OK:', result.response.text());
    } catch (err) {
        console.error('Gemini FAILED:', err.message);
    }
}

async function runTests() {
    await testDeepSeek();
    await testGemini();
}

runTests();
