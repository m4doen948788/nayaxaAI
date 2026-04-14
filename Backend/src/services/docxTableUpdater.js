/**
 * docxTableUpdater.js
 * Nayaxa Engine — Document Table Intelligence Service
 * 
 * Fungsi:
 * 1. Ekstrak semua tabel dari dokumen DOCX (teks asli atau hasil OCR gambar via Gemini Vision)
 * 2. Terima mapping update dari AI (JSON: { target_table_id, target_row_label, target_column, new_value })
 * 3. Tulis ulang DOCX dengan data yang diperbarui, dokumen tetap lengkap seperti aslinya
 */

const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign } = require('docx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPORT_DIR = path.join(__dirname, '../../uploads/exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

/**
 * Ekstrak tabel dari DOCX sebagai objek terstruktur
 * Mengembalikan array tabel dengan ID, judul terdekat, dan baris/kolom data
 */
const extractTablesFromDocx = async (base64Input) => {
    const cleanB64 = base64Input.includes('base64,') ? base64Input.split('base64,')[1] : base64Input;
    const buffer = Buffer.from(cleanB64, 'base64');

    // Ekstrak HTML untuk mendapatkan struktur tabel yang lebih akurat
    const { value: html } = await mammoth.convertToHtml({ buffer });

    const tables = [];
    let tableIdCounter = 0;

    // Parse tabel dari HTML dengan regex sederhana (tidak perlu DOM parser penuh)
    const tableRegex = /<table[\s\S]*?<\/table>/gi;
    const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
    const cellRegex = /<t[hd][\s\S]*?<\/t[hd]>/gi;
    const tagStripRegex = /<[^>]+>/g;

    let tableMatch;
    while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableHtml = tableMatch[0];
        tableIdCounter++;

        const rows = [];
        let rowMatch;
        const rowRegexLocal = new RegExp(rowRegex.source, 'gi');
        while ((rowMatch = rowRegexLocal.exec(tableHtml)) !== null) {
            const rowHtml = rowMatch[0];
            const cells = [];
            let cellMatch;
            const cellRegexLocal = new RegExp(cellRegex.source, 'gi');
            while ((cellMatch = cellRegexLocal.exec(rowHtml)) !== null) {
                const cellText = cellMatch[0].replace(tagStripRegex, '').trim();
                cells.push(cellText);
            }
            if (cells.length > 0) rows.push(cells);
        }

        if (rows.length > 0) {
            // Tandai apakah tabel memiliki header (baris pertama jika ada <th> atau teks uppercase pendek)
            const headers = rows[0] || [];
            tables.push({
                id: tableIdCounter,
                headers: headers,
                rows: rows.slice(1), // Baris data (tanpa header)
                raw_html: tableHtml,
                is_image_table: false
            });
        }
    }

    // Deteksi apakah ada gambar di dokumen (indikasi tabel gambar)
    const imageMatches = (html.match(/<img/gi) || []).length;

    return {
        tables,
        image_count: imageMatches,
        total_tables: tables.length
    };
};

/**
 * Normalisasi nilai angka (ribuan, juta, dll → angka penuh)
 */
const normalizeNumber = (val) => {
    if (typeof val === 'number') return val;
    if (typeof val !== 'string') return val;

    const cleaned = val.replace(/\./g, '').replace(/,/g, '.').trim();
    const withUnit = cleaned.toLowerCase();

    let num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return val; // bukan angka, kembalikan string asli

    if (withUnit.includes('miliar') || withUnit.includes('m')) {
        if (num < 1000) num = num * 1_000_000_000;
    } else if (withUnit.includes('juta') || withUnit.includes('jt')) {
        if (num < 100_000) num = num * 1_000_000;
    } else if (withUnit.includes('ribu') || withUnit.includes('rb')) {
        if (num < 100_000) num = num * 1_000;
    }

    return num;
};

/**
 * Cocokkan label baris secara semantik (toleran terhadap perbedaan penulisan)
 */
