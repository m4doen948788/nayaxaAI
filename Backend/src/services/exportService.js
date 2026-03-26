const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '../../uploads/exports');

if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const exportService = {
    generateExcel: async (data, filename = 'export.xlsx') => {
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
        return `/uploads/exports/${safe}`;
    },

    generatePDF: async (content, filename = 'laporan.pdf') => {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const safe = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
            const p = path.join(EXPORT_DIR, safe);
            const s = fs.createWriteStream(p);
            doc.pipe(s);
            doc.fontSize(18).text('Nayaxa Report', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(content);
            doc.end();
            s.on('finish', () => resolve(`/uploads/exports/${safe}`));
            s.on('error', reject);
        });
    },

    generateWord: async (content, filename = 'dokumen.docx') => {
        const doc = new Document({
            sections: [{
                children: [
                    new Paragraph({ text: "Nayaxa Analysis Report", heading: HeadingLevel.HEADING_1 }),
                    new Paragraph({ text: content })
                ]
            }]
        });
        const safe = filename.endsWith('.docx') ? filename : `${filename}.docx`;
        const p = path.join(EXPORT_DIR, safe);
        const b = await Packer.toBuffer(doc);
        fs.writeFileSync(p, b);
        return `/uploads/exports/${safe}`;
    }
};

module.exports = exportService;
