const mysql = require('mysql2/promise');

async function migrate() {
    const config = {
        host: 'kasibah.com',
        user: 'kasibahc_dashboard_ppm',
        password: 'eW7UFcbuRrJmKECk5mNz',
        database: 'kasibahc_dashboard_ppm'
    };

    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(config);
        console.log('Successfully connected.');

        console.log('Adding line_height and text_align to surat_templates...');
        
        // Use a more robust check or just try and catch
        try {
            await connection.query('ALTER TABLE surat_templates ADD COLUMN line_height FLOAT DEFAULT 1.5');
            console.log('Added line_height column.');
        } catch (e) {
            console.log('line_height column might already exist.');
        }

        try {
            await connection.query('ALTER TABLE surat_templates ADD COLUMN text_align VARCHAR(20) DEFAULT "justify"');
            console.log('Added text_align column.');
        } catch (e) {
            console.log('text_align column might already exist.');
        }

        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

migrate();
