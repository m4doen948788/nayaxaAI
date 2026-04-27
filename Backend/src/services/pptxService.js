const PptxGenJS = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

/**
 * Nayaxa Presentation Engine (v4.5.4)
 * Generates professional, aesthetic PPTX files from structured AI data.
 */
class PptxService {
    constructor() {
        // Aesthetic Configuration (Modern 2026 - Minimalist & Neuro-Inclusive)
        this.colors = {
            INDIGO_GRADIENT_START: "4F46E5",
            INDIGO_GRADIENT_END: "3730A3",
            INDIGO_PRIMARY: "4F46E5",
            SLATE_DARK: "0F172A",
            SLATE_TEXT: "1E293B",
            SLATE_LIGHT: "64748B",
            WHITE: "FFFFFF",
            BG_SOFT: "F8FAFC",
            ACCENT_SOFT: "EEF2FF"
        };
    }

    /**
     * @param {Object} data { judul, konteks, slides: [{ title, points, layout_type, notes }] }
     */
    async generatePresentation(data) {
        let pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_16x9";
        pptx.author = "Nayaxa AI Document Workstation v4.5.4";
        pptx.subject = data.judul || "Paparan Strategis";

        // --- 1. SLIDE COVER (Modern Deep Gradient) ---
        let slideCover = pptx.addSlide();
        slideCover.background = { 
            type: "gradient", 
            colorSteps: [
                { color: this.colors.INDIGO_GRADIENT_START, offset: 0 },
                { color: this.colors.INDIGO_GRADIENT_END, offset: 100 }
            ]
        };
        
        slideCover.addShape(pptx.ShapeType.ellipse, {
            x: -2, y: -2, w: 6, h: 6,
            fill: { color: this.colors.WHITE, transparency: 90 }
        });

        slideCover.addText(data.judul?.toUpperCase() || "LAPORAN STRATEGIS", {
            x: "10%", y: "40%", w: "80%", h: 2,
            fontSize: 44, color: this.colors.WHITE,
            bold: true, align: "center", charSpacing: 2
        });

        slideCover.addText(data.konteks || "Nayaxa AI • Bapperida Kabupaten Bogor", {
            x: "10%", y: "60%", w: "80%", h: 0.5,
            fontSize: 16, color: this.colors.WHITE,
            align: "center", transparency: 20
        });

        slideCover.addShape(pptx.ShapeType.roundRect, {
            x: "43%", y: "85%", w: "14%", h: "4%",
            fill: { color: this.colors.WHITE, transparency: 85 },
            rectRadius: 0.5
        });
        slideCover.addText("NAYAXA V4.5.3 STABLE", {
            x: "43%", y: "85%", w: "14%", h: "4%",
            fontSize: 8, color: this.colors.WHITE, align: "center", bold: true
        });

        // --- 2. LOOP CONTENT SLIDES (Clean Whitespace) ---
        (data.slides || []).forEach((slideData, index) => {
            let slide = pptx.addSlide();
            slide.background = { color: this.colors.WHITE };

            slide.addShape(pptx.ShapeType.rect, {
                x: 0, y: 0, w: 0.1, h: "100%",
                fill: { color: this.colors.INDIGO_PRIMARY }
            });

            slide.addText(slideData.title?.toUpperCase() || `BAGIAN ${index + 1}`, {
                x: 0.5, y: 0.4, w: 9, h: 0.6,
                fontSize: 28, color: this.colors.SLATE_DARK,
                bold: true
            });
            
            slide.addShape(pptx.ShapeType.line, {
                x: 0.5, y: 1.0, w: 9, h: 0,
                line: { color: this.colors.ACCENT_SOFT, width: 1 }
            });

            this.renderSlideContent(slide, slideData);

            slide.addText(`Bapperida Kab. Bogor • 2024`, {
                x: 0.5, y: 5.2, w: 3, h: 0.2,
                fontSize: 8, color: this.colors.SLATE_LIGHT
            });
            
            slide.addShape(pptx.ShapeType.roundRect, {
                x: 9.3, y: 5.15, w: 0.4, h: 0.3,
                fill: { color: this.colors.ACCENT_SOFT }, rectRadius: 0.2
            });
            slide.addText(`${index + 1}`, {
                x: 9.3, y: 5.15, w: 0.4, h: 0.3,
                fontSize: 10, bold: true, color: this.colors.INDIGO_PRIMARY, align: "center"
            });

            if (slideData.notes) slide.addNotes(slideData.notes);
        });

        // --- 3. SAVE AND RETURN ---
        const safeTitle = (data.judul || "Paparan_Nayaxa")
            .replace(/[^a-z0-9]/gi, '_')
            .substring(0, 50);
        const fileName = `${safeTitle}.pptx`;
        const exportPath = path.join(__dirname, "../../uploads/exports", fileName);
        
        const dir = path.dirname(exportPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        await pptx.writeFile({ fileName: exportPath });
        
        // Return URL in system-standard /api/nayaxa/export/ format
        return {
            fileName,
            url: `/export/${fileName}`
        };
    }

    renderSlideContent(slide, slideData) {
        const layout = slideData.layout_type || "BULLETS";
        const points = Array.isArray(slideData.points) ? slideData.points : [];

        if (layout === "TWO_COLUMN") {
            const mid = Math.ceil(points.length / 2);
            const left = points.slice(0, mid);
            const right = points.slice(mid);

            slide.addText(left.map(p => `• ${p}`).join("\n\n"), {
                x: 0.5, y: 1.4, w: 4.3, h: 3.5,
                fontSize: 14, color: this.colors.SLATE_TEXT, valign: "top", lineSpacing: 25
            });
            slide.addText(right.map(p => `• ${p}`).join("\n\n"), {
                x: 5.2, y: 1.4, w: 4.3, h: 3.5,
                fontSize: 14, color: this.colors.SLATE_TEXT, valign: "top", lineSpacing: 25
            });
        } else {
            const textContent = points.map(p => `• ${p}`).join("\n\n");
            let fontSize = 18;
            if (textContent.length > 350) fontSize = 14;

            slide.addText(textContent, {
                x: 1.0, y: 1.5, w: 8, h: 3.4,
                fontSize: fontSize, color: this.colors.SLATE_TEXT,
                valign: "top", lineSpacing: 22
            });
        }
    }
}

module.exports = new PptxService();
