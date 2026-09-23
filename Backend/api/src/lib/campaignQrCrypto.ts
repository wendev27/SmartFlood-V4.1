import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const encryptionKeyLength = 32;
const ivLength = 12;
const authTagLength = 16;
const payloadVersion = "v1";

function getEncryptionKey() {
  const encodedKey = process.env.CAMPAIGN_QR_ENCRYPTION_KEY?.trim();
  if (!encodedKey) throw new Error("CAMPAIGN_QR_ENCRYPTION_KEY is required.");

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== encryptionKeyLength) {
    throw new Error("CAMPAIGN_QR_ENCRYPTION_KEY must encode exactly 32 bytes.");
  }
  return key;
}

export function encryptCampaignQrToken(token: string) {
  if (!token) throw new Error("Campaign QR token is required.");

  // AES-GCM protects the database copy used for later QR re-display and also
  // detects tampering through its authentication tag. The QR renderer still
  // receives the decrypted opaque token; the QR payload itself is not this
  // versioned ciphertext envelope.
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    payloadVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCampaignQrToken(encryptedToken: string) {
  try {
    // Reject malformed envelopes before attempting authenticated decryption.
    const [version, encodedIv, encodedAuthTag, encodedCiphertext] = encryptedToken.split(".");
    if (version !== payloadVersion || !encodedIv || !encodedAuthTag || !encodedCiphertext) throw new Error();

    const iv = Buffer.from(encodedIv, "base64url");
    const authTag = Buffer.from(encodedAuthTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== ivLength || authTag.length !== authTagLength || ciphertext.length === 0) throw new Error();

    const decipher = createDecipheriv(algorithm, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Campaign QR token decryption failed.");
  }
}
