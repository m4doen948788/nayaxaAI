/**
 * Nayaxa SessionTitle Service
 * Manages background topic title generation for chat sessions.
 * 
 * Design principles:
 * - NON-BLOCKING: Generation runs completely asynchronously via setImmediate.
 * - FAIL-SAFE:   Errors are caught silently — title generation failure never affects chat stream/response.
 * - CONTEXTUAL:  Title is generated after the first user prompt + model response pair is saved.
 */

const dbNayaxa = require('../config/dbNayaxa');

const sessionTitleService = {

    /**
     * Trigger asynchronous topic title generation.
     * 
     * @param {number} app_id
     * @param {number} user_id
     * @param {string} session_id
     * @param {function} aiAnalyzer - function(prompt) => Promise<string> (uses routeSimpleTask)
     */
    triggerTitleUpdate: (app_id, user_id, session_id, aiAnalyzer) => {
        if (!app_id || !user_id || !session_id || !aiAnalyzer) return;

        setImmediate(async () => {
            try {
                // 1. Check if session already has a title
                const [existing] = await dbNayaxa.query(
                    'SELECT title FROM nayaxa_chat_sessions WHERE session_id = ? LIMIT 1',
                    [session_id]
                );
                if (existing.length > 0 && existing[0].title) {
                    return; // Title already exists, no need to regenerate
                }

                // 2. Count messages in this session
                const [countRows] = await dbNayaxa.query(
                    'SELECT COUNT(*) as cnt FROM nayaxa_chat_history WHERE session_id = ?',
                    [session_id]
                );
                const msgCount = countRows[0]?.cnt || 0;

                // Only generate title if we have at least 2 messages (1 user, 1 assistant)
                if (msgCount < 2) {
                    return;
                }

                // 3. Fetch first few messages to get initial topic context
                const [msgRows] = await dbNayaxa.query(
                    'SELECT role, content FROM nayaxa_chat_history WHERE session_id = ? ORDER BY created_at ASC LIMIT 4',
                    [session_id]
                );
                if (msgRows.length < 2) return;

                // 4. Construct compact transcript
                const transcript = msgRows
                    .map(m => `${m.role === 'user' ? 'USER' : 'NAYAXA'}: ${m.content?.substring(0, 300)}`)
                    .join('\n');

                // 5. Build prompt
                const prompt = `Kamu adalah sistem pembuat judul sesi chat Nayaxa. Analisis percakapan berikut dan buatlah satu judul percakapan yang sangat singkat, padat, dan representatif (2-5 kata, tanpa tanda kutip, tanpa emoji, dalam Bahasa Indonesia).

Percakapan:
${transcript}

Output HANYA judul percakapan saja, jangan berikan teks pembuka atau penutup.`;

                // 6. Call AI analyzer
                let title = await aiAnalyzer(prompt);
                if (!title || title.trim().length === 0) return;

                // 7. Clean and normalize the title
                title = title.replace(/["'“”«»]/g, '').trim();
                // If title is wrapped in markdown bold or header, strip it
                title = title.replace(/^\**#*\s*/, '').replace(/\**$/, '').trim();
                
                if (title.length > 100) {
                    title = title.substring(0, 97) + '...';
                }

                if (!title) return;
                
                // Strip 4-byte characters (emoji, etc.) to ensure compatibility with utf8mb3 databases
                const safeTitle = title.replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[\uD800-\uDFFF]/g, '').trim();
                if (!safeTitle) return;

                // 8. Upsert title to DB
                await dbNayaxa.query(
                    `INSERT INTO nayaxa_chat_sessions (app_id, user_id, session_id, title)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE title = VALUES(title), updated_at = NOW()`,
                    [app_id, user_id, session_id, safeTitle]
                );

                console.log(`[SessionTitle] Title generated for session ${session_id}: "${title}"`);

            } catch (err) {
                // Fail silently
                console.error('[SessionTitle] triggerTitleUpdate error (non-fatal):', err.message);
            }
        });
    }

};

module.exports = sessionTitleService;
