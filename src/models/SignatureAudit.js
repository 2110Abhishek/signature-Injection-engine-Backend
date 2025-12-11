import mongoose from "mongoose";

const SignatureAuditSchema = new mongoose.Schema(
  {
    pdfId: { 
      type: String, 
      required: true,
      index: true 
    },
    originalHash: { 
      type: String, 
      required: true 
    },
    signedHash: { 
      type: String, 
      required: true 
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Create index for faster queries
SignatureAuditSchema.index({ pdfId: 1, createdAt: -1 });

export const SignatureAudit = mongoose.model("SignatureAudit", SignatureAuditSchema);