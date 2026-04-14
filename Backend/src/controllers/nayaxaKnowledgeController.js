const dbNayaxa = require('../config/dbNayaxa');

const nayaxaKnowledgeController = {
    getAll: async (req, res) => {
        try {
            const [rows] = await dbNayaxa.query('SELECT * FROM nayaxa_knowledge ORDER BY created_at DESC');
            // Backward compatibility: map 'content' to 'description' for dashboard
            const mappedRows = rows.map(r => ({
                ...r,
                description: r.content
            }));
            res.json({ success: true, data: mappedRows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    },

    create: async (req, res) => {
        try {
            const body = req.body || {};
            // Robust mapping: check content then description
            const contentValue = body.content !== undefined ? body.content : body.description;
            const categoryValue = body.category || null;
            const featureNameValue = body.feature_name || 'General';
            const sourceFileValue = body.source_file || null;
            const isActiveValue = body.is_active !== undefined ? body.is_active : 1;
            const contextRulesValue = body.context_rules || '[]';

            const app_id = req.nayaxaApp?.id || 1;
            
            await dbNayaxa.query(
                'INSERT INTO nayaxa_knowledge (app_id, category, content, source_file, is_active, feature_name, context_rules) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [app_id, categoryValue, contentValue, sourceFileValue, isActiveValue, featureNameValue, contextRulesValue]
            );
            res.json({ success: true, message: 'Success' });
        } catch (error) {
            console.error('[Knowledge_Controller] Create Error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    update: async (req, res) => {
        try {
            const { id } = req.params;
            const body = req.body || {};
            
            // Get current data first to avoid overwriting with NULL if fields are missing in request
            const [current] = await dbNayaxa.query('SELECT * FROM nayaxa_knowledge WHERE id = ?', [id]);
            if (current.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
            
            const oldData = current[0];
            
            const contentValue = body.content !== undefined ? body.content : (body.description !== undefined ? body.description : oldData.content);
            const categoryValue = body.category !== undefined ? body.category : oldData.category;
            const featureNameValue = body.feature_name !== undefined ? body.feature_name : oldData.feature_name;
            const sourceFileValue = body.source_file !== undefined ? body.source_file : oldData.source_file;
            const isActiveValue = body.is_active !== undefined ? body.is_active : oldData.is_active;
            const contextRulesValue = body.context_rules !== undefined ? body.context_rules : oldData.context_rules;

            await dbNayaxa.query(
                'UPDATE nayaxa_knowledge SET category = ?, content = ?, source_file = ?, is_active = ?, feature_name = ?, context_rules = ? WHERE id = ?',
                [categoryValue, contentValue, sourceFileValue, isActiveValue, featureNameValue, contextRulesValue || '[]', id]
            );
            res.json({ success: true, message: 'Updated' });
        } catch (error) {
            console.error('[Knowledge_Controller] Update Error:', error);
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
