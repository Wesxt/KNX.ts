import {
  computeEcdhSharedSecret,
  computeSessionKey,
  deriveDeviceAuthenticationCode,
  deriveUserPasswordKey,
  EMPTY_USER_PASSWORD_HASH,
  importX25519PrivateKey,
  xorPublicKeys,
} from "../src/security/KnxSecureKeys";
import {
  SessionRequest,
  SessionResponse,
  SessionAuthenticate,
  SessionStatus,
  TimerNotify,
  SecureWrapper,
} from "../src/core/KNXnetIPSecureStructures";
import { SecureSessionStatus } from "../src/core/enum/KNXnetIPEnum";

describe("KNX IP Secure Cryptography & Annex A Binary Vectors (03_08_09)", () => {
  const clientPrivHex = "b8fabd62665d8b9e8a9d8b1f4bca42c8c2789a6110f50e9dd785b3ede883f378";
  const clientPubHex = "0aa227b4fd7a32319ba9960ac036ce0e5c4507b5ae55161f1078b1dcfb3cb631";
  const serverPubHex = "bdf099909923143ef0a5de0b3be3687bc5bd3cf5f9e6f901699cd870ec1ff824";
  const expectedXorHex = "b752be246459260f6b0c4801fbd5a67599f83b4057b3ef1e79e469ac17234e15";
  const expectedSharedSecretHex = "d801525217618f0da90a4ff22148aee0ff4c19b430e8081223ffe99c81a98b05";
  const expectedSessionKeyHex = "289426c2912535ba98279a4d1843c487";

  test("PBKDF2 key derivations match 03_08_09 §2.3.1.4.3, A.2.2, and A.3.1", () => {
    expect(deriveUserPasswordKey("").toString("hex")).toBe(EMPTY_USER_PASSWORD_HASH.toString("hex"));
    expect(deriveDeviceAuthenticationCode("trustme").toString("hex")).toBe(
      "e158e4012047bd6cc41aafbc5c04c1fc",
    );
    expect(deriveUserPasswordKey("secret").toString("hex")).toBe("03fcedb66660251ec81a1a716901696a");
  });

  test("A.1 SESSION_REQUEST key pair and binary encoding", () => {
    const { privateKey, publicKeyRaw } = importX25519PrivateKey(Buffer.from(clientPrivHex, "hex"));
    expect(publicKeyRaw.toString("hex")).toBe(clientPubHex);

    const req = new SessionRequest(publicKeyRaw);
    const encoded = req.toBuffer();
    expect(encoded.toString("hex")).toBe(
      "06100951002e0802000000000000" + clientPubHex,
    );

    const decoded = SessionRequest.fromBuffer(encoded);
    expect(decoded.clientPublicKey.toString("hex")).toBe(clientPubHex);

    // ECDH shared secret & session key (A.2.4)
    const serverPub = Buffer.from(serverPubHex, "hex");
    expect(xorPublicKeys(publicKeyRaw, serverPub).toString("hex")).toBe(expectedXorHex);
    expect(computeEcdhSharedSecret(privateKey, serverPub).toString("hex")).toBe(expectedSharedSecretHex);
    expect(computeSessionKey(privateKey, serverPub).toString("hex")).toBe(expectedSessionKeyHex);
  });

  test("A.2 SESSION_RESPONSE MAC calculation, binary encoding, and verification", () => {
    const clientPub = Buffer.from(clientPubHex, "hex");
    const serverPub = Buffer.from(serverPubHex, "hex");
    const devAuthCode = deriveDeviceAuthenticationCode("trustme");

    const resp = SessionResponse.createAuthenticated(0x0001, serverPub, clientPub, devAuthCode);
    expect(resp.mac.toString("hex")).toBe("a922505aaa436163570bd5494c2df2a3");

    const expectedHex =
      "0610095200380001" + serverPubHex + "a922505aaa436163570bd5494c2df2a3";
    expect(resp.toBuffer().toString("hex")).toBe(expectedHex);

    const parsed = SessionResponse.fromBuffer(Buffer.from(expectedHex, "hex"));
    expect(parsed.verifyMac(clientPub, devAuthCode)).toBe(true);
    expect(parsed.verifyMac(clientPub, deriveDeviceAuthenticationCode("wrong"))).toBe(false);
  });

  test("A.3 SESSION_AUTHENTICATE and SECURE_WRAPPER binary vectors", () => {
    const clientPub = Buffer.from(clientPubHex, "hex");
    const serverPub = Buffer.from(serverPubHex, "hex");
    const userKey = deriveUserPasswordKey("secret");

    const auth = SessionAuthenticate.create(0x01, clientPub, serverPub, userKey);
    expect(auth.mac.toString("hex")).toBe("1f1d59ea9f12a152e5d9727f08462cde");

    const expectedPlainAuthHex = "06100953001800011f1d59ea9f12a152e5d9727f08462cde";
    expect(auth.toBuffer().toString("hex")).toBe(expectedPlainAuthHex);
    expect(SessionAuthenticate.fromBuffer(auth.toBuffer()).verifyMac(clientPub, serverPub, userKey)).toBe(true);

    // A.3.3 & A.3.4 Wrapped SESSION_AUTHENTICATE
    const sessionKey = Buffer.from(expectedSessionKeyHex, "hex");
    const serial = Buffer.from("00fa12345678", "hex");
    const tag = Buffer.from("affe", "hex");

    const wrapped = SecureWrapper.wrap({
      sessionId: 0x0001,
      sequenceNumber: 0n,
      serialNumber: serial,
      messageTag: tag,
      innerFrame: auth.toBuffer(),
      key: sessionKey,
    });

    const expectedWrappedHex =
      "06100950003e" +
      "0001" +
      "000000000000" +
      "00fa12345678" +
      "affe" +
      "7915a4f36e6e4208d28b4a207d8f35c0d138c26a7b5e7169" +
      "52dba8e7e4bd80bd7d868a3ae78749de";

    expect(wrapped.toString("hex")).toBe(expectedWrappedHex);

    const unwrapped = SecureWrapper.unwrap(wrapped, sessionKey);
    expect(unwrapped.sessionId).toBe(0x0001);
    expect(unwrapped.sequenceNumber).toBe(0n);
    expect(unwrapped.innerFrame.toString("hex")).toBe(expectedPlainAuthHex);

    // Tampered byte must fail MAC verification
    const tampered = Buffer.from(wrapped);
    tampered[25] ^= 0xff;
    expect(() => SecureWrapper.unwrap(tampered, sessionKey)).toThrow(/MAC verification failed/);
  });

  test("A.4 SESSION_STATUS and SECURE_WRAPPER binary vectors", () => {
    const status = new SessionStatus(SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS);
    expect(status.toBuffer().toString("hex")).toBe("0610095400080000");

    const sessionKey = Buffer.from(expectedSessionKeyHex, "hex");
    const serial = Buffer.from("00faaaaaaaaa", "hex");
    const tag = Buffer.from("affe", "hex");

    const wrapped = SecureWrapper.wrap({
      sessionId: 0x0001,
      sequenceNumber: 0n,
      serialNumber: serial,
      messageTag: tag,
      innerFrame: status.toBuffer(),
      key: sessionKey,
    });

    const expectedWrappedHex =
      "06100950002e" +
      "0001" +
      "000000000000" +
      "00faaaaaaaaa" +
      "affe" +
      "26156db5c749888f" +
      "a373c3e0b4bde4497c395e4b1c2f46a1";

    expect(wrapped.toString("hex")).toBe(expectedWrappedHex);
    const unwrapped = SecureWrapper.unwrap(wrapped, sessionKey);
    expect(SessionStatus.fromBuffer(unwrapped.innerFrame).status).toBe(
      SecureSessionStatus.STATUS_AUTHENTICATION_SUCCESS,
    );
  });

  test("A.5 ROUTING_INDICATION multicast SECURE_WRAPPER binary vector", () => {
    const backboneKey = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    const timerValue = 211938428830917n; // 0xc0c1c2c3c4c5
    const serial = Buffer.from("00fa12345678", "hex");
    const tag = Buffer.from("affe", "hex");
    const plainRoutingInd = Buffer.from("0610053000112900bcd011590ade010081", "hex");

    const wrapped = SecureWrapper.wrap({
      sessionId: 0x0000,
      sequenceNumber: timerValue,
      serialNumber: serial,
      messageTag: tag,
      innerFrame: plainRoutingInd,
      key: backboneKey,
    });

    const expectedWrappedHex =
      "061009500037" +
      "0000" +
      "c0c1c2c3c4c5" +
      "00fa12345678" +
      "affe" +
      "b7ee7e8a1c2f7bbabec775fd6e10d0bc4b" +
      "7212a03aaae49da85689774c1d2b4da4";

    expect(wrapped.toString("hex")).toBe(expectedWrappedHex);
    const unwrapped = SecureWrapper.unwrap(wrapped, backboneKey);
    expect(unwrapped.sessionId).toBe(0);
    expect(unwrapped.sequenceNumber).toBe(timerValue);
    expect(unwrapped.innerFrame.toString("hex")).toBe(plainRoutingInd.toString("hex"));
  });

  test("A.6 TIMER_NOTIFY binary vector", () => {
    const backboneKey = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    const timerValue = 211938428830917n; // 0xc0c1c2c3c4c5
    const serial = Buffer.from("00fa12345678", "hex");
    const tag = Buffer.from("affe", "hex");

    const notify = TimerNotify.create(timerValue, serial, tag, backboneKey);
    const expectedHex =
      "061009550024" +
      "c0c1c2c3c4c5" +
      "00fa12345678" +
      "affe" +
      "ee7b9b3083deb1570eb38d073adad985";

    expect(notify.toBuffer().toString("hex")).toBe(expectedHex);

    const parsed = TimerNotify.fromBuffer(Buffer.from(expectedHex, "hex"));
    expect(parsed.timerValue).toBe(timerValue);
    expect(parsed.verifyMac(backboneKey)).toBe(true);
    expect(parsed.verifyMac(Buffer.alloc(16, 0xff))).toBe(false);
  });
});
