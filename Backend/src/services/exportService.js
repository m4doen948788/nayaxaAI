const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, TableOfContents, StyleLevel, PageBreak, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '../../uploads/exports');

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const exportService = {
    generateExcel: async (data, filename = 'export.xlsx') => {
        console.log(`[EXPORT:EXCEL] Generating ${filename}. Content elements: ${Array.isArray(data) ? data.length : 'N/A'}`);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Nayaxa Export');
        if (typeof data === 'string') {
            try {
                // Strip markdown code blocks if any
                const cleanData = data.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
                data = JSON.parse(cleanData);
            } catch (e) {
                console.error("Excel Data Parse Error:", e);
                throw new Error("Format data untuk Excel tidak valid. Pastikan data berupa JSON Array.");
            }
        }
        
        if (Array.isArray(data) && data.length > 0) {
            const columns = Object.keys(data[0]).map(key => ({ header: key.toUpperCase(), key, width: 20 }));
            worksheet.columns = columns;
            worksheet.addRows(data);
        }
        const safe = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
        const p = path.join(EXPORT_DIR, safe);
        await workbook.xlsx.writeFile(p);
        return `/api/nayaxa/export/${safe}`;
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
            const safe = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
            const p = path.join(EXPORT_DIR, safe);
            const s = fs.createWriteStream(p);
            
            s.on('error', (err) => {
                console.error('[PDF:STREAM] Write Stream Error:', err);
                reject(err);
            });

            doc.pipe(s);
            
            // Header
            doc.fontSize(20).fillColor('#4f46e5').text('NAYAXA AI - STRATEGY REPORT', { align: 'center' });
            doc.fontSize(10).fillColor('#64748b').text(`Dibuat pada: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
            doc.moveDown(2);
            
            // Content
            const cleanContent = String(content || '')
                .replace(/\*\*/g, '') // Remove bold asterisks
                .replace(/^#+\s/gm, '') // Remove header hashes at start of line
                .replace(/\n#+\s/g, '\n'); // Remove header hashes after newline
            
            doc.fontSize(12).fillColor('#1e293b').text(cleanContent, {
                align: 'justify',
                indent: 20,
                lineGap: 5
            });
            
            // Footer
            const range = doc.bufferedPageRange(); 
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(8).fillColor('#94a3b8').text(
                    `Nayaxa AI Engine v1.0 - Halaman ${i + 1}`,
                    50, 
                    doc.page.height - 50,
                    { align: 'center', lineBreak: false }
                );
            }

            doc.end();
            s.on('finish', () => resolve(`/api/nayaxa/export/${safe}`));
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

        const lines = content.split('\n');
        const children = [
            new Paragraph({ 
                text: "Laporan Nayaxa AI", 
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            }),
            new Paragraph({ text: "" }) // spacing after title
        ];

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
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
                children.push(new Paragraph({ text: "", spacing: { line: docxLineSpacing } }));
                continue;
            }
            
            let isHeading = false;
            if (line.startsWith('# ')) {
                children.push(new Paragraph({ 
                    text: line.replace(/^# /, ''), 
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 200, after: 120 }
                }));
                isHeading = true;
            } else if (line.startsWith('## ')) {
                children.push(new Paragraph({ 
                    text: line.replace(/^## /, ''), 
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 180, after: 100 }
                }));
                isHeading = true;
            } else if (line.startsWith('### ')) {
                children.push(new Paragraph({ 
                    text: line.replace(/^### /, ''), 
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 150, after: 80 }
                }));
                isHeading = true;
            }
            if (isHeading) continue;
            
            let isBullet = false;
            let bulletText = line;
            if (/^(-|\*)\s/.test(line)) {
                isBullet = true;
                bulletText = line.replace(/^(-|\*)\s/, '');
            }
            
            const parts = bulletText.split(/\*\*/g);
            const textRuns = parts.map((part, index) => {
                return new TextRun({ 
                    text: part, 
                    bold: index % 2 !== 0,
                    size: docxFontSize,
                    font: font
                });
            });
            
            if (isBullet) {
                children.push(new Paragraph({
                    children: textRuns,
                    bullet: { level: 0 },
                    spacing: { line: docxLineSpacing, before: 100 },
                    alignment: AlignmentType.JUSTIFY
                }));
            } else {
                children.push(new Paragraph({
                    children: textRuns,
                    spacing: { line: docxLineSpacing, before: 80 },
                    alignment: AlignmentType.JUSTIFY
                }));
            }
        }

        const doc = new Document({
            styles: {
                default: {
                    heading1: {
                        run: { font: font, size: docxFontSize + 4, bold: true, color: "000000" },
                        paragraph: { spacing: { before: 240, after: 120 } },
                    },
                    heading2: {
                        run: { font: font, size: docxFontSize + 2, bold: true, color: "2E74B5" },
                        paragraph: { spacing: { before: 200, after: 100 } },
                    },
                    heading3: {
                        run: { font: font, size: docxFontSize, bold: true, color: "1F4D78" },
                        paragraph: { spacing: { before: 180, after: 80 } },
                    },
                },
            },
            sections: [{
                properties: {
                    type: "nextPage",
                    page: {
                        size: {
                            width: paperSize === "A4" ? 11906 : 12240, // A4 vs Letter width in twips
                            height: paperSize === "A4" ? 16838 : 15840,
                        },
                        margin: {
                            top: 1440, // 1 inch
                            right: 1440,
                            bottom: 1440,
                            left: 1440,
                        }
                    }
                },
                children: children
            }]
        });
        const safe = filename.endsWith('.docx') ? filename : `${filename}.docx`;
        const p = path.join(EXPORT_DIR, safe);
        const b = await Packer.toBuffer(doc);
        fs.writeFileSync(p, b);
        return `/api/nayaxa/export/${safe}`;
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
                filledData.forEach(item => {
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

            const safe = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
            const p = path.join(EXPORT_DIR, safe);
            await workbook.xlsx.writeFile(p);
            return `/api/nayaxa/export/${safe}`;
        } catch (err) {
            console.error("Excel Fill Template Error:", err);
            throw new Error(`Gagal mengisi template Excel: ${err.message}`);
        }
    }
};

module.exports = exportService;
