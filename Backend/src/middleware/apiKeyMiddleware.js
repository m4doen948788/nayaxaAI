const dbNayaxa = require('../config/dbNayaxa');

const verifyApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey) {
        return res.status(401).json({ success: false, message: 'API Key wajib disertakan.' });
    }

    try {
        const [rows] = await dbNayaxa.query(
            'SELECT * FROM nayaxa_api_keys WHERE api_key = ? AND is_active = 1',
            [apiKey]
        );
        
        if (rows.length === 0) {
            return res.status(403).json({ success: false, message: 'API Key tidak valid.' });
        }

        // Store app context for use in controllers
        const app = rows[0];
        req.nayaxaApp = app;

        // Security: If the API Key is locked to a specific instansi_id, 
        // enforce it here to prevent clients from spoofing other instansi.
        if (app.instansi_id) {
            req.query.instansi_id = app.instansi_id;
            if (req.body) req.body.instansi_id = app.instansi_id;
        }
        next();
    } catch (err) {
        console.error('API Key Verification Error:', err);
        res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
    }
};

module.exports = { verifyApiKey };
