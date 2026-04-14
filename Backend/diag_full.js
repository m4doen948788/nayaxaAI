try {
    console.log('--- Full Initial Load Check ---');
    console.log('1. Loading dotenv...');
    require('dotenv').config();
    
    console.log('2. Loading express...');
    const express = require('express');
    const app = express();
    
    console.log('3. Loading cors...');
    const cors = require('cors');
    
    console.log('4. Applying middleare...');
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    
    console.log('5. Loading routes...');
    const nayaxaRoutes = require('./src/routes/nayaxaRoutes');
    app.use('/api/nayaxa', nayaxaRoutes);
    
    console.log('6. Setup complete! If it gets here, the loading is NOT the problem.');
    process.exit(0);
} catch (error) {
    console.error('--- LOAD FAILED! ---');
    console.error(error.stack);
    process.exit(1);
}
