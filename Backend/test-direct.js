const requireModule = require('./src/services/nayaxaGeminiService');

async function debugDirectly() {
    try {
        console.log('--- START DIRECT TEST ---');
        const fileBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const result = await requireModule.chatWithNayaxa(
            "analisis gambar ini",
            fileBase64,
            "image/png",
            1, // instansi_id
            3, // month
            2026, // year
            [], // history
            "Test Admin",
            1
        );
        console.log('--- END SUCCESS ---');
        console.log("Result:", result);
    } catch (e) {
        console.log('--- UNCATCHABLE CRASH CAUGHT? ---');
        console.error(e);
    }
}

debugDirectly();
