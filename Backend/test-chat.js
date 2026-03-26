const axios = require('axios');

async function testChat() {
    try {
        console.log('Sending request...');
        const response = await axios.post('http://localhost:6001/api/nayaxa/chat', {
            message: "analisis ini",
            fileBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            fileMimeType: "image/png",
            instansi_id: 1,
            month: 3,
            year: 2026,
            user_id: 1,
            user_name: "Test User"
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'NAYAXA-BAPPERIDA-8888-9999-XXXX'
            }
        });
        console.log('--- RESPONSE SUCCESS ---');
        console.log(response.data);
    } catch (error) {
        console.error('--- RESPONSE ERROR ---');
        console.error(error.message);
    }
}

testChat();
