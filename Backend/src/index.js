const express = require('express');
// Version 1.0.1 - Forced Restart
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 6001;

// Basic security and parsing
app.use(cors()); // In production, restrict to dashboard origins
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Nayaxa Standalone Engine',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Primary Nayaxa Routes
const nayaxaRoutes = require('./routes/nayaxaRoutes');
app.use('/api/nayaxa', nayaxaRoutes);

// Serve Static Files (Reports & Exports)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Nayaxa AI Engine Standalone Active!`);
    console.log(`📡 Listening on port: ${PORT}`);
    console.log(`=========================================`);

    // Initialize Nayaxa Mind (Background Intelligence)
    try {
        const nayaxaMind = require('./services/nayaxaMindService');
        nayaxaMind.init(60); // Pulse every 1 hour
    } catch (e) {
        console.error('[System] Failed to start Nayaxa Mind:', e);
    }
});
