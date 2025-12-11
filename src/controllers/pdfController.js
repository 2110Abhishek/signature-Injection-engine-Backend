import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Audit } from "../models/Audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfDirectory = path.join(__dirname, "..", "uploads", "original");
const signedDirectory = path.join(__dirname, "..", "uploads", "signed");

const pdfMap = {
  "sample-a4": path.join(pdfDirectory, "sample.pdf"),
};

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024; // 2 MB

const getSha256 = buffer => {
  return crypto.createHash("sha256").update(buffer).digest("hex");
};

const decodeDataUrlImage = dataUrl => {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Invalid signature image: not a string");
  }

  const match = dataUrl.match(/^data:(image\/png|image\/jpeg|image\/jpg);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL format. Expected data:image/png|jpeg;base64,...");
  }

  const mime = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length > MAX_SIGNATURE_BYTES) {
    throw new Error("Signature image size exceeds limit");
  }

  const isPng = mime === "image/png";
  return { buffer, isPng };
};

const mapBrowserToPdfBox = (page, coordinate) => {
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();

  const xRel = Number(coordinate.xRel);
  const yRel = Number(coordinate.yRel);
  const wRel = Number(coordinate.wRel);
  const hRel = Number(coordinate.hRel);

  if ([xRel, yRel, wRel, hRel].some(n => Number.isNaN(n))) {
    throw new Error("Invalid coordinate values (not numbers)");
  }
  if (wRel <= 0 || hRel <= 0) {
    throw new Error("Invalid coordinate size (wRel/hRel must be > 0)");
  }

  const boxWidth = wRel * pdfWidth;
  const boxHeight = hRel * pdfHeight;
  const x = xRel * pdfWidth;
  const yTop = yRel * pdfHeight;
  const y = pdfHeight - yTop - boxHeight; 

  return { x, y, boxWidth, boxHeight };
};

const drawImageContained = (page, image, box) => {
  const imgWidth = image.width;
  const imgHeight = image.height;

  if (!imgWidth || !imgHeight) {
    page.drawImage(image, {
      x: box.x,
      y: box.y,
      width: box.boxWidth,
      height: box.boxHeight
    });
    return;
  }

  const scale = Math.min(box.boxWidth / imgWidth, box.boxHeight / imgHeight);
  const drawWidth = imgWidth * scale;
  const drawHeight = imgHeight * scale;
  const offsetX = box.x + (box.boxWidth - drawWidth) / 2;
  const offsetY = box.y + (box.boxHeight - drawHeight) / 2;

  page.drawImage(image, {
    x: offsetX,
    y: offsetY,
    width: drawWidth,
    height: drawHeight
  });
};

export const signPdf = async (req, res) => {
  try {
    const { pdfId, signatureImageBase64, coordinate } = req.body;

    if (!pdfId) return res.status(400).json({ message: "Missing pdfId" });
    if (!signatureImageBase64) return res.status(400).json({ message: "Missing signatureImageBase64" });
    if (!coordinate || typeof coordinate !== "object") return res.status(400).json({ message: "Missing coordinate object" });

    
    const candidatePath = path.join(pdfDirectory, `${pdfId}.pdf`);

    let pdfPath = null;
    if (fsSync.existsSync(candidatePath)) {
      pdfPath = candidatePath;
    } else if (pdfMap[pdfId] && fsSync.existsSync(pdfMap[pdfId])) {
      
      pdfPath = pdfMap[pdfId];
    } else {
      return res.status(404).json({ message: "Original PDF not found for given pdfId" });
    }

  
    const originalBuffer = await fs.readFile(pdfPath);
    const originalHash = getSha256(originalBuffer);

    const pdfDoc = await PDFDocument.load(originalBuffer);
    const pageIndex = Number(coordinate.pageIndex || 0);

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
      return res.status(400).json({ message: "pageIndex is out of bounds" });
    }

    const page = pdfDoc.getPage(pageIndex);
    let sig;
    try {
      sig = decodeDataUrlImage(signatureImageBase64);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const image = sig.isPng
      ? await pdfDoc.embedPng(sig.buffer)
      : await pdfDoc.embedJpg(sig.buffer);

    const { xRel, yRel, wRel, hRel } = coordinate;
    if ([xRel, yRel, wRel, hRel].some(n => typeof n !== "number" || !isFinite(n))) {
      return res.status(400).json({ message: "coordinate fields must be finite numbers" });
    }
   
    if (wRel <= 0 || hRel <= 0) {
      return res.status(400).json({ message: "Invalid width/height ratios" });
    }

    const box = mapBrowserToPdfBox(page, coordinate);
    drawImageContained(page, image, box);

    const signedBytes = await pdfDoc.save();
    const signedHash = getSha256(signedBytes);

    await fs.mkdir(signedDirectory, { recursive: true });

    const fileName = `signed-${Date.now()}.pdf`;
    const signedPath = path.join(signedDirectory, fileName);
    await fs.writeFile(signedPath, signedBytes);

    
    let audit = null;
    try {
      audit = await Audit.create({
        pdfId,
        originalHash,
        signedHash,
        originalPath: pdfPath,
        signedPath
      });
    } catch (err) {
      console.error("Audit save failed:", err);
     
    }

    const signedPdfUrl = `/signed/${fileName}`;
    return res.json({
      signedPdfUrl,
      auditId: audit ? audit._id : null
    });
  } catch (err) {
    console.error("signPdf error:", err);
    return res.status(500).json({ message: "Failed to sign PDF" });
  }
};
