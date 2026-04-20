const dbNayaxa = require('../config/dbNayaxa');

const verifyApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey) {
        return res.status(401).json({ success: false, message: 'API Key wajib disertakan.' });
    }

    let attempts = 0;
    while (attempts < 2) {
        try {
            const [rows] = await dbNayaxa.query(
                'SELECT * FROM nayaxa_api_keys WHERE api_key = ? AND is_active = 1',
                [apiKey]
            );
            
            if (rows.length === 0) {
                return res.status(403).json({ success: false, message: 'API Key tidak valid.' });
            }

            const app = rows[0];
            req.nayaxaApp = app;

            if (app.instansi_id) {
                req.query.instansi_id = app.instansi_id;
                if (req.body) req.body.instansi_id = app.instansi_id;
            }
            return next(); // SUCCESS
        } catch (err) {
            attempts++;
            console.error(`[Auth] Attempt ${attempts} failed:`, err.message);
            if (attempts >= 2) {
                console.error('[Auth] Max attempts reached. Final error context:', {
                    apiKey: apiKey ? (apiKey.substring(0, 4) + '...') : 'missing',
                    error: err.stack
                });
                return res.status(500).json({ 
                    success: false, 
                    message: 'Internal server error during authentication.' 
                });
            }
            // Small delay before retry to let pool recover
            await new Promise(r => setTimeout(r, 500));
        }
    }
};


module.exports = { verifyApiKey };
