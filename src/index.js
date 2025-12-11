// src/index.js
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

// -- parse allowed origins from env (comma separated)
const raw = process.env.CLIENT_ORIGIN || "";
const allowedOrigins = raw
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// debug log to ensure env parsed correctly
console.log("Allowed origins:", allowedOrigins);

const corsOptions = {
  origin: function (incomingOrigin, callback) {
    // allow requests with no origin (curl, server-to-server, Postman, same-origin)
    if (!incomingOrigin) return callback(null, true);

    // debug log each incoming origin (helps tracing)
    console.log("CORS check for origin:", incomingOrigin);

    // allow if in list
    if (allowedOrigins.includes(incomingOrigin)) {
      return callback(null, true);
    }

    // NOT allowed: do NOT throw error here (that causes 500 on OPTIONS)
    // instead return "false" which tells cors middleware not to set ACAO header
    // Browser will block the request client-side.
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  optionsSuccessStatus: 204,
  preflightContinue: false
};

// attach cors
app.use(cors(corsOptions));
// explicit preflight handling (optional but explicit)
app.options("*", cors(corsOptions));

// serve uploaded files
app.use("/signed", express.static(path.join(__dirname, "uploads", "signed")));
app.use("/pdf", express.static(path.join(__dirname, "uploads", "original")));

// your routes
app.use("/api", pdfRoutes);

app.get("/", (req, res) => res.json({ message: "Signature Engine API Running" }));

// simple middleware to return 403 for disallowed origins (optional)
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    // if it's a browser request with a disallowed origin, respond with 403 for clarity
    // Note: browser will still block the response because ACAO isn't set — this is mainly for server logs/postman clarity.
    return res.status(403).json({ error: "Origin not allowed by CORS" });
  }
  return next();
});

// generic error handler (keeps server from crashing on unexpected errors)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && err.stack ? err.stack : err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  } else {
    next(err);
  }
});

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
