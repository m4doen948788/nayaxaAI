require('dotenv').config({path: './.env'});
const nayaxaDeepSeekService = require('./src/services/nayaxaDeepSeekService');

// Mock dependencies required by the service
global.nayaxaStandalone = {
    getDatabaseSchema: async () => "MOCK SCHEMA",
    getMasterDataGlossary: async () => "MOCK GLOSSARY"
};
global.pool = { query: async () => [] };
global.dbNayaxa = { query: async () => [] };

async function runLocalTest() {
    console.log("Memulai simulasi Nayaxa Engine di lokal...");
    try {
        const result = await nayaxaDeepSeekService.chatWithNayaxa(
            "ada dokumen tentang kesehatan terbaru?", // userMessage
            [], // files
            2, // instansi_id
            4, // month
            2026, // year
            [], // prevHistory
            "Mufli", // user_name
            null, // profil_id
            "", // fileContext
            "", "", "", "", "Bapperida", "", null, null, false, null, null, null
        );
        console.log("HASIL:", result);
    } catch (e) {
        console.error("GAGAL:", e.message);
    }
}
runLocalTest();
