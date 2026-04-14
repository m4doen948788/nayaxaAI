const dbNayaxa = require('../config/dbNayaxa');

/**
 * Controller untuk mengelola pesan langsung antar rekan (Direct User-to-User Chat)
 * dengan protokol keamanan End-to-End Encryption (E2EE) berbasis Web Crypto API (AES-GCM 256-bit).
 * 
 * Prinsip Keamanan (Zero-Knowledge Server Layer):
 * - Seluruh payload pesan (message) dienkripsi di sisi browser pengguna sebelum dikirim ke endpoint.
 * - Server dan database hanya bertindak sebagai media penyimpan & relayer ciphertext (E2EE:v1:...).
 * - Server tidak menyimpan maupun memiliki akses terhadap kunci privat/simetris pengguna.
 */
const nayaxaUserChatController = {
    /**
     * Bersihkan pesan usang yang sudah lewat dari 3 jam (auto-delete 3 jam)
     */
    cleanExpiredMessages: async () => {
        try {
            await dbNayaxa.query(`
                DELETE FROM nayaxa_user_messages
                WHERE created_at < NOW() - INTERVAL 3 HOUR
            `);
        } catch (err) {
            console.error('[nayaxaUserChatController.cleanExpiredMessages] Error:', err.message);
        }
    },

    /**
     * Ambil daftar rekan/pengguna terdaftar di nayaxa.my.id
     */
    getContacts: async (req, res) => {
        try {
            const currentUserId = parseInt(req.query.user_id, 10);
            const searchQuery = req.query.q ? String(req.query.q).trim() : '';

            if (!currentUserId || isNaN(currentUserId)) {
                return res.status(400).json({ success: false, message: 'Parameter user_id wajib disertakan.' });
            }

            // Bersihkan pesan yang sudah lebih dari 3 jam
            await nayaxaUserChatController.cleanExpiredMessages();

            let whereClauses = ['u.id != ?'];
            // 5 parameter untuk 3 subquery (unread_count, last_message, last_message_at) + 1 untuk u.id != ?
            let params = [currentUserId, currentUserId, currentUserId, currentUserId, currentUserId, currentUserId];

            if (searchQuery) {
                whereClauses.push('(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
                const searchPattern = `%${searchQuery}%`;
                params.push(searchPattern, searchPattern, searchPattern);
            }

            const sql = `
                SELECT 
                    u.id, 
                    u.username,
                    u.name,
                    u.email,
                    u.avatar,
                    u.role,
                    (
                        SELECT COUNT(*) 
                        FROM nayaxa_user_messages 
                        WHERE sender_id = u.id AND recipient_id = ? AND is_read = 0
                          AND created_at >= NOW() - INTERVAL 3 HOUR
                    ) AS unread_count,
                    (
                        SELECT message 
                        FROM nayaxa_user_messages 
                        WHERE ((sender_id = u.id AND recipient_id = ?) 
                           OR (sender_id = ? AND recipient_id = u.id))
                          AND created_at >= NOW() - INTERVAL 3 HOUR
                        ORDER BY id DESC 
                        LIMIT 1
                    ) AS last_message,
                    (
                        SELECT created_at 
                        FROM nayaxa_user_messages 
                        WHERE ((sender_id = u.id AND recipient_id = ?) 
                           OR (sender_id = ? AND recipient_id = u.id))
                          AND created_at >= NOW() - INTERVAL 3 HOUR
                        ORDER BY id DESC 
                        LIMIT 1
                    ) AS last_message_at
                FROM nayaxa_users u
                WHERE ${whereClauses.join(' AND ')}
                ORDER BY (last_message_at IS NOT NULL) DESC, last_message_at DESC, name ASC
                LIMIT 100
            `;

            const [contacts] = await dbNayaxa.query(sql, params);

            return res.json({
                success: true,
                contacts: contacts.map(c => ({
                    id: c.id,
                    username: c.username,
                    name: c.name,
                    email: c.email,
                    nip: null,
                    avatar: c.avatar,
                    bidang: null,
                    role: c.role || 'Pengguna',
                    unread_count: parseInt(c.unread_count, 10) || 0,
                    last_message: c.last_message || null,
                    last_message_at: c.last_message_at || null
                }))
            });
        } catch (err) {
            console.error('[nayaxaUserChatController.getContacts] Error:', err);
            return res.status(500).json({ success: false, message: 'Gagal mengambil daftar kontak pengguna.' });
        }
    },

    /**
     * Ambil riwayat percakapan antara dua pengguna (auto-delete 3 jam)
     */
    getMessages: async (req, res) => {
        try {
            const userId = parseInt(req.query.user_id, 10);
            const peerId = parseInt(req.query.peer_id, 10);

            if (!userId || !peerId || isNaN(userId) || isNaN(peerId)) {
                return res.status(400).json({ success: false, message: 'Parameter user_id dan peer_id wajib disertakan.' });
            }

            // Bersihkan pesan yang usang (> 3 jam)
            await nayaxaUserChatController.cleanExpiredMessages();

            // Ambil daftar pesan antara kedua pengguna (hanya dalam rentang 3 jam terakhir)
            const [messages] = await dbNayaxa.query(`
                SELECT 
                    id, 
                    sender_id, 
                    recipient_id, 
                    message, 
                    file_url, 
                    file_name, 
                    is_read, 
                    created_at
                FROM nayaxa_user_messages
                WHERE ((sender_id = ? AND recipient_id = ?)
                   OR (sender_id = ? AND recipient_id = ?))
                  AND created_at >= NOW() - INTERVAL 3 HOUR
                ORDER BY id ASC
                LIMIT 500
            `, [userId, peerId, peerId, userId]);

            // Tandai pesan dari lawan bicara ke user saat ini sebagai sudah dibaca
            await dbNayaxa.query(`
                UPDATE nayaxa_user_messages
                SET is_read = 1
                WHERE sender_id = ? AND recipient_id = ? AND is_read = 0
            `, [peerId, userId]);

            return res.json({
                success: true,
                messages
            });
        } catch (err) {
            console.error('[nayaxaUserChatController.getMessages] Error:', err);
            return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pesan.' });
        }
    },

    /**
     * Kirim pesan baru ke pengguna lain
     */
    sendMessage: async (req, res) => {
        try {
            const senderId = parseInt(req.body.sender_id, 10);
            const recipientId = parseInt(req.body.recipient_id, 10);
            const message = req.body.message ? String(req.body.message).trim() : '';
            const fileUrl = req.body.file_url || null;
            const fileName = req.body.file_name || null;

            if (!senderId || !recipientId || isNaN(senderId) || isNaN(recipientId)) {
                return res.status(400).json({ success: false, message: 'sender_id dan recipient_id wajib valid.' });
            }

            if (senderId === recipientId) {
                return res.status(400).json({ success: false, message: 'Tidak dapat mengirim pesan ke diri sendiri.' });
            }

            if (!message && !fileUrl) {
                return res.status(400).json({ success: false, message: 'Isi pesan atau lampiran tidak boleh kosong.' });
            }

            // Bersihkan pesan usang
            await nayaxaUserChatController.cleanExpiredMessages();

            // Validasi penerima ada di tabel nayaxa_users
            const [recipient] = await dbNayaxa.query('SELECT id FROM nayaxa_users WHERE id = ? LIMIT 1', [recipientId]);
            if (recipient.length === 0) {
                return res.status(404).json({ success: false, message: 'Penerima pesan tidak ditemukan di sistem.' });
            }

            const [result] = await dbNayaxa.query(`
                INSERT INTO nayaxa_user_messages (sender_id, recipient_id, message, file_url, file_name, is_read, created_at)
                VALUES (?, ?, ?, ?, ?, 0, NOW())
            `, [senderId, recipientId, message, fileUrl, fileName]);

            const [newRows] = await dbNayaxa.query(`
                SELECT id, sender_id, recipient_id, message, file_url, file_name, is_read, created_at
                FROM nayaxa_user_messages
                WHERE id = ?
            `, [result.insertId]);

            return res.status(201).json({
                success: true,
                message: newRows[0]
            });
        } catch (err) {
            console.error('[nayaxaUserChatController.sendMessage] Error:', err);
            return res.status(500).json({ success: false, message: 'Gagal mengirim pesan.' });
        }
    },

    /**
     * Hitung total pesan unread untuk pengguna yang login (dalam rentang 3 jam terakhir)
     */
    getUnreadCount: async (req, res) => {
        try {
            const userId = parseInt(req.query.user_id, 10);
            if (!userId || isNaN(userId)) {
                return res.status(400).json({ success: false, message: 'Parameter user_id wajib disertakan.' });
            }

            await nayaxaUserChatController.cleanExpiredMessages();

            const [rows] = await dbNayaxa.query(`
                SELECT COUNT(*) as total_unread
                FROM nayaxa_user_messages
                WHERE recipient_id = ? AND is_read = 0
                  AND created_at >= NOW() - INTERVAL 3 HOUR
            `, [userId]);

            return res.json({
                success: true,
                total_unread: parseInt(rows[0].total_unread, 10) || 0
            });
        } catch (err) {
            console.error('[nayaxaUserChatController.getUnreadCount] Error:', err);
            return res.status(500).json({ success: false, message: 'Gagal menghitung unread messages.' });
        }
    }
};

module.exports = nayaxaUserChatController;
