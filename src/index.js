// src/index.js (or wherever you bootstrap express)
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./config/db.js";
import pdfRoutes from "./routes/pdfRoutes.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// Parse CLIENT_ORIGIN env into an array of allowed origins.
// Support single origin or comma-separated list in env var.
// Example: CLIENT_ORIGIN="https://site1.vercel.app,https://site2.vercel.app,http://localhost:3000"
const raw = process.env.CLIENT_ORIGIN || "";
const allowedOrigins = raw
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// CORS options with runtime origin check
const corsOptions = {
  origin: function (incomingOrigin, callback) {
    // allow non-browser tools (curl/postman) with no Origin header
    if (!incomingOrigin) return callback(null, true);

    // exact match check
    if (allowedOrigins.includes(incomingOrigin)) {
      return callback(null, true);
    }

    // reject
    return callback(new Error("CORS: Origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  // Proper preflight success status
  optionsSuccessStatus: 204
};

// register CORS globally
app.use(cors(corsOptions));

// make sure preflight requests reach CORS
app.options("*", cors(corsOptions));

// static + routes AFTER cors
app.use("/signed", express.static(path.join(__dirname, "uploads", "signed")));
app.use("/pdf", express.static(path.join(__dirname, "uploads", "original")));
app.use("/api", pdfRoutes);

app.get("/", (req, res) => res.json({ message: "Signature Engine API Running" }));

const PORT = process.env.PORT || 5000;
(async () => {
  try {
    await connectDB();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("Failed to start app:", err);
    process.exit(1);
  }
})();
