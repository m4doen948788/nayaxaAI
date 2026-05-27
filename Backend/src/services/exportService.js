const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, TableOfContents, StyleLevel, PageBreak, AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign } = require('docx');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '../../uploads/exports');

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

/**
 * Robust text sanitization to remove Markdown and HTML artifacts from documents
 */
const sanitizeText = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/<br\s*\/?>/gi, '\n') // Convert <br> to real newlines
        .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
        .replace(/\*\*/g, '') // Strip bold asterisks (Word handles bolding separately)
        .replace(/[`_~]/g, ''); // Strip other common MD markers
};

/**
 * Recursively clean all string values in an object/array
 */
const recursiveDataCleaner = (data) => {
    if (typeof data === 'string') return sanitizeText(data);
    if (Array.isArray(data)) return data.map(recursiveDataCleaner);
    if (data !== null && typeof data === 'object') {
        const cleaned = {};
        for (const key in data) {
            cleaned[key] = recursiveDataCleaner(data[key]);
        }
        return cleaned;
    }
    return data;
};

/**
 * Sanitize text to remove/replace emojis and characters unsupported by standard PDF fonts (Helvetica)
 * to prevent PDFKit from throwing a fatal character rendering error.
 */
const sanitizeForPDFKit = (text) => {
    if (!text || typeof text !== 'string') return text || '';
    return text
        // Replace common checkmarks and bullet symbols
        .replace(/[✓✔☑✅]/g, '[v] ')
        .replace(/[✗✘☒❎]/g, '[x] ')
        .replace(/[🚀📌⚡💡⭐]/g, '* ')
        .replace(/[➡➢➤➔]/g, '-> ')
        // Remove standard emojis and other non-BMP symbols (surrogate pairs)
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
        // Remove any other character outside the standard CP1252 (Helvetica supported) range
        .replace(/[^\x00-\x7F\x80-\xFF]/g, '');
};

const exportService = {
    generateExcel: async (data, filename = 'export.xlsx') => {
        console.log(`[EXPORT:EXCEL] Generating ${filename}. Content elements: ${Array.isArray(data) ? data.length : 'N/A'}`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Nayaxa Export');
        if (typeof data === 'string') {
            const cleanData = data.replace(/^```(json|csv|tsv|text)?\n?/, '').replace(/\n?```$/, '').trim();
            try {
                data = JSON.parse(cleanData);
            } catch (e) {
                console.error("Excel Data Parse Error: JSON parsing failed, attempting CSV fallback...", e);
                
                // RESILIENT FALLBACK: Try to parse it as CSV/TSV
                if (cleanData.includes('\n')) {
                    const lines = cleanData.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    if (lines.length > 1) {
                        // Detect delimiter: comma, semicolon, or tab
                        let delimiter = ',';
                        const firstLine = lines[0];
                        if (firstLine.includes('\t')) delimiter = '\t';
                        else if (firstLine.includes(';')) delimiter = ';';
                        
                        // Split line helper handling quotes
                        const splitCSVLine = (line, sep) => {
                            const result = [];
                            let current = '';
                            let inQuotes = false;
                            for (let idx = 0; idx < line.length; idx++) {
                                const char = line[idx];
                                if (char === '"') {
                                    inQuotes = !inQuotes;
                                } else if (char === sep && !inQuotes) {
                                    result.push(current.trim());
                                    current = '';
                                } else {
                                    current += char;
                                }
                            }
                            result.push(current.trim());
                            return result.map(v => v.replace(/^["']|["']$/g, '').trim());
                        };

                        // Parse header
                        const headers = splitCSVLine(lines[0], delimiter);
                        const parsedData = [];
                        
                        for (let k = 1; k < lines.length; k++) {
                            const cells = splitCSVLine(lines[k], delimiter);
                            const obj = {};
                            headers.forEach((header, idx) => {
                                if (header) {
                                    obj[header] = cells[idx] !== undefined ? cells[idx] : '';
                                }
                            });
                            parsedData.push(obj);
                        }
                        
                        if (parsedData.length > 0) {
                            data = parsedData;
                            console.log(`[EXPORT:EXCEL:FALLBACK] CSV parsed successfully into ${data.length} elements!`);
                        } else {
                            throw new Error("Format data untuk Excel tidak valid. Pastikan data berupa JSON Array.");
                        }
                    } else {
                        throw new Error("Format data untuk Excel tidak valid. Pastikan data berupa JSON Array.");
                    }
                } else {
                    throw new Error("Format data untuk Excel tidak valid. Pastikan data berupa JSON Array.");
                }
            }
        }
        
        if (Array.isArray(data) && data.length > 0) {
            const cleanedData = recursiveDataCleaner(data);
            const columns = Object.keys(cleanedData[0]).map(key => ({ header: key.toUpperCase(), key, width: 20 }));
            worksheet.columns = columns;
            worksheet.addRows(cleanedData);
        }
        // Sanitize filename for URL and filesystem safety
        const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const safe = sanitized.endsWith('.xlsx') ? sanitized : `${sanitized}.xlsx`;
        const p = path.join(EXPORT_DIR, safe);
        await workbook.xlsx.writeFile(p);
        return `/export/${safe}`;
    },

    generatePDF: async (content, filename = 'laporan.pdf') => {
        console.log(`[EXPORT:PDF] Generating ${filename}. Content length: ${content?.length || 0}`);
        return new Promise((resolve, reject) => {
            if (!content || !content.trim()) {
                content = "Tidak ada konten yang diberikan untuk laporan ini. Silakan berikan instruksi lebih detail kepada Nayaxa.";
            }
            const doc = new PDFDocument({ margin: 50, bufferPages: true });
            doc.on('error', (err) => {
                console.error('[PDF:CRITICAL] Document Error:', err);
                reject(err);
            });
            // Sanitize filename
            const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
            const safe = sanitized.endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
            const p = path.join(EXPORT_DIR, safe);
            const s = fs.createWriteStream(p);
            
            s.on('error', (err) => {
                console.error('[PDF:STREAM] Write Stream Error:', err);
                reject(err);
            });

            doc.pipe(s);
            
            // Start writing from the top margin
            doc.x = 50;
            doc.y = 50;

            // Content (Smart PDFKit Parser)
            let cleanRaw = content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
            // Collapse 3 or more consecutive newlines into exactly 2 (which equals 1 empty line spacing) and trim trailing spaces
            cleanRaw = cleanRaw.replace(/\n{3,}/g, '\n\n').trim();
            const lines = cleanRaw.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line) { 
                    doc.moveDown(0.5); 
                    continue; 
                }

                // Strip bold markers for PDF (PDFKit doesn't support easy inline bold)
                let cleanLine = line.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '');

                // Sanitize for PDFKit to prevent character encoding/font crashes
                cleanLine = sanitizeForPDFKit(cleanLine);
                if (!cleanLine.trim()) continue;

                // Smart Heading Detection
                if (cleanLine.startsWith('# ')) {
                    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1E293B').text(cleanLine.replace(/^# /, ''), { align: 'left' });
                    doc.moveDown(0.3);
                } else if (cleanLine.startsWith('## ')) {
                    doc.font('Helvetica-Bold').fontSize(14).fillColor('#4F46E5').text(cleanLine.replace(/^## /, ''), { align: 'left' });
                    doc.moveDown(0.3);
                } else if (cleanLine.startsWith('### ')) {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor('#334155').text(cleanLine.replace(/^### /, ''), { align: 'left' });
                    doc.moveDown(0.3);
                } else if (/^[0-9]+\.\s+[A-Z\s]+$/.test(cleanLine)) { 
                    // Matches "1. DATA PENYEBAB" (Numbered + ALL CAPS)
                    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1E293B').text(cleanLine, { align: 'left' });
                    doc.moveDown(0.3);
                } else if (/^[A-Z]\.\s+[A-Z\s]+$/.test(cleanLine)) {
                    // Matches "A. PENDAHULUAN"
                    doc.font('Helvetica-Bold').fontSize(14).fillColor('#4F46E5').text(cleanLine, { align: 'left' });
                    doc.moveDown(0.3);
                } else if (/^[-*]\s/.test(cleanLine)) {
                    doc.font('Helvetica').fontSize(11).fillColor('#334155').text('•  ' + cleanLine.replace(/^[-*]\s/, ''), { align: 'justify', indent: 20, lineGap: 2 });
                } else if (/^[0-9]+\.\s/.test(cleanLine)) {
                    doc.font('Helvetica').fontSize(11).fillColor('#334155').text(cleanLine, { align: 'justify', indent: 20, lineGap: 2 });
                } else if (cleanLine.startsWith('|')) {
                    doc.font('Courier').fontSize(9).fillColor('#475569').text(cleanLine, { align: 'left', indent: 10 });
                } else {
                    doc.font('Helvetica').fontSize(11).fillColor('#334155').text(cleanLine, { align: 'justify', lineGap: 4 });
                }
            }
            
            // Footer
            const range = doc.bufferedPageRange(); 
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(8).fillColor('#94a3b8').text(
                    `Halaman ${i + 1} dari ${range.count}`,
                    50,
                    doc.page.height - 50,
                    { align: 'center' }
                );
            }

            doc.end();
            s.on('finish', () => resolve(`/export/${safe}`));
            s.on('error', reject);
        });
    },

    generateWord: async (content, filename = 'dokumen.docx', options = {}) => {
        console.log(`[EXPORT:WORD] Generating ${filename}. Content length: ${content?.length || 0}, options:`, options);
        if (!content || !content.trim()) {
            content = "Dokumen ini kosong karena tidak ada teks yang dikirimkan.";
        }

        const { font = "Arial", fontSize = 12, lineSpacing = 1.0, paperSize = "A4", includeTOC = false } = options;
        
        // Font size in docx is in half-points (12pt = 24)
        const docxFontSize = fontSize * 2;
        
        // Line spacing in twips (240 = 1 line, 360 = 1.5 lines)
        const docxLineSpacing = Math.round(lineSpacing * 240);

        let listCounter = 0;
        let inNumberedList = false;
        const lines = content.split('\n');
        const children = []; // Removed hardcoded branding title

        // Add Table of Contents if requested
        if (includeTOC) {
            children.push(
                new Paragraph({
                    text: "DAFTAR ISI",
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                }),
                new TableOfContents("Daftar Isi", {
                    hyperlinked: true,
                    stylesWithLevels: [
                        new StyleLevel(HeadingLevel.HEADING_1, 1),
                        new StyleLevel(HeadingLevel.HEADING_2, 2),
                        new StyleLevel(HeadingLevel.HEADING_3, 3),
                    ],
                }),
                new Paragraph({ children: [new PageBreak()] })
            );
        }
        
        const processTextRuns = (text, isHeader = false, customSize = docxFontSize) => {
            const parts = text.split(/\*\*/g);
            return parts.map((part, index) => {
                return new TextRun({ 
                    text: sanitizeText(part), 
                    bold: (index % 2 !== 0) || isHeader,
                    size: customSize,
                    font: font,
                    color: isHeader ? "FFFFFF" : "334155"
                });
            });
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
                children.push(new Paragraph({ text: "", spacing: { line: docxLineSpacing } }));
                continue;
            }
            
            // 1. Smart Heading Detection
            let currentHeadingLevel = null;
            let cleanHeadingText = line;

            if (line.startsWith('# ')) {
                currentHeadingLevel = HeadingLevel.HEADING_1;
                cleanHeadingText = line.replace(/^# /, '');
            } else if (line.startsWith('## ')) {
                currentHeadingLevel = HeadingLevel.HEADING_2;
                cleanHeadingText = line.replace(/^## /, '');
            } else if (line.startsWith('### ')) {
                currentHeadingLevel = HeadingLevel.HEADING_3;
                cleanHeadingText = line.replace(/^### /, '');
            } else if (/^[0-9]+\.\s+[A-Z\s]+$/.test(line)) { 
                currentHeadingLevel = HeadingLevel.HEADING_1;
            } else if (/^[A-Z]\.\s+[A-Z\s]+$/.test(line)) {
                currentHeadingLevel = HeadingLevel.HEADING_2;
            }

            if (currentHeadingLevel) {
                children.push(new Paragraph({ 
                    text: sanitizeText(cleanHeadingText), 
                    heading: currentHeadingLevel,
                    spacing: { before: 240, after: 120 }
                }));
                continue;
            }

            // 2. Markdown Table Detection
            if (line.startsWith('|') && lines[i+1]?.trim().startsWith('|') && lines[i+1]?.includes('---')) {
                const tableRows = [];
                let j = i;
                
                while (j < lines.length && lines[j].trim().startsWith('|')) {
                    const rowText = lines[j].trim();
                    if (!rowText.includes('---')) {
                        const cells = rowText.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                        const isHeader = tableRows.length === 0;
                        
                        tableRows.push(new TableRow({
                            children: cells.map(cell => new TableCell({
                                width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
                                children: [new Paragraph({ 
                                    children: processTextRuns(cell.trim(), isHeader, isHeader ? docxFontSize : docxFontSize - 2),
                                    alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                                    spacing: { before: 40, after: 40 }
                                })],
                                shading: isHeader ? { fill: "4F46E5", type: ShadingType.CLEAR } : undefined,
                                verticalAlign: VerticalAlign.CENTER,
                                margins: { top: 120, bottom: 120, left: 120, right: 120 },
                                borders: {
                                    top: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                                    left: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                                    right: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
                                }
                            })),
                            tableHeader: isHeader
                        }));
                    }
                    j++;
                }
                
                children.push(new Table({
                    rows: tableRows,
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    alignment: AlignmentType.CENTER,
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 2, color: "4F46E5" },
                        bottom: { style: BorderStyle.SINGLE, size: 2, color: "4F46E5" },
                        left: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                        right: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                    },
                    spacing: { before: 300, after: 300 }
                }));
                
                i = j - 1;
                continue;
            }

            // 3. List Item & Normal Text Detection
            if (/^[-*]\s/.test(line)) {
                const cleanItem = line.replace(/^[-*]\s/, '');
                children.push(new Paragraph({
                    children: processTextRuns(cleanItem),
                    bullet: { level: 0 },
                    spacing: { line: docxLineSpacing, before: 60, after: 60 },
                    alignment: AlignmentType.JUSTIFIED
                }));
            } else if (/^[0-9]+\.\s/.test(line)) {
                // Preserve original numbers with hanging indent for robust formatting
                children.push(new Paragraph({
                    children: processTextRuns(line),
                    indent: { left: 360, hanging: 360 },
                    spacing: { line: docxLineSpacing, before: 60, after: 60 },
                    alignment: AlignmentType.JUSTIFIED
                }));
            } else {
                children.push(new Paragraph({
                    children: processTextRuns(line),
                    spacing: { line: docxLineSpacing, before: 80, after: 80 },
                    alignment: AlignmentType.JUSTIFIED
                }));
            }
        }

        const docOptions = {
            styles: {
                default: {
                    document: {
                        run: { font: font, size: docxFontSize, color: "334155" },
                        paragraph: { 
                            alignment: AlignmentType.JUSTIFIED,
                            spacing: { line: docxLineSpacing, before: 120, after: 120 }
                        },
                    },
                    heading1: {
                        run: { font: font, size: docxFontSize + 8, bold: true, color: "1E293B" },
                        paragraph: { 
                            alignment: AlignmentType.LEFT, 
                            spacing: { before: 400, after: 200 }
                        },
                    },
                    heading2: {
                        run: { font: font, size: docxFontSize + 4, bold: true, color: "4F46E5" },
                        paragraph: { 
                            alignment: AlignmentType.LEFT,
                            spacing: { before: 300, after: 150 } 
                        },
                    },
                    heading3: {
                        run: { font: font, size: docxFontSize + 2, bold: true, color: "334155" },
                        paragraph: { 
                            alignment: AlignmentType.LEFT,
                            spacing: { before: 200, after: 100 } 
                        },
                    },
                },
            },
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: paperSize === "A4" ? 11906 : 12240,
                            height: paperSize === "A4" ? 16838 : 15840,
                        },
                        margin: {
                            top: 1440,
                            right: 1440,
                            bottom: 1440,
                            left: 1440,
                        }
                    }
                },
                children: children
            }]
        };

        const doc = new Document(docOptions);
        const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const safe = sanitized.endsWith('.docx') ? sanitized : `${sanitized}.docx`;
        const p = path.join(EXPORT_DIR, safe);
        const b = await Packer.toBuffer(doc);
        fs.writeFileSync(p, b);
        return `/export/${safe}`;
    },

    fillExcelTemplate: async (base64Input, filledData, filename = 'filled_template.xlsx') => {
        try {
            const cleanB64 = base64Input.includes('base64,') ? base64Input.split('base64,')[1] : base64Input;
            const buffer = Buffer.from(cleanB64, 'base64');
            
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0]; // Assume first sheet
            
            if (typeof filledData === 'string') {
                const cleanData = filledData.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
                filledData = JSON.parse(cleanData);
            }

            if (Array.isArray(filledData)) {
                // 1. Identify Headers and their column indices
                let headerRow = null;
                const headerMap = {}; // name -> colNumber
                
                worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                    // Try to find a row that looks like a header (contains 'uraian' or 'rekomendasi' etc)
                    const rowValues = [];
                    row.eachCell(c => rowValues.push(String(c.value || '').toLowerCase()));
                    
                    if (rowValues.includes('uraian') || rowValues.includes('keterangan') || rowValues.includes('item')) {
                        if (!headerRow) {
                            headerRow = row;
                            row.eachCell((cell, colNumber) => {
                                if (cell.value) headerMap[String(cell.value).toLowerCase().trim()] = colNumber;
                            });
                        }
                    }
                });

                // If no clear header found, use the very first row with data as headerMap source
                if (!headerRow) {
                    const firstRow = worksheet.getRow(1);
                    firstRow.eachCell((cell, colNumber) => {
                        if (cell.value) headerMap[String(cell.value).toLowerCase().trim()] = colNumber;
                    });
                }

                // 2. Process each item in filledData
                const cleanedFilledData = recursiveDataCleaner(filledData);
                cleanedFilledData.forEach(item => {
                    let found = false;
                    const itemKeys = Object.keys(item);
                    const lookupKey = itemKeys.find(k => k.toLowerCase() === 'uraian' || k.toLowerCase() === 'label' || k.toLowerCase() === 'item');
                    const lookupValue = lookupKey ? String(item[lookupKey]).toLowerCase().trim() : null;

                    if (lookupValue) {
                        // Search in all rows for the lookupValue
                        worksheet.eachRow((row, rowNumber) => {
                            if (found) return;
                            let match = false;
                            row.eachCell(cell => {
                                if (String(cell.value || '').toLowerCase().trim().includes(lookupValue)) {
                                    match = true;
                                }
                            });

                            if (match) {
                                // Update this row
                                itemKeys.forEach(k => {
                                    if (k === lookupKey) return; // Don't overwrite the lookup key itself
                                    const colIdx = headerMap[k.toLowerCase().trim()];
                                    if (colIdx) {
                                        row.getCell(colIdx).value = item[k];
                                    }
                                });
                                row.commit();
                                found = true;
                            }
                        });
                    }

                    // 3. Fallback: If not found or no lookup key, append to end
                    if (!found) {
                        const lastRow = worksheet.lastRow ? worksheet.lastRow.number : 1;
                        const newRow = worksheet.getRow(lastRow + 1);
                        itemKeys.forEach(k => {
                            const colIdx = headerMap[k.toLowerCase().trim()];
                            if (colIdx) {
                                newRow.getCell(colIdx).value = item[k];
                            } else {
                                // If column not in header map, just append to first empty columns
                                newRow.values = Object.values(item);
                            }
                        });
                        newRow.commit();
                    }
                });
            }

            const sanitized = filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
            const safe = sanitized.endsWith('.xlsx') ? sanitized : `${sanitized}.xlsx`;
            const p = path.join(EXPORT_DIR, safe);
            await workbook.xlsx.writeFile(p);
            return `/export/${safe}`;
        } catch (err) {
            console.error("Excel Fill Template Error:", err);
            throw new Error(`Gagal mengisi template Excel: ${err.message}`);
        }
    }
};

module.exports = exportService;
