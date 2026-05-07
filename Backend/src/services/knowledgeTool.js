const dbNayaxa = require('../config/dbNayaxa');

const knowledgeTool = {
    /**
     * AI-powered tool to save parsed document content into structured knowledge
     */
    ingestToKnowledge: async (app_id, category, content, source_file, feature_name = 'General') => {
        try {
            // Split content into chunks if too large (naive split for now)
            const chunks = content.match(/[\s\S]{1,2000}/g) || [content];
            
            for (const chunk of chunks) {
                await dbNayaxa.query(
                    'INSERT INTO nayaxa_knowledge (app_id, category, content, source_file, feature_name, context_rules) VALUES (?, ?, ?, ?, ?, ?)',
                    [app_id, category, chunk, source_file, feature_name, '[]']
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
