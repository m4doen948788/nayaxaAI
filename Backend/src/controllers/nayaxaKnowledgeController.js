const dbNayaxa = require('../config/dbNayaxa');

const nayaxaKnowledgeController = {
    getAll: async (req, res) => {
        try {
            const [rows] = await dbNayaxa.query('SELECT * FROM nayaxa_knowledge ORDER BY created_at DESC');
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    },

    create: async (req, res) => {
        try {
            const { category, content, source_file, is_active } = req.body;
            const app_id = req.nayaxaApp?.id || 1;
            await dbNayaxa.query(
                'INSERT INTO nayaxa_knowledge (app_id, category, content, source_file, is_active) VALUES (?, ?, ?, ?, ?)',
                [app_id, category, content, source_file, is_active ?? 1]
            );
            res.json({ success: true, message: 'Success' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    },

    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { category, content, source_file, is_active } = req.body;
            await dbNayaxa.query(
                'UPDATE nayaxa_knowledge SET category = ?, content = ?, source_file = ?, is_active = ? WHERE id = ?',
                [category, content, source_file, is_active, id]
            );
            res.json({ success: true, message: 'Updated' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    },

    deleteKnowledge: async (req, res) => {
        try {
            const { id } = req.params;
            await dbNayaxa.query('DELETE FROM nayaxa_knowledge WHERE id = ?', [id]);
            res.json({ success: true, message: 'Deleted' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
};

module.exports = nayaxaKnowledgeController;
