import mongoose from "mongoose";

const SignatureAuditSchema = new mongoose.Schema(
  {
    pdfId: { type: String, required: true },
    originalHash: { type: String, required: true },
    signedHash: { type: String, required: true },
  },
  { timestamps: true }
);

export const SignatureAudit = mongoose.model("SignatureAudit", SignatureAuditSchema);
