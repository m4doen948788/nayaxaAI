const dbNayaxa = require('../config/dbNayaxa');

const knowledgeTool = {
    /**
     * AI-powered tool to save parsed document content into structured knowledge
     */
    ingestToKnowledge: async (app_id, category, content, source_file, feature_name = 'General') => {
        try {
            // Strip 4-byte characters (emoji, etc.) to ensure compatibility with utf8mb3 databases
            const sanitize = (str) => (str || '').replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[\uD800-\uDFFF]/g, '');
            const safeContent = sanitize(content);
            const safeCategory = sanitize(category);
            const safeSource = sanitize(source_file);

            // Split content into chunks if too large (naive split for now)
            const chunks = safeContent.match(/[\s\S]{1,2000}/g) || [safeContent];
            
            for (const chunk of chunks) {
                await dbNayaxa.query(
                    'INSERT INTO nayaxa_knowledge (app_id, category, content, source_file, feature_name, context_rules) VALUES (?, ?, ?, ?, ?, ?)',
                    [app_id, safeCategory, chunk, safeSource, feature_name, '[]']
                );
            }
            
            return {
                success: true,
                message: `Berhasil mempelajari ${chunks.length} potongan informasi dari ${source_file}.`,
                chunks_count: chunks.length
            };
        } catch (error) {
            console.error('Knowledge Ingestion Error:', error);
            throw new Error('Gagal menyimpan pengetahuan baru.');
        }
    }
};

module.exports = knowledgeTool;
