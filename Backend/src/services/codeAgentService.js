/**
 * codeAgentService.js
 * Safe File System Bridge for Nayaxa Coding Agent.
 * Only available in Standalone Mode (never in the widget dashboard).
 */

const fs = require('fs');
const path = require('path');

// --- SECURITY CONFIG ---
// List of absolute paths that Nayaxa is allowed to read/write.
// Edit this list to add your project roots.
const ALLOWED_ROOTS = [
    path.resolve('D:\\nayaxa-engine'),
    path.resolve('D:\\copy-dashboard'),
];

// Files and directories that are ALWAYS forbidden, even inside allowed roots.
const BLOCKED_PATTERNS = [
    /\.env$/i,
    /node_modules/,
    /\.git\//,
    /\.gitignore$/i,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /\.pem$/i,
    /\.key$/i,
    /secret/i,
];

const MAX_FILE_SIZE_BYTES = 150 * 1024; // 150 KB max read size

/**
 * Validates that the target path is within an allowed root and not blocked.
 */
const validatePath = (targetPath) => {
    const resolved = path.resolve(targetPath);

    const isAllowed = ALLOWED_ROOTS.some(root => resolved.startsWith(root));
    if (!isAllowed) {
        return { ok: false, reason: `Akses ke path '${resolved}' tidak diizinkan. Hanya direktori proyek yang diizinkan.` };
    }

    const isBlocked = BLOCKED_PATTERNS.some(pattern => pattern.test(resolved));
    if (isBlocked) {
        return { ok: false, reason: `File '${path.basename(resolved)}' adalah file sensitif yang tidak bisa diakses.` };
    }

    return { ok: true, resolved };
};

