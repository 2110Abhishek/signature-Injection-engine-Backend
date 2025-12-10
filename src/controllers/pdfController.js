import path from "path";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Audit } from "../models/Audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfDirectory = path.join(__dirname, "..", "uploads", "original");
const signedDirectory = path.join(__dirname, "..", "uploads", "signed");

const pdfMap = {
  "sample-a4": path.join(pdfDirectory, "sample.pdf")
};

const getSha256 = buffer => {
  return crypto.createHash("sha256").update(buffer).digest("hex");
};

const decodeDataUrlImage = dataUrl => {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Invalid signature image");
  }
  const parts = dataUrl.split(",");
  if (parts.length !== 2) {
    throw new Error("Invalid base64 image format");
  }
  const meta = parts[0];
  const base64 = parts[1];
  const isPng = meta.includes("image/png");
  const isJpg = meta.includes("image/jpeg") || meta.includes("image/jpg");
  if (!isPng && !isJpg) {
    throw new Error("Only PNG or JPEG signatures are supported");
  }
  const buffer = Buffer.from(base64, "base64");
  return { buffer, isPng };
};

const mapBrowserToPdfBox = (page, coordinate) => {
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();
  const xRel = coordinate.xRel;
  const yRel = coordinate.yRel;
  const wRel = coordinate.wRel;
  const hRel = coordinate.hRel;
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

    if (!pdfId || !signatureImageBase64 || !coordinate) {
      return res.status(400).json({ message: "Missing payload fields" });
    }

    const pdfPath = pdfMap[pdfId];
    if (!pdfPath) {
      return res.status(404).json({ message: "Unknown pdfId" });
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: "Original PDF not found" });
    }

    const originalBuffer = fs.readFileSync(pdfPath);
    const originalHash = getSha256(originalBuffer);

    const pdfDoc = await PDFDocument.load(originalBuffer);
    const pageIndex = coordinate.pageIndex || 0;
    const page = pdfDoc.getPage(pageIndex);

    const { buffer: sigBuffer, isPng } = decodeDataUrlImage(
      signatureImageBase64
    );
    const image = isPng
      ? await pdfDoc.embedPng(sigBuffer)
      : await pdfDoc.embedJpg(sigBuffer);

    const box = mapBrowserToPdfBox(page, coordinate);
    drawImageContained(page, image, box);

    const signedBytes = await pdfDoc.save();
    const signedHash = getSha256(signedBytes);

    if (!fs.existsSync(signedDirectory)) {
      fs.mkdirSync(signedDirectory, { recursive: true });
    }

    const fileName = `signed-${Date.now()}.pdf`;
    const signedPath = path.join(signedDirectory, fileName);
    fs.writeFileSync(signedPath, signedBytes);

    const audit = await Audit.create({
      pdfId,
      originalHash,
      signedHash,
      originalPath: pdfPath,
      signedPath
    });

    const signedPdfUrl = `/signed/${fileName}`;

    return res.json({
      signedPdfUrl,
      auditId: audit._id
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to sign PDF" });
  }
};
