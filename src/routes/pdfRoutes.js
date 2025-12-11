import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { SignatureAudit } from "../models/SignatureAudit.js"; 

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalDir = path.join(__dirname, "..", "uploads", "original");
const signedDir = path.join(__dirname, "..", "uploads", "signed");

fs.mkdirSync(originalDir, { recursive: true });
fs.mkdirSync(signedDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, originalDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${timestamp}${Math.floor(Math.random() * 9000) + 1000}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["application/pdf", "application/x-pdf"];
  const ext = (file.originalname && path.extname(file.originalname).toLowerCase()) || "";
  if (allowed.includes(file.mimetype) || ext === ".pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed (mimetype or .pdf extension required)"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

function getBackendBaseUrl(req) {
  const envBackendUrl = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
  if (envBackendUrl) return envBackendUrl;

  const proto = (req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
  const host = req.get("host");
  return `${proto}://${host}`;
}

router.post("/upload-pdf", upload.single("pdf"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const pdfId = req.file.filename;
    const backendBase = getBackendBaseUrl(req);
    const pdfUrl = `${backendBase}/pdf/${pdfId}`;

    return res.status(200).json({ pdfId, pdfUrl });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/sign-pdf", async (req, res) => {
  try {
    const { pdfId, signatureImageBase64, fields } = req.body;

    if (!pdfId) return res.status(400).json({ error: "pdfId is required" });
    if (!signatureImageBase64) return res.status(400).json({ error: "signatureImageBase64 is required" });
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: "fields array is required" });
    }

    const originalPath = path.join(originalDir, pdfId);
    if (!fs.existsSync(originalPath)) return res.status(404).json({ error: "Original PDF not found" });

    const originalBytes = fs.readFileSync(originalPath);
    const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex");

    const pdfDoc = await PDFDocument.load(originalBytes);

    let base64Data = signatureImageBase64;
    if (typeof base64Data !== "string") return res.status(400).json({ error: "signatureImageBase64 must be a base64 string" });
    if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];

    const sigBytes = Buffer.from(base64Data, "base64");

    const isPng = signatureImageBase64.startsWith("data:image/png") || signatureImageBase64.startsWith("iVBOR");
    let signatureImage;
    try {
      signatureImage = isPng ? await pdfDoc.embedPng(sigBytes) : await pdfDoc.embedJpg(sigBytes);
    } catch (embedErr) {
      
      try {
        signatureImage = await pdfDoc.embedPng(sigBytes);
      } catch (err) {
        console.error("Failed to embed signature image:", err);
        return res.status(400).json({ error: "Invalid signature image data" });
      }
    }

    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const field of fields) {
      const pageIndex = Number(field.pageIndex || 0);
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      const page = pages[pageIndex];
      const { width, height } = page.getSize();

      const boxWidth = (Number(field.wRel) || 0) * width;
      const boxHeight = (Number(field.hRel) || 0) * height;
      const xTopLeft = (Number(field.xRel) || 0) * width;
      const yFromTop = (Number(field.yRel) || 0) * height;
      const yBottomLeft = height - yFromTop - boxHeight;

      if (field.type === "signature") {
        const sigDims = signatureImage.scale(1);
        const ratio = Math.min(boxWidth / sigDims.width, boxHeight / sigDims.height, 1);
        const drawWidth = sigDims.width * ratio;
        const drawHeight = sigDims.height * ratio;
        const x = xTopLeft + Math.max(0, (boxWidth - drawWidth) / 2);
        const y = yBottomLeft + Math.max(0, (boxHeight - drawHeight) / 2);

        page.drawImage(signatureImage, {
          x,
          y,
          width: drawWidth,
          height: drawHeight,
        });
      }

      if (field.type === "text" && field.value != null) {
        const text = String(field.value);
        const fontSize = field.fontSize ? Number(field.fontSize) : 10;
        const x = xTopLeft + 2;
        const y = yBottomLeft + Math.max(2, boxHeight / 2 - fontSize / 2);
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          maxWidth: Math.max(10, boxWidth - 4),
        });
      }

      if (field.type === "date") {
        const text = field.value || new Date().toLocaleDateString("en-GB");
        const fontSize = field.fontSize ? Number(field.fontSize) : 10;
        const x = xTopLeft + 2;
        const y = yBottomLeft + Math.max(2, boxHeight / 2 - fontSize / 2);
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
        });
      }

      if (field.type === "radio" && field.checked) {
        const padding = Math.min(boxWidth, boxHeight) * 0.15;
        page.drawRectangle({
          x: xTopLeft + padding,
          y: yBottomLeft + padding,
          width: Math.max(2, boxWidth - padding * 2),
          height: Math.max(2, boxHeight - padding * 2),
        });
      }
    }

    const signedBytes = await pdfDoc.save();
    const signedHash = crypto.createHash("sha256").update(signedBytes).digest("hex");

    const signedFilename = `${path.parse(pdfId).name}-signed-${Date.now()}.pdf`;
    const signedPath = path.join(signedDir, signedFilename);
    fs.writeFileSync(signedPath, signedBytes);

    try {
      await SignatureAudit.create({
        pdfId,
        originalHash,
        signedHash,
      });
      console.log("SignatureAudit saved for", pdfId);
    } catch (auditErr) {
      console.warn("SignatureAudit save failed (non-fatal):", auditErr && auditErr.message ? auditErr.message : auditErr);
    }

    const backendBase = getBackendBaseUrl(req);
    const signedPdfUrl = `${backendBase}/signed/${signedFilename}`;
    const originalPdfUrl = `${backendBase}/pdf/${pdfId}`;

    return res.status(200).json({
      signedPdfUrl,
      originalPdfUrl,
      originalHash,
      signedHash,
    });
  } catch (err) {
    console.error("Failed to sign PDF:", err);
    return res.status(500).json({ error: "Failed to sign PDF" });
  }
});

export default router;