const codeAgentService = {
    /**
     * List the contents of a directory.
     * @param {string} dirPath - Absolute or relative path.
     * @param {number} depth - How many levels deep to recurse (max 3).
     */
    listFiles: (dirPath, depth = 1) => {
        const validation = validatePath(dirPath);
        if (!validation.ok) return { error: validation.reason };

        const { resolved } = validation;

        try {
            if (!fs.existsSync(resolved)) return { error: `Direktori tidak ditemukan: ${resolved}` };

            const stat = fs.statSync(resolved);
            if (!stat.isDirectory()) return { error: `Path ini bukan direktori: ${resolved}` };

            const entries = fs.readdirSync(resolved, { withFileTypes: true });
            const result = [];

            for (const entry of entries) {
                // Skip node_modules and .git at any depth
                if (entry.name === 'node_modules' || entry.name === '.git') continue;

                const entryPath = path.join(resolved, entry.name);
                const item = {
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    path: entryPath,
                };

                if (entry.isDirectory() && depth > 1) {
                    const sub = codeAgentService.listFiles(entryPath, depth - 1);
                    item.children = sub.children || [];
                }

                result.push(item);
            }

            return { path: resolved, children: result };
        } catch (err) {
            return { error: `Gagal membaca direktori: ${err.message}` };
        }
    },

    /**
     * Read the content of a code file.
     * @param {string} filePath - Absolute or relative path.
     */
    readFile: (filePath) => {
        const validation = validatePath(filePath);
        if (!validation.ok) return { error: validation.reason };

        const { resolved } = validation;

        try {
            if (!fs.existsSync(resolved)) return { error: `File tidak ditemukan: ${resolved}` };

            const stat = fs.statSync(resolved);
            if (stat.isDirectory()) return { error: `Path ini adalah direktori, bukan file: ${resolved}` };

            if (stat.size > MAX_FILE_SIZE_BYTES) {
                return { 
                    error: `File terlalu besar (${(stat.size / 1024).toFixed(1)} KB). Maksimum yang bisa dibaca adalah ${MAX_FILE_SIZE_BYTES / 1024} KB.`,
                    size: stat.size
                };
            }

            const content = fs.readFileSync(resolved, 'utf-8');
            const lines = content.split('\n').length;

            return { 
                path: resolved, 
                content, 
                lines,
                size_kb: (stat.size / 1024).toFixed(1)
            };
        } catch (err) {
            return { error: `Gagal membaca file: ${err.message}` };
        }
    },

    /**
     * Write (create or update) a code file.
     * @param {string} filePath - Absolute or relative path.
     * @param {string} content - File content to write.
     */
    writeFile: (filePath, content) => {
        const validation = validatePath(filePath);
        if (!validation.ok) return { error: validation.reason };

        const { resolved } = validation;

        try {
            // Ensure parent directory exists
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create backup of existing file before overwriting
            if (fs.existsSync(resolved)) {
                const backupPath = `${resolved}.nayaxa_backup_${Date.now()}`;
                fs.copyFileSync(resolved, backupPath);
                console.log(`[CodeAgent] Backup created: ${backupPath}`);
            }

            fs.writeFileSync(resolved, content, 'utf-8');

            return { 
                success: true, 
                path: resolved, 
                message: `File berhasil ditulis: ${path.basename(resolved)}` 
            };
        } catch (err) {
            return { error: `Gagal menulis file: ${err.message}` };
        }
    },

    /**
     * Search for text within files in a directory.
     * @param {string} dirPath - Directory to search in.
     * @param {string} query - Text to search for.
     */
    searchInFiles: (dirPath, query) => {
        const validation = validatePath(dirPath);
        if (!validation.ok) return { error: validation.reason };

        const { resolved } = validation;
        const results = [];
        const searchableExts = ['.js', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.md'];

        const searchDir = (dir, currentDepth = 0) => {
            if (currentDepth > 4) return;
            if (!fs.existsSync(dir)) return;

            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;

                const entryPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    searchDir(entryPath, currentDepth + 1);
                } else {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (!searchableExts.includes(ext)) continue;

                    try {
                        const content = fs.readFileSync(entryPath, 'utf-8');
                        const lowerContent = content.toLowerCase();
                        const lowerQuery = query.toLowerCase();
                        
                        if (lowerContent.includes(lowerQuery)) {
                            const lines = content.split('\n');
                            const matchedLines = lines
                                .map((line, i) => ({ line: i + 1, text: line }))
                                .filter(l => l.text.toLowerCase().includes(lowerQuery))
                                .slice(0, 5); // Max 5 matching lines per file

                            results.push({
                                file: entryPath,
                                matches: matchedLines.length,
                                preview: matchedLines
                            });
                        }
                    } catch (e) { /* skip unreadable files */ }
                }

                if (results.length >= 20) return; // Cap at 20 results
            }
        };

        searchDir(resolved);
        return { query, total_files: results.length, results };
    },
    /**
     * Get a fast, shallow overview of the project structure (depth 2).
     * Used to bootstrap the AI's knowledge of the codebase instantly.
     */
    getProjectBlueprint: () => {
        const results = [];
        ALLOWED_ROOTS.forEach(root => {
            if (!fs.existsSync(root)) return;
            const blueprint = { root: path.basename(root), structure: [] };
            
            // Shallow scan of root
            const entries = fs.readdirSync(root, { withFileTypes: true });
            entries.forEach(entry => {
                if (entry.name === 'node_modules' || entry.name === '.git') return;
                
                const fullPath = path.join(root, entry.name);
                if (entry.isDirectory()) {
                    // One level deeper for directories
                    try {
                        const subs = fs.readdirSync(fullPath, { withFileTypes: true })
                            .filter(sub => !sub.name.startsWith('.') && sub.name !== 'node_modules')
                            .slice(0, 10) // Cap sub-items to keep prompt short
                            .map(sub => sub.name + (sub.isDirectory() ? '/' : ''));
                        
                        blueprint.structure.push(`${entry.name}/ (${subs.join(', ')}${subs.length === 10 ? '...' : ''})`);
                    } catch (e) {
                        blueprint.structure.push(`${entry.name}/`);
                    }
                } else {
                    blueprint.structure.push(entry.name);
                }
            });
            results.push(blueprint);
        });
        return results;
    }
};

module.exports = codeAgentService;
