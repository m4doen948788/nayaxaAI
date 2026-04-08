const nayaxaMind = require('./src/services/nayaxaMindService');

async function testMind() {
    console.log("Starting Nayaxa Mind manual verification...");
    try {
        await nayaxaMind.learnNewDocuments();
        console.log("---");
        await nayaxaMind.generateSystemSnapshot();
        console.log("---");
        console.log("Verification finished. Check nayaxa_mind_logs and nayaxa_knowledge tables.");
    } catch (e) {
        console.error("MIND TEST FAILED:", e);
    } finally {
        process.exit();
    }
}

testMind();
