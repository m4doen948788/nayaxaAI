const express = require('express');
// Version 1.0.1 - Forced Restart
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 6001;

// Basic security and parsing
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Nayaxa Standalone Engine',
        version: '4.3.0',
        timestamp: new Date().toISOString()
    });
});

// Primary Nayaxa Routes
const nayaxaRoutes = require('./routes/nayaxaRoutes');
app.use('/', nayaxaRoutes);
app.use('/api/nayaxa', nayaxaRoutes);

const server = app.listen(PORT, '0.0.0.0', () => {
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

// Set server timeouts to 5 minutes to accommodate large AI document generations
server.timeout = 300000;
server.keepAliveTimeout = 300000;
server.headersTimeout = 305000;