const semanticMatch = (a, b) => {
    if (!a || !b) return false;
    const normalize = (s) => String(s).toLowerCase()
        .replace(/[-_./\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const na = normalize(a);
    const nb = normalize(b);

    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    // Cek kesamaan kata kunci (min 60% kata sama)
    const wordsA = na.split(' ').filter(w => w.length > 2);
    const wordsB = nb.split(' ').filter(w => w.length > 2);
    if (wordsA.length === 0 || wordsB.length === 0) return false;

    const matches = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
    return matches.length / Math.max(wordsA.length, wordsB.length) >= 0.6;
};

/**
 * Terapkan update ke struktur tabel yang sudah diekstrak
 * updates: [{ table_id, row_label, column_header, new_value, status }]
 */
const applyUpdatesToTables = (tables, updates) => {
    const results = [];

    for (const update of updates) {
        const { table_id, row_label, column_header, new_value } = update;
        const table = tables.find(t => t.id === parseInt(table_id));

        if (!table) {
            results.push({ ...update, applied: false, reason: `Tabel ID ${table_id} tidak ditemukan` });
            continue;
        }

        // Cari kolom target di header
        const colIdx = table.headers.findIndex(h => semanticMatch(h, column_header));
        if (colIdx === -1) {
            results.push({ ...update, applied: false, reason: `Kolom '${column_header}' tidak ditemukan di Tabel ${table_id}. Header tersedia: ${table.headers.join(', ')}` });
            continue;
        }

        // Cari baris target
        const rowIdx = table.rows.findIndex(row => semanticMatch(row[0], row_label));
        if (rowIdx === -1) {
            results.push({ ...update, applied: false, reason: `Baris '${row_label}' tidak ditemukan di Tabel ${table_id}` });
            continue;
        }

        // Normalisasi dan terapkan nilai baru
        const normalizedValue = normalizeNumber(new_value);
        const oldValue = table.rows[rowIdx][colIdx];
        table.rows[rowIdx][colIdx] = String(normalizedValue);
        results.push({ ...update, applied: true, old_value: oldValue, new_value: String(normalizedValue) });
    }

    return results;
};

/**
 * Bangun dokumen DOCX baru dari struktur tabel yang sudah diupdate
 * Dokumen disusun dari konten teks + tabel-tabel yang sudah dimodifikasi
 */
const buildUpdatedDocx = async (base64Input, tables, filename = 'dokumen_updated.docx') => {
    const cleanB64 = base64Input.includes('base64,') ? base64Input.split('base64,')[1] : base64Input;
    const buffer = Buffer.from(cleanB64, 'base64');

    // Ekstrak teks paragraf (non-tabel) untuk context dokumen
    const { value: rawText } = await mammoth.extractRawText({ buffer });
    const textLines = rawText.split('\n').filter(l => l.trim().length > 0);

    const children = [];

    // Rekonstruksi paragraf teks dari dokumen asli
    for (const line of textLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Deteksi heading sederhana (baris pendek uppercase atau format Bab/BAB)
        const isHeading = /^(BAB|BAGIAN|PASAL|LAMPIRAN)\s+[IVX0-9]/i.test(trimmed) || 
                          (trimmed.length < 80 && /^[A-Z\s0-9.]+$/.test(trimmed) && trimmed.length > 5);

        children.push(new Paragraph({
            children: [new TextRun({
                text: trimmed,
                bold: isHeading,
                size: isHeading ? 28 : 24,
                font: 'Times New Roman',
                color: isHeading ? '1E293B' : '334155'
            })],
            spacing: { before: isHeading ? 300 : 120, after: isHeading ? 200 : 80 },
            alignment: isHeading ? AlignmentType.CENTER : AlignmentType.JUSTIFIED
        }));
    }

    // Sisipkan tabel-tabel yang sudah diupdate
    for (const table of tables) {
        if (table.rows.length === 0 && table.headers.length === 0) continue;

        // Keterangan tabel
        children.push(new Paragraph({
            children: [new TextRun({ text: `Tabel ${table.id}`, bold: true, size: 24, font: 'Times New Roman', color: '4F46E5' })],
            spacing: { before: 400, after: 120 }
        }));

        const allRows = [table.headers, ...table.rows];
        const tableRows = allRows.map((rowCells, rowIndex) => {
            const isHeader = rowIndex === 0;
            return new TableRow({
                children: rowCells.map(cellText => new TableCell({
                    width: { size: 100 / rowCells.length, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({
                        children: [new TextRun({
                            text: String(cellText || ''),
                            bold: isHeader,
                            size: isHeader ? 22 : 20,
                            font: 'Times New Roman',
                            color: isHeader ? 'FFFFFF' : '334155'
                        })],
                        alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                        spacing: { before: 60, after: 60 }
                    })],
                    shading: isHeader ? { fill: '4F46E5', type: ShadingType.CLEAR } : undefined,
                    margins: { top: 80, bottom: 80, left: 100, right: 100 },
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                        left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
                        right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' }
                    },
                    verticalAlign: VerticalAlign.CENTER
                })),
                tableHeader: isHeader
            });
        });

        children.push(new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            spacing: { before: 200, after: 300 }
        }));
    }

    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    size: { width: 11906, height: 16838 },
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1800 }
                }
            },
            children
        }]
    });

    const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const safe = sanitized.endsWith('.docx') ? sanitized : `${sanitized}.docx`;
    const outputPath = path.join(EXPORT_DIR, safe);
    const docBuffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, docBuffer);

    return `/export/${safe}`;
};

