import crypto from "node:crypto";

export const X25519_KEY_SIZE = 32;
export const KNX_KEY_SIZE = 16;
export const PBKDF2_ITERATIONS = 65536;

export const SALT_USER_PASSWORD = "user-password.1.secure.ip.knx.org";
export const SALT_DEVICE_AUTH = "device-authentication-code.1.secure.ip.knx.org";
export const SALT_KEYRING_PASSWORD = "1.keyring.ets.knx.org";

/**
 * Fixed password hash for an empty password string ("") in ex-factory state (03_08_09 §2.3.1.4.3).
 */
export const EMPTY_USER_PASSWORD_HASH = Buffer.from("e9c304b914a35175fd7d1c673ab52fe1", "hex");

const X25519_SPKI_PREFIX_DER = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8_PREFIX_DER = Buffer.from("302e020100300506032b656e04220420", "hex");

/**
 * Derives a 16-byte KNX IP Secure User Password Hash using PBKDF2-HMAC-SHA256 (03_08_09 §2.3.1.4.1).
 * If a 16-byte Buffer is passed directly, returns a copy of it.
 */
export function deriveUserPasswordKey(password: string | Buffer): Buffer {
  if (Buffer.isBuffer(password)) {
    if (password.length !== KNX_KEY_SIZE) {
      throw new Error(`Invalid user password key buffer length: ${password.length} (expected 16)`);
    }
    return Buffer.from(password);
  }
  return crypto.pbkdf2Sync(Buffer.from(password, "latin1"), SALT_USER_PASSWORD, PBKDF2_ITERATIONS, KNX_KEY_SIZE, "sha256");
}

/**
 * Derives a 16-byte KNX IP Secure Device Authentication Code using PBKDF2-HMAC-SHA256 (03_08_09 §2.3.1.3.1).
 * If a 16-byte Buffer is passed directly, returns a copy of it.
 */
export function deriveDeviceAuthenticationCode(password: string | Buffer): Buffer {
  if (Buffer.isBuffer(password)) {
    if (password.length !== KNX_KEY_SIZE) {
      throw new Error(`Invalid device authentication code buffer length: ${password.length} (expected 16)`);
    }
    return Buffer.from(password);
  }
  return crypto.pbkdf2Sync(Buffer.from(password, "latin1"), SALT_DEVICE_AUTH, PBKDF2_ITERATIONS, KNX_KEY_SIZE, "sha256");
}

/**
 * Derives a 16-byte ETS Keyring (.knxkeys) encryption key using PBKDF2-HMAC-SHA256.
 */
export function deriveKeyringPasswordKey(password: string): Buffer {
  return crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(SALT_KEYRING_PASSWORD, "utf8"),
    PBKDF2_ITERATIONS,
    KNX_KEY_SIZE,
    "sha256",
  );
}

/**
 * Generates an ephemeral X25519 (Curve25519) key pair for a KNXnet/IP Secure Session (03_08_09 §2.2.3.1.1).
 */
export function generateX25519KeyPair(): { privateKey: crypto.KeyObject; publicKeyRaw: Buffer } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyRaw = Buffer.from(der.subarray(der.length - X25519_KEY_SIZE));
  return { privateKey, publicKeyRaw };
}

/**
 * Imports a 32-byte raw X25519 private key into a Node.js KeyObject and derives its 32-byte raw public key.
 */
export function importX25519PrivateKey(rawPrivateKey32: Buffer): { privateKey: crypto.KeyObject; publicKeyRaw: Buffer } {
  if (rawPrivateKey32.length !== X25519_KEY_SIZE) {
    throw new Error(`Invalid X25519 private key length: ${rawPrivateKey32.length} (expected 32)`);
  }
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX_DER, rawPrivateKey32]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = privateKey.export({ format: "jwk" });
  const publicKeyRaw = Buffer.from(jwk.x!, "base64url");
  return { privateKey, publicKeyRaw };
}

/**
 * Computes the 32-byte ECDH shared secret on Curve25519.
 */
export function computeEcdhSharedSecret(privateKey: crypto.KeyObject, peerPublicKeyRaw32: Buffer): Buffer {
  if (peerPublicKeyRaw32.length !== X25519_KEY_SIZE) {
    throw new Error(`Invalid peer X25519 public key length: ${peerPublicKeyRaw32.length} (expected 32)`);
  }
  const peerKeyObj = crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX_DER, peerPublicKeyRaw32]),
    format: "der",
    type: "spki",
  });
  return crypto.diffieHellman({ privateKey, publicKey: peerKeyObj });
}

/**
 * Calculates the 16-byte KNXnet/IP Secure Session Key from the own private key and peer's 32-byte public key.
 * SessionKey = SHA256(Curve25519(myPrivateKey, peersPublicKey))[0..15] (03_08_09 §2.2.3.1.2).
 */
export function computeSessionKey(privateKey: crypto.KeyObject, peerPublicKeyRaw32: Buffer): Buffer {
  const sharedSecret = computeEcdhSharedSecret(privateKey, peerPublicKeyRaw32);
  const hash = crypto.createHash("sha256").update(sharedSecret).digest();
  return Buffer.from(hash.subarray(0, KNX_KEY_SIZE));
}

/**
 * Computes the 32-byte XOR of Client Public Key X and Server Public Key Y (X ^ Y).
 */
export function xorPublicKeys(clientPub32: Buffer, serverPub32: Buffer): Buffer {
  if (clientPub32.length !== X25519_KEY_SIZE || serverPub32.length !== X25519_KEY_SIZE) {
    throw new Error("Both X25519 public keys must be 32 bytes");
  }
  const out = Buffer.alloc(X25519_KEY_SIZE);
  for (let i = 0; i < X25519_KEY_SIZE; i++) {
    out[i] = clientPub32[i] ^ serverPub32[i];
  }
  return out;
}

/**
 * Normalizes a 16-byte key provided as a Buffer or 32-character hex string.
 */
export function parseKey16(key: Buffer | string, name: string = "key"): Buffer {
  if (Buffer.isBuffer(key)) {
    if (key.length !== KNX_KEY_SIZE) {
      throw new Error(`Invalid ${name} buffer length: ${key.length} (expected 16 bytes)`);
    }
    return Buffer.from(key);
  }
  const cleaned = key.trim().replace(/^0x/i, "").replace(/[\s:-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(cleaned)) {
    throw new Error(`Invalid ${name} hex string (expected 32 hex characters)`);
  }
  return Buffer.from(cleaned, "hex");
}
