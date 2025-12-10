import crypto from "crypto"
import fs from "fs"

export const sha256File = path => {
  const fileBuffer = fs.readFileSync(path)
  const hashSum = crypto.createHash("sha256")
  hashSum.update(fileBuffer)
  return hashSum.digest("hex")
}
