const bcrypt = require('bcryptjs');
const dbNayaxa = require('../config/dbNayaxa');

const nayaxaAuthController = {
    /**
     * Login pengguna terdaftar di nayaxa.my.id (tabel mandiri nayaxa_users)
     */
    login: async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username/email dan kata sandi wajib diisi.'
                });
            }

            const cleanIdentifier = String(username).trim();

            const [rows] = await dbNayaxa.query(`
                SELECT 
                    id, username, password, name, email, avatar, role, is_active
                FROM nayaxa_users
                WHERE (username = ? OR email = ?) AND is_active = 1
                LIMIT 1
            `, [cleanIdentifier, cleanIdentifier]);

            if (rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'Akun dengan username atau email tersebut tidak ditemukan.'
                });
            }

            const user = rows[0];

            // Verifikasi password dengan bcrypt
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Kata sandi tidak sesuai. Silakan periksa kembali.'
                });
            }

            const displayName = user.name || user.username;

            return res.json({
                success: true,
                message: `Selamat datang kembali, ${displayName}!`,
                user: {
                    id: user.id,
                    username: user.username,
                    name: displayName,
                    email: user.email || null,
                    nip: null,
                    bidang: null,
                    jabatan: null,
                    instansi: 'Nayaxa AI',
                    avatar: user.avatar || null,
                    role: user.role || 'Pengguna Terdaftar'
                }
            });
        } catch (err) {
            console.error('[nayaxaAuthController.login] Error:', err);
            return res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan saat memproses login. Silakan coba lagi.'
            });
        }
    },

    /**
     * Pendaftaran akun baru nayaxa.my.id (mandiri di nayaxa_users, tanpa kolom created_at)
     */
    register: async (req, res) => {
        try {
            const { username, email, password, name } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Username dan kata sandi wajib diisi.'
                });
            }

            const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
            const cleanName = (name && String(name).trim()) || cleanUsername;
            const cleanEmail = email ? String(email).trim().toLowerCase() : null;

            if (cleanUsername.length < 3) {
                return res.status(400).json({
                    success: false,
                    message: 'Username minimal terdiri dari 3 karakter.'
                });
            }

            if (password.length < 4) {
                return res.status(400).json({
                    success: false,
                    message: 'Kata sandi minimal 4 karakter.'
                });
            }

            // Cek apakah username sudah ada di nayaxa_users
            const [existUser] = await dbNayaxa.query('SELECT id FROM nayaxa_users WHERE username = ? LIMIT 1', [cleanUsername]);
            if (existUser.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Username sudah digunakan, silakan pilih username lain.'
                });
            }

            // Cek email jika diisi
            if (cleanEmail) {
                const [existEmail] = await dbNayaxa.query('SELECT id FROM nayaxa_users WHERE email = ? LIMIT 1', [cleanEmail]);
                if (existEmail.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: 'Email sudah terdaftar pada akun lain.'
                    });
                }
            }

            // Hash password dengan bcryptjs
            const hashedPassword = await bcrypt.hash(password, 10);

            // Simpan data akun ke tabel mandiri nayaxa_users (tanpa pencatatan created_at)
            const [userResult] = await dbNayaxa.query(`
                INSERT INTO nayaxa_users (username, name, email, password, role, is_active)
                VALUES (?, ?, ?, ?, 'Pengguna Terdaftar', 1)
            `, [cleanUsername, cleanName, cleanEmail, hashedPassword]);

            return res.status(201).json({
                success: true,
                message: 'Pendaftaran akun berhasil! Anda kini telah masuk.',
                user: {
                    id: userResult.insertId,
                    username: cleanUsername,
                    name: cleanName,
                    email: cleanEmail,
                    role: 'Pengguna Terdaftar',
                    avatar: null
                }
            });
        } catch (err) {
            console.error('[nayaxaAuthController.register] Error:', err);
            return res.status(500).json({
                success: false,
                message: 'Gagal mendaftarkan akun baru. Silakan coba beberapa saat lagi.'
            });
        }
    },

    /**
     * Ambil informasi akun saat ini dari nayaxa_users
     */
    getMe: async (req, res) => {
        try {
            const userId = req.query.user_id || req.body.user_id;
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID wajib disertakan.' });
            }

            const [rows] = await dbNayaxa.query(`
                SELECT 
                    id, username, name, email, avatar, role
                FROM nayaxa_users
                WHERE id = ? AND is_active = 1
                LIMIT 1
            `, [userId]);

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
            }

            const user = rows[0];
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name || user.username,
                    email: user.email || null,
                    nip: null,
                    bidang: null,
                    jabatan: null,
                    instansi: 'Nayaxa AI',
                    avatar: user.avatar || null,
                    role: user.role || 'Pengguna Terdaftar'
                }
            });
        } catch (err) {
            console.error('[nayaxaAuthController.getMe] Error:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
    }
};

module.exports = nayaxaAuthController;
