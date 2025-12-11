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
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (incomingOrigin, callback) => {
      if (!incomingOrigin) return callback(null, true)
      if (allowedOrigins.includes(incomingOrigin)) {
        return callback(null, true);
      }

    
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);
app.options("*", (req, res) => res.sendStatus(204));
app.use("/signed", express.static(path.join(__dirname, "uploads", "signed")));
app.use("/pdf", express.static(path.join(__dirname, "uploads", "original")));

app.use("/api", pdfRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Signature Engine API Running" });
});

if (process.env.DEBUG_CORS === "true") {
  app.use((req, res, next) => {
    console.log("[CORS DEBUG] origin:", req.headers.origin);
    next();
  });
}

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error("Failed to start app:", err);
    process.exit(1);
  });
