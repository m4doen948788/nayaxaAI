/**
 * NayaxaPersona Service
 * Manages long-term user personality memory for Nayaxa.
 * 
 * Design principles:
 * - NON-BLOCKING: All DB writes run fire-and-forget (no await in hot path)
 * - FAIL-SAFE:   All errors are caught silently — persona failure never crashes chat
 * - LAZY-UPDATE: Persona analysis only runs when meaningful message count threshold is met
 * - LIGHTWEIGHT: In-memory cache prevents redundant DB reads within the same Node process
 */

const dbNayaxa = require('../config/dbNayaxa');

// In-memory cache: { userId: { persona_text, loaded_at } }
const personaCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// How many user messages in a session before we trigger a persona update
const UPDATE_THRESHOLD = 3;

const personaService = {

    /**
     * Fetch the user's persona text. Returns an empty string on any failure.
     * Uses in-memory cache to avoid redundant DB reads.
     */
    getPersona: async (user_id) => {
        if (!user_id) return '';

        // Check cache
        if (personaCache.has(user_id)) {
            const cached = personaCache.get(user_id);
            if (Date.now() - cached.loaded_at < CACHE_TTL_MS) {
                return cached.persona_text;
            }
        }

        try {
            const [rows] = await dbNayaxa.query(
                'SELECT persona_text FROM nayaxa_user_personas WHERE user_id = ? LIMIT 1',
                [user_id]
            );
            const text = rows.length > 0 ? (rows[0].persona_text || '') : '';
            personaCache.set(user_id, { persona_text: text, loaded_at: Date.now() });
            return text;
        } catch (err) {
            // Table might not exist yet — fail silently
            console.error('[Persona] getPersona error (non-fatal):', err.message);
            return '';
        }
    },

    /**
     * Trigger an async persona update after the chat response is already sent.
     * This is fire-and-forget — it NEVER blocks the chat response.
     * 
     * @param {number} user_id
     * @param {string} user_name
     * @param {string} session_id
     * @param {object} dbNayaxaPool - shared DB pool
     * @param {function} aiAnalyzer - function(prompt) => string (calls the AI)
     */
    triggerPersonaUpdate: (user_id, user_name, session_id, aiAnalyzer) => {
        if (!user_id || !session_id) return;

        // Run purely async (no await at the call site)
        setImmediate(async () => {
            try {
                // 1. Count user messages in this session
                const [countRows] = await dbNayaxa.query(
                    "SELECT COUNT(*) as cnt FROM nayaxa_chat_history WHERE session_id = ? AND role = 'user'",
                    [session_id]
                );
                const msgCount = countRows[0]?.cnt || 0;

                // 2. Only analyze if we have enough messages (avoids wasting tokens on 1-line chats)
                if (msgCount < UPDATE_THRESHOLD) {
                    return;
                }

                // 3. Check when we last updated this user's persona
                const [lastUpdate] = await dbNayaxa.query(
                    'SELECT updated_at FROM nayaxa_user_personas WHERE user_id = ? LIMIT 1',
                    [user_id]
                );
                
                // 4. Skip if persona was updated less than 1 hour ago (rate limiting for AI calls)
                if (lastUpdate.length > 0) {
                    const lastUpdatedAt = new Date(lastUpdate[0].updated_at);
                    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                    if (lastUpdatedAt > oneHourAgo) {
                        return; // Updated recently, no need to re-analyze
                    }
                }

                // 5. Fetch recent messages from this session for analysis
                const [msgRows] = await dbNayaxa.query(
                    "SELECT role, content FROM nayaxa_chat_history WHERE session_id = ? ORDER BY created_at ASC LIMIT 20",
                    [session_id]
                );
                if (msgRows.length < UPDATE_THRESHOLD) return;

                // 6. Build a compact conversation transcript for analysis
                const transcript = msgRows
                    .map(m => `${m.role === 'user' ? 'USER' : 'NAYAXA'}: ${m.content?.substring(0, 200)}`)
                    .join('\n');

                // 7. Read existing persona (if any) to refine it, not replace it
                const [existingRows] = await dbNayaxa.query(
                    'SELECT persona_text FROM nayaxa_user_personas WHERE user_id = ? LIMIT 1',
                    [user_id]
                );
                const existingPersona = existingRows.length > 0 ? existingRows[0].persona_text : '';

                // 8. Build the analysis prompt (designed to be VERY short output)
                const analysisPrompt = `Kamu adalah analis kepribadian pengguna. Berdasarkan percakapan berikut, perbarui profil kepribadian user dalam SATU PARAGRAF RINGKAS (maks 100 kata, tanpa emoji, tanpa bullet point).

${existingPersona ? `Profil lama:\n"${existingPersona}"\n\n` : ''}Percakapan terbaru:\n${transcript}

Fokus pada: (1) gaya bicara & formalitas (DETEKSI apakah user menggunakan bahasa santai/gaul seperti 'gue/lo/gw/elu'), (2) topik atau data yang sering ditanyakan, (3) preferensi format jawaban (termasuk panggilan kesayangan), (4) konteks kerja. Output HANYA paragraf profil, tidak ada teks lain.`;

                // 9. Call AI analyzer (provided by controller)
                const newPersona = await aiAnalyzer(analysisPrompt);
                if (!newPersona || newPersona.length < 20) return;

                // 10. Upsert persona to DB
                await dbNayaxa.query(
                    `INSERT INTO nayaxa_user_personas (user_id, user_name, persona_text, updated_at)
                     VALUES (?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE persona_text = ?, user_name = ?, updated_at = NOW()`,
                    [user_id, user_name, newPersona, newPersona, user_name]
                );

                // 11. Invalidate cache so next request gets fresh data
                personaCache.delete(user_id);

                console.log(`[Persona] Profile updated for user ${user_id} (${user_name}).`);
            } catch (err) {
                // Completely silent failure — persona update should NEVER crash or delay chat
                console.error('[Persona] triggerPersonaUpdate error (non-fatal):', err.message);
            }
        });
    },

    /**
     * Format the persona text into a compact system prompt snippet.
     * Returns empty string if no persona exists yet.
     */
    formatForPrompt: (persona_text) => {
        if (!persona_text || persona_text.trim().length < 10) return '';
        return `\nPROFIL KEPRIBADIAN USER (Ingatan Jangka Panjang Nayaxa):\n"${persona_text.trim()}"\nGunakan informasi ini untuk menyesuaikan gaya bicara, nada, dan rekomendasi Anda agar terasa sangat personal.\n`;
    }
};

module.exports = personaService;
