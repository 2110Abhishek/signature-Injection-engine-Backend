import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { signPdf } from "../controllers/pdfController.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalDir = path.join(__dirname, "..", "uploads", "original");
if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, originalDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, 
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  }
});

router.post("/upload-pdf", upload.single("pdf"), (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const pdfId = file.filename;
    const pdfUrl = `/pdf/${file.filename}`; 

    return res.json({ pdfId, pdfUrl });
  } catch (err) {
    console.error("upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/sign-pdf", signPdf);

export default router;
