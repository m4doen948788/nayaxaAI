const dbNayaxa = require('../src/config/dbNayaxa');

async function updatePersonaCreator() {
    console.log('[Migration] Memperbarui identitas pembuat pada nayaxa_personas...');
    try {
        const [rows] = await dbNayaxa.query('SELECT id, instansi_id, persona_name, system_prompt_template FROM nayaxa_personas');
        console.log(`[Migration] Ditemukan ${rows.length} baris persona.`);

        for (const row of rows) {
            let updatedTemplate = row.system_prompt_template;
            
            if (updatedTemplate.includes('dari Bapperida')) {
                updatedTemplate = updatedTemplate.replace(/asisten AI dari Bapperida/g, 'asisten AI');
            }
            if (updatedTemplate.includes('dibuat oleh tim IT Bapperida')) {
                updatedTemplate = updatedTemplate.replace(
                    /dibuat oleh tim IT Bapperida\./g,
                    'dibuat oleh tim IT nayaxa. Jika ditanya siapa pembuat kamu, siapa yang membuat/menciptakan Anda, atau siapa tim di balik Nayaxa, Anda WAJIB menjawab bahwa Anda dibuat oleh tim IT nayaxa.'
                );
            } else if (!updatedTemplate.includes('tim IT nayaxa')) {
                updatedTemplate = updatedTemplate.replace(
                    /Identitas ANDA: Nayaxa, asisten AI[^.]*\./,
                    'Identitas ANDA: Nayaxa, asisten AI yang dibuat oleh tim IT nayaxa. Jika ditanya siapa pembuat kamu, siapa yang membuat/menciptakan Anda, atau siapa tim di balik Nayaxa, Anda WAJIB menjawab bahwa Anda dibuat oleh tim IT nayaxa.'
                );
            }

            if (updatedTemplate !== row.system_prompt_template) {
                await dbNayaxa.query(
                    'UPDATE nayaxa_personas SET system_prompt_template = ?, updated_at = NOW() WHERE id = ?',
                    [updatedTemplate, row.id]
                );
                console.log(`[Migration] Berhasil memperbarui persona ID ${row.id} (${row.persona_name}).`);
            } else {
                console.log(`[Migration] Persona ID ${row.id} (${row.persona_name}) sudah sesuai atau tidak memerlukan perubahan.`);
            }
        }

        console.log('[Migration] Pembaruan identitas pembuat selesai dengan sukses.');
        process.exit(0);
    } catch (err) {
        console.error('[Migration] Gagal memperbarui persona:', err.message);
        process.exit(1);
    }
}

updatePersonaCreator();