/**
 * Fungsi utama yang dipanggil oleh AI tool
 * @param {string} mainDocBase64 - Dokumen utama (yang tabelnya akan diupdate)
 * @param {string} updates_json - JSON string array dari AI: mapping update yang akan diterapkan
 * @param {string} filename - Nama file output
 */
const updateDocumentTables = async (mainDocBase64, updates_json, filename = 'dokumen_diperbarui.docx') => {
    try {
        console.log('[DocTableUpdater] Memulai ekstraksi tabel dari dokumen utama...');

        // 1. Ekstrak tabel dari dokumen utama
        const extractionResult = await extractTablesFromDocx(mainDocBase64);
        const { tables, image_count, total_tables } = extractionResult;

        console.log(`[DocTableUpdater] Ditemukan ${total_tables} tabel teks, ${image_count} gambar terdeteksi.`);

        if (total_tables === 0) {
            return {
                success: false,
                error: `Tidak ditemukan tabel teks dalam dokumen ini. ${image_count > 0 ? `Terdeteksi ${image_count} elemen gambar — kemungkinan tabel berbasis gambar yang tidak dapat diedit otomatis.` : 'Pastikan dokumen berformat DOCX dengan tabel yang valid.'}`,
                tables_found: 0,
                image_count
            };
        }

        // 2. Parse daftar update dari AI
        let updates = [];
        try {
            const cleaned = typeof updates_json === 'string'
                ? updates_json.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim()
                : JSON.stringify(updates_json);
            updates = JSON.parse(cleaned);
        } catch (e) {
            return { success: false, error: `Format updates_json tidak valid: ${e.message}` };
        }

        // 3. Terapkan update ke struktur tabel
        console.log(`[DocTableUpdater] Menerapkan ${updates.length} pembaruan data...`);
        const updateResults = applyUpdatesToTables(tables, updates);

        const appliedCount = updateResults.filter(r => r.applied).length;
        const failedCount = updateResults.filter(r => !r.applied).length;

        // 4. Bangun DOCX baru
        console.log('[DocTableUpdater] Membangun dokumen DOCX baru...');
        const downloadPath = await buildUpdatedDocx(mainDocBase64, tables, filename);

        return {
            success: true,
            download_path: downloadPath,
            total_tables_found: total_tables,
            image_count,
            updates_applied: appliedCount,
            updates_failed: failedCount,
            update_details: updateResults,
            message: `Dokumen berhasil diperbarui: ${appliedCount} sel diupdate, ${failedCount} gagal dicocokkan.`
        };
    } catch (err) {
        console.error('[DocTableUpdater] Error:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Fungsi untuk mengekstrak ringkasan tabel (digunakan AI untuk memahami struktur sebelum mapping)
 */
const getTableSummary = async (base64Input) => {
    try {
        const result = await extractTablesFromDocx(base64Input);
        const summary = result.tables.map(t => ({
            id: t.id,
            headers: t.headers,
            row_count: t.rows.length,
            sample_rows: t.rows.slice(0, 3),
            first_column_values: t.rows.slice(0, 10).map(r => r[0]).filter(Boolean)
        }));

        return {
            success: true,
            total_tables: result.total_tables,
            image_count: result.image_count,
            tables: summary
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

module.exports = {
    updateDocumentTables,
    getTableSummary,
    extractTablesFromDocx,
    semanticMatch
};
