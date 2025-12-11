// src/controllers/pdfController.js
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { SignatureAudit } from "../models/Audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfDirectory = path.join(__dirname, "..", "uploads", "original");
const signedDirectory = path.join(__dirname, "..", "uploads", "signed");

const getSha256 = buffer => crypto.createHash("sha256").update(buffer).digest("hex");

const MAX_SIG_BYTES = 2 * 1024 * 1024; // 2MB

const decodeDataUrlImage = dataUrl => {
  if (!dataUrl || typeof dataUrl !== "string") throw new Error("Invalid signature image");
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg|image\/jpg);base64,(.+)$/);
  if (!match) throw new Error("Invalid base64 image format");
  const mime = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_SIG_BYTES) throw new Error("Signature image too large");
  const isPng = mime === "image/png";
  return { buffer, isPng };
};

// Map normalized browser coords (xRel, yRel relative to top-left) to PDF bottom-left coords
const mapBrowserToPdfBox = (page, coordinate) => {
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();

  const xRel = Number(coordinate.xRel);
  const yRel = Number(coordinate.yRel);
  const wRel = Number(coordinate.wRel);
  const hRel = Number(coordinate.hRel);

  if ([xRel, yRel, wRel, hRel].some(n => Number.isNaN(n))) {
    throw new Error("Invalid coordinate numbers");
  }
  if (wRel <= 0 || hRel <= 0) throw new Error("Invalid wRel/hRel");

  const boxWidth = wRel * pdfWidth;
  const boxHeight = hRel * pdfHeight;
  const x = xRel * pdfWidth;
  const yTop = yRel * pdfHeight;
  // PDF origin bottom-left:
  const y = pdfHeight - yTop - boxHeight;

  return { x, y, boxWidth, boxHeight };
};

const drawImageContained = (page, image, box) => {
  const imgWidth = image.width || 1;
  const imgHeight = image.height || 1;
  const scale = Math.min(box.boxWidth / imgWidth, box.boxHeight / imgHeight);
  const drawWidth = imgWidth * scale;
  const drawHeight = imgHeight * scale;
  const offsetX = box.x + (box.boxWidth - drawWidth) / 2;
  const offsetY = box.y + (box.boxHeight - drawHeight) / 2;
  page.drawImage(image, { x: offsetX, y: offsetY, width: drawWidth, height: drawHeight });
};

export const signPdf = async (req, res) => {
  try {
    const { pdfId, signatureImageBase64, fields } = req.body;

    if (!pdfId) return res.status(400).json({ error: "pdfId required" });
    if (!signatureImageBase64) return res.status(400).json({ error: "signatureImageBase64 required" });
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: "fields array required" });
    }

    const candidatePath = path.join(pdfDirectory, pdfId);
    if (!fsSync.existsSync(candidatePath)) {
      return res.status(404).json({ error: "Original PDF not found" });
    }

    const originalBytes = await fs.readFile(candidatePath);
    const originalHash = getSha256(originalBytes);

    const pdfDoc = await PDFDocument.load(originalBytes);

    // decode signature
    let sig;
    try {
      sig = decodeDataUrlImage(signatureImageBase64);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const image = sig.isPng ? await pdfDoc.embedPng(sig.buffer) : await pdfDoc.embedJpg(sig.buffer);
    const pages = pdfDoc.getPages();

    // iterate fields and draw
    for (const field of fields) {
      const pageIndex = Number(field.pageIndex || 0);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
        // ignore invalid pageIndex but continue
        continue;
      }
      const page = pages[pageIndex];

      // require normalized coords for each field
      if (typeof field.xRel !== "number" || typeof field.yRel !== "number" ||
          typeof field.wRel !== "number" || typeof field.hRel !== "number") {
        continue;
      }

      const box = mapBrowserToPdfBox(page, field);
      if (field.type === "signature") {
        drawImageContained(page, image, box);
      } else if (field.type === "text" && field.value) {
        const font = await pdfDoc.embedFont("Helvetica"); // fallback
        const fontSize = 10;
        page.drawText(String(field.value), {
          x: box.x + 4,
          y: box.y + box.boxHeight / 2 - fontSize / 2,
          size: fontSize,
          font
        });
      } else if (field.type === "date") {
        const font = await pdfDoc.embedFont("Helvetica");
        const fontSize = 10;
        const text = field.value || new Date().toLocaleDateString("en-GB");
        page.drawText(text, {
          x: box.x + 4,
          y: box.y + box.boxHeight / 2 - fontSize / 2,
          size: fontSize,
          font
        });
      } else if (field.type === "radio" && field.checked) {
        // draw filled circle
        const cx = box.x + box.boxWidth / 2;
        const cy = box.y + box.boxHeight / 2;
        const r = Math.min(box.boxWidth, box.boxHeight) / 4;
        page.drawCircle({ x: cx, y: cy, size: r, borderWidth: 0, color: undefined });
        page.drawCircle({ x: cx, y: cy, size: r / 2 });
      }
    }

    const signedBytes = await pdfDoc.save();
    const signedHash = getSha256(signedBytes);

    await fs.mkdir(signedDirectory, { recursive: true });
    const signedFilename = `${path.parse(pdfId).name}-signed-${Date.now()}.pdf`;
    const signedPath = path.join(signedDirectory, signedFilename);
    await fs.writeFile(signedPath, signedBytes);

    // save audit (best-effort)
    try {
      await SignatureAudit.create({ pdfId, originalHash, signedHash });
    } catch (err) {
      console.error("Audit save failed:", err);
    }

    const signedPdfUrl = `/signed/${signedFilename}`;
    return res.json({ signedPdfUrl, originalHash, signedHash });
  } catch (err) {
    console.error("signPdf error:", err);
    return res.status(500).json({ error: "Failed to sign PDF" });
  }
};
