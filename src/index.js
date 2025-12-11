// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./config/db.js"; // see note below
import pdfRoutes from "./routes/pdfRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== Body parsers =====
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ===== Allowed origins (from env) =====
// Set CLIENT_ORIGIN as comma-separated list in Render / env file.
// Example: http://localhost:3000,https://your-vercel-app.vercel.app
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

// Use cors package with dynamic origin validation
app.use(
  cors({
    origin: (incomingOrigin, callback) => {
      // allow non-browser requests (no Origin header)
      if (!incomingOrigin) return callback(null, true);

      if (allowedOrigins.includes(incomingOrigin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin denied"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);

// Make sure OPTIONS preflight returns quickly
app.options("*", (req, res) => res.sendStatus(204));

// Optional debug logging for incoming origins (temporary - helpful when debugging)
if (process.env.DEBUG_CORS === "true") {
  app.use((req, res, next) => {
    console.log("[CORS DEBUG] Origin:", req.headers.origin);
    next();
  });
}

// ===== Static assets (pdfs) =====
app.use("/signed", express.static(path.join(__dirname, "uploads", "signed")));
app.use("/pdf", express.static(path.join(__dirname, "uploads", "original")));

// ===== API routes =====
app.use("/api", pdfRoutes);

// Root
app.get("/", (req, res) => {
  res.json({ message: "Signature Engine API Running" });
});

// Connect DB and start server
const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error("Failed to start app:", err);
    process.exit(1);
  });
