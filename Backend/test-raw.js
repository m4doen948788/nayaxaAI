const axios = require('axios');
const crypto = require('crypto');

async function testRawAxios() {
    try {
        console.log('--- START RAW AXIOS TEST ---');
        const apiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('No API key found in env.');
            process.exit(1);
        }

        const MODEL = 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [
                    { text: "analisis gambar ini" },
                    {
                        inline_data: {
                            mime_type: "image/png",
                            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1
            }
        };

        console.log(`Sending POST to ${MODEL}...`);
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('--- SUCCESS ---');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (e) {
        console.log('--- ERROR ---');
        if (e.response) {
            console.error('API Error:', e.response.status, JSON.stringify(e.response.data));
        } else {
            console.error(e.message);
        }
    }
}

require('dotenv').config();
testRawAxios();
