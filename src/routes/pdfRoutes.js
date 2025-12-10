import express from "express"
import multer from "multer"
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { fileURLToPath } from "url"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { SignatureAudit } from "../models/SignatureAudit.js"

const router = express.Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const originalDir = path.join(__dirname, "..", "uploads", "original")
const signedDir = path.join(__dirname, "..", "uploads", "signed")

if (!fs.existsSync(originalDir)) fs.mkdirSync(originalDir, { recursive: true })
if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, originalDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now()
    const ext = path.extname(file.originalname) || ".pdf"
    cb(null, `${timestamp}${ext}`)
  }
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"))
    }
    cb(null, true)
  }
})

router.post("/upload-pdf", upload.single("pdf"), (req, res) => {
  const file = req.file
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" })
  }

  const pdfId = file.filename
  const pdfUrl = `/pdf/${file.filename}`

  res.json({ pdfId, pdfUrl })
})

router.post("/sign-pdf", async (req, res) => {
  try {
    const { pdfId, signatureImageBase64, fields } = req.body

    if (!pdfId) return res.status(400).json({ error: "pdfId is required" })
    if (!signatureImageBase64) return res.status(400).json({ error: "signatureImageBase64 is required" })
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: "fields array is required" })
    }

    const originalPath = path.join(originalDir, pdfId)
    if (!fs.existsSync(originalPath)) {
      return res.status(404).json({ error: "Original PDF not found" })
    }

    const originalBytes = fs.readFileSync(originalPath)
    const originalHash = crypto.createHash("sha256").update(originalBytes).digest("hex")

    const pdfDoc = await PDFDocument.load(originalBytes)

    let base64Data = signatureImageBase64
    if (signatureImageBase64.includes(",")) {
      base64Data = signatureImageBase64.split(",")[1]
    }
    const sigBytes = Buffer.from(base64Data, "base64")

    let signatureImage
    let isPng = false
    if (signatureImageBase64.startsWith("data:image/png")) {
      isPng = true
      signatureImage = await pdfDoc.embedPng(sigBytes)
    } else {
      signatureImage = await pdfDoc.embedJpg(sigBytes)
    }

    const pages = pdfDoc.getPages()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    for (const field of fields) {
      const pageIndex = field.pageIndex || 0
      if (pageIndex < 0 || pageIndex >= pages.length) continue
      const page = pages[pageIndex]
      const { width, height } = page.getSize()

      const boxWidth = field.wRel * width
      const boxHeight = field.hRel * height
      const xTopLeft = field.xRel * width
      const yFromTop = field.yRel * height
      const yBottomLeft = height - yFromTop - boxHeight

      if (field.type === "signature") {
        const sigDims = isPng ? signatureImage.scale(1) : signatureImage.scale(1)
        const ratio = Math.min(boxWidth / sigDims.width, boxHeight / sigDims.height)
        const drawWidth = sigDims.width * ratio
        const drawHeight = sigDims.height * ratio
        const x = xTopLeft + (boxWidth - drawWidth) / 2
        const y = yBottomLeft + (boxHeight - drawHeight) / 2

        page.drawImage(signatureImage, {
          x,
          y,
          width: drawWidth,
          height: drawHeight
        })
      }

      if (field.type === "text" && field.value) {
        const text = String(field.value)
        const fontSize = 10
        const x = xTopLeft + 2
        const y = yBottomLeft + boxHeight / 2 - fontSize / 2
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font
        })
      }

      if (field.type === "date") {
        const text = field.value || new Date().toLocaleDateString("en-GB")
        const fontSize = 10
        const x = xTopLeft + 2
        const y = yBottomLeft + boxHeight / 2 - fontSize / 2
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font
        })
      }

      if (field.type === "radio" && field.checked) {
        const radius = Math.min(boxWidth, boxHeight) / 4
        const cx = xTopLeft + boxWidth / 2
        const cy = yBottomLeft + boxHeight / 2
        const x = cx - radius
        const y = cy - radius
        page.drawCircle({
          x: cx,
          y: cy,
          size: radius,
          borderWidth: 1
        })
        page.drawCircle({
          x: cx,
          y: cy,
          size: radius / 2
        })
      }
    }

    const signedBytes = await pdfDoc.save()
    const signedHash = crypto.createHash("sha256").update(signedBytes).digest("hex")

    const signedFilename = `${path.parse(pdfId).name}-signed-${Date.now()}.pdf`
    const signedPath = path.join(signedDir, signedFilename)
    fs.writeFileSync(signedPath, signedBytes)

    await SignatureAudit.create({
      pdfId,
      originalHash,
      signedHash
    })

    res.json({
      signedPdfUrl: `/signed/${signedFilename}`,
      originalHash,
      signedHash
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Failed to sign PDF" })
  }
})

export default router
