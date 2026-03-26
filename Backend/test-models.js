const axios = require('axios');

async function testModels() {
    const apiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No API key found in env.');
        process.exit(1);
    }

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
        }]
    };

    const modelsToTest = [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-1.0-pro-vision-latest',
        'gemini-pro-vision'
    ];

    for (const model of modelsToTest) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        console.log(`\nTesting ${model}...`);
        try {
            const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
            console.log(`  SUCCESS! Model is available.`);
        } catch (e) {
            if (e.response) {
                console.log(`  FAILED: ${e.response.status} - ${e.response.data.error.message}`);
            } else {
                console.log(`  FAILED: ${e.message}`);
            }
        }
    }
}

require('dotenv').config();
testModels();
