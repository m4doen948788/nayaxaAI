const nayaxaStandalone = require('./src/services/nayaxaStandalone');

async function testGlossary() {
    try {
        const glossary = await nayaxaStandalone.getMasterDataGlossary();
        console.log('--- UPDATED GLOSSARY ---');
        console.log(glossary);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

testGlossary();
