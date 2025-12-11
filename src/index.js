import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./config/db.js";
import pdfRoutes from "./routes/pdfRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const raw = process.env.CLIENT_ORIGIN || "";
const allowedOrigins = raw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log("Allowed origins:", allowedOrigins);


const corsOptions = {
  origin: (incomingOrigin, callback) => {
   
    if (!incomingOrigin) return callback(null, true);

    console.log("CORS check for origin:", incomingOrigin);

    if (allowedOrigins.includes(incomingOrigin)) {
      return callback(null, true);
    }
    
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  optionsSuccessStatus: 204,
  preflightContinue: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use("/signed", express.static(path.join(__dirname, "uploads", "signed")));
app.use("/pdf", express.static(path.join(__dirname, "uploads", "original")));
app.use("/api", pdfRoutes);
app.get("/", (req, res) => res.json({ message: "Signature Engine API Running" }));
app.locals.BACKEND_URL = process.env.BACKEND_URL || "";

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
