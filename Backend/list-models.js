const axios = require('axios');

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No API key found in env.');
        process.exit(1);
    }
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await axios.get(url);
        
        console.log('--- AVAILABLE MODELS ---');
        response.data.models.forEach(m => {
            console.log(`Name: ${m.name}`);
            console.log(`Version: ${m.version}`);
            console.log(`Supported Methods: ${m.supportedGenerationMethods.join(', ')}`);
            console.log('---');
        });
    } catch (e) {
        console.error('Error fetching models:', e.message);
        if (e.response) {
            console.error(e.response.data);
        }
    }
}

require('dotenv').config();
listModels();
