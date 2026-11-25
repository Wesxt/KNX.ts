import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnxDataSecure } from "../src/security/KnxDataSecure";
import { KnxKeyring, computeKeyringSignatureFromXml } from "../src/security/KnxKeyring";
import { deriveKeyringPasswordKey } from "../src/security/KnxSecureKeys";

const password = "knxPassword";
const created = "2024-10-03T12:34:56Z";
const ifacePasswordEnc = "9b1seR1kYPayZxTITA4mq3oRNSdkelNCOnHA0jtZK6g=";
const ifaceAuthEnc = "6/b5wvUrvyg4J+JH+J3EPvaGbIug0amjx5PMHkztZUQ=";
const mgmtPasswordEnc = "pijNuGYx6LA+7ZJ4vyWtUMTfuPFXEIEL5A8lmHadX6A=";
const deviceAuthEnc = "dMWy3GlA8iHV7cflIRyp7S0dBxyEiHFTWIE7qdMh6u4=";
const groupKeyEnc = "DFZA8HL9wnFWS3LGw40k/w==";
const backboneKeyEnc = "XvI24ir4JEE0cxRMsMKtbw==";
const toolKeyEnc = "dxJwaArmxpY3eftE9Qzj3Q==";

const unsignedKeyringXml = `<?xml version="1.0" encoding="utf-8"?>
<Keyring CreatedBy="UnitTest" Created="${created}">
  <Interface Type="Tunnelling" IndividualAddress="1.1.1" UserID="5" Password="${ifacePasswordEnc}" Authentication="${ifaceAuthEnc}">
    <Group Address="1/2/3" Senders="1.1.1 1.1.10" />
  </Interface>
  <Backbone Key="${backboneKeyEnc}" Latency="20" MulticastAddress="224.0.23.12" />
  <GroupAddresses>
    <Group Address="1/2/3" Key="${groupKeyEnc}" />
  </GroupAddresses>
  <Devices>
    <Device IndividualAddress="1.1.10" ToolKey="${toolKeyEnc}" ManagementPassword="${mgmtPasswordEnc}" Authentication="${deviceAuthEnc}" SequenceNumber="42" SerialNumber="12345678" />
  </Devices>
</Keyring>`;

function signKeyringXml(xml: string, pwd: string): string {
  const pwdHash = deriveKeyringPasswordKey(pwd);
  const { computed } = computeKeyringSignatureFromXml(xml, pwdHash);
  return xml.replace(/<Keyring\b/, `<Keyring Signature="${computed.toString("base64")}"`);
}

describe("KnxKeyring (.knxkeys zero-dependency reader)", () => {
  test("verifies signature and decrypts interfaces, backbone, group addresses, and devices", () => {
    const signedXml = signKeyringXml(unsignedKeyringXml, password);
    const keyring = KnxKeyring.fromSource(signedXml, password);

    expect(keyring.createdBy).toBe("UnitTest");
    expect(keyring.created).toBe(created);

    const iface = keyring.getInterface("1.1.1");
    expect(iface).toBeDefined();
    expect(iface?.userId).toBe(5);
    expect(iface?.decryptedPassword).toBe("ifPass123");
    expect(iface?.decryptedAuthentication).toBe("ifAuth456");
    expect(iface?.groupAddresses.get("1/2/3")).toEqual(["1.1.1", "1.1.10"]);

    const bb = keyring.getBackbone();
    expect(bb?.decryptedKey?.toString("hex")).toBe("8899aabbccddeeff0011223344556677");
    expect(bb?.latency).toBe(20);
    expect(bb?.multicastAddress).toBe("224.0.23.12");

    const group = keyring.getGroupAddresses().get("1/2/3");
    expect(group?.decryptedKey?.toString("hex")).toBe("00112233445566778899aabbccddeeff");

    const dev = keyring.getDevice("1.1.10");
    expect(dev?.decryptedToolKey?.toString("hex")).toBe("aabbccddeeff00112233445566778899");
    expect(dev?.decryptedManagementPassword).toBe("devMgmt789");
    expect(dev?.decryptedAuthentication).toBe("devAuth987");
    expect(dev?.sequenceNumber).toBe(42);
    expect(dev?.serialNumber).toBe("12345678");
  });

  test("rejects wrong keyring password or modified XML", () => {
    const signedXml = signKeyringXml(unsignedKeyringXml, password);
    expect(() => KnxKeyring.fromSource(signedXml, "wrongPassword")).toThrow(/signature verification failed/);

    const tamperedXml = signedXml.replace('Latency="20"', 'Latency="30"');
    expect(() => KnxKeyring.fromSource(tamperedXml, password)).toThrow(/signature verification failed/);
  });

  test("loads real ETS 6.3.1 .knxkeys archive if available", () => {
    const etsFile = "F:\\Proyectos\\KNXUltimate\\documents\\Secure Test.knxkeys";
    if (!fs.existsSync(etsFile)) return;

    const keyring = KnxKeyring.fromSource(etsFile, "passwordprogetto");
    const iface = keyring.getInterface();
    expect(iface).toBeDefined();
    expect(iface?.decryptedAuthentication).toBe("codiceautenticazione");

    expect(() => KnxKeyring.fromSource(etsFile, "wrongPassword")).toThrow(/signature verification failed/);
  });

  test("builds and exports standards-compliant .knxkeys XML with exact ETS AES-128-CBC ciphertext & signature", () => {
    const kr = KnxKeyring.create({
      project: "UnitProject",
      createdBy: "KNX.ts Test",
      created,
    });
    kr.setBackbone({
      multicastAddress: "224.0.23.12",
      latency: 20,
      key: "8899aabbccddeeff0011223344556677",
    });
    kr.setGroupKey("1/2/3", "00112233445566778899aabbccddeeff");
    kr.setDevice({
      individualAddress: "1.1.10",
      toolKey: "aabbccddeeff00112233445566778899",
      managementPassword: "devMgmt789",
      authentication: "devAuth987",
      sequenceNumber: 280081012481n,
      serialNumber: Buffer.from("0071001B7C5D", "hex"),
    });
    kr.setInterface({
      individualAddress: "1.1.1",
      type: "Tunnelling",
      host: "1.1.0",
      userId: 5,
      password: "ifPass123",
      authentication: "ifAuth456",
    });
    kr.addInterfaceGroupSender("1.1.1", "1/2/3", ["1.1.10", "1.1.1"]);

    const xml = kr.toXml(password, { created });
    // Verify exact byte-for-byte AES-128-CBC compatibility with reference ETS ciphertexts
    expect(xml).toContain(`Key="${backboneKeyEnc}"`);
    expect(xml).toContain(`Key="${groupKeyEnc}"`);
    expect(xml).toContain(`ToolKey="${toolKeyEnc}"`);
    expect(xml).toContain('xmlns="http://knx.org/xml/keyring/1"');
    expect(xml).toContain('Project="UnitProject"');

    // Round-trip via XML buffer (with UTF-8 BOM like ETS)
    const xmlBuf = kr.toBuffer(password, { format: "xml" });
    expect(xmlBuf[0]).toBe(0xef);
    expect(xmlBuf[1]).toBe(0xbb);
    expect(xmlBuf[2]).toBe(0xbf);

    const reloaded = KnxKeyring.fromSource(xmlBuf, password);
    expect(reloaded.project).toBe("UnitProject");
    expect(reloaded.createdBy).toBe("KNX.ts Test");
    expect(reloaded.getBackbone()?.decryptedKey?.toString("hex")).toBe("8899aabbccddeeff0011223344556677");
    expect(reloaded.getGroupKey("1/2/3")?.toString("hex")).toBe("00112233445566778899aabbccddeeff");
    expect(reloaded.getDevice("1.1.10")?.decryptedToolKey?.toString("hex")).toBe("aabbccddeeff00112233445566778899");
    expect(reloaded.getDevice("1.1.10")?.decryptedManagementPassword).toBe("devMgmt789");
    expect(reloaded.getDevice("1.1.10")?.decryptedAuthentication).toBe("devAuth987");
    expect(reloaded.getDevice("1.1.10")?.sequenceNumberBigInt).toBe(280081012481n);
    expect(reloaded.getDevice("1.1.10")?.serialNumber).toBe("0071001B7C5D");
    expect(reloaded.getInterface("1.1.1")?.decryptedPassword).toBe("ifPass123");
    expect(reloaded.getInterface("1.1.1")?.decryptedAuthentication).toBe("ifAuth456");
    expect(reloaded.getInterface("1.1.1")?.host).toBe("1.1.0");
    expect(reloaded.getGroupSenders("1/2/3")).toEqual(["1.1.1", "1.1.10"]);

    expect(() => KnxKeyring.fromSource(xmlBuf, "wrongPassword")).toThrow(/signature verification failed/);
  });

  test("exports valid ZIP archive, ETS5 integer GA format, saveFile(), and random key generation", () => {
    const kr = KnxKeyring.create({ project: "ZipTest" });
    const k1 = kr.ensureGroupKey("1/0/1");
    expect(k1.length).toBe(16);
    expect(kr.ensureGroupKey("1/0/1").equals(k1)).toBe(true); // idempotent
    const dev = kr.setDevice({ individualAddress: "1.1.2", toolKey: "generate", sequenceNumber: 500n });
    expect(dev.decryptedToolKey?.length).toBe(16);

    // Export as ZIP with ETS5 integer group addresses
    const zipBuf = kr.toBuffer("Secret#123", { format: "zip", groupAddressFormat: "integer" });
    expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50); // PK\x03\x04 ZIP header

    const fromZip = KnxKeyring.fromSource(zipBuf, "Secret#123");
    expect(fromZip.getGroupAddress("2049")?.address).toBe("2049");
    expect(fromZip.getGroupKey("1/0/1")?.equals(k1)).toBe(true);
    expect(fromZip.getDeviceToolKey("1.1.2")?.equals(dev.decryptedToolKey!)).toBe(true);
    expect(fromZip.getDevice("1.1.2")?.sequenceNumberBigInt).toBe(500n);

    // Verify saveFile round-trip
    const tmpFile = path.join(os.tmpdir(), `knxts-test-${Date.now()}.knxkeys`);
    try {
      kr.saveFile(tmpFile, "FilePass!");
      const loadedFromDisk = KnxKeyring.fromSource(tmpFile, "FilePass!");
      expect(loadedFromDisk.getGroupKey("1/0/1")?.equals(k1)).toBe(true);
      expect(loadedFromDisk.getDeviceToolKey("1.1.2")?.equals(dev.decryptedToolKey!)).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test("synchronizes live keys and 48-bit sequence numbers between KnxDataSecure and KnxKeyring", () => {
    const ds = new KnxDataSecure({
      sourceAddress: "1.1.200",
      initialSequenceNumber: 9000n,
      groupKeys: { "1/0/1": "11223344556677889900aabbccddeeff" },
      deviceToolKeys: { "1.1.1": "ffeeddccbbaa00998877665544332211" },
    });
    ds.setLastValidSequenceNumber("1.1.1", 280081013561n);
    ds.setDeviceSerialNumber("1.1.1", "0071001B7C5D");

    const kr = KnxKeyring.create({ project: "SyncDemo" }).syncFromDataSecure(ds);
    const exported = kr.toBuffer("SyncPass");

    // Reimport into a brand-new KnxDataSecure instance
    const ds2 = new KnxDataSecure({ keyringFile: exported, keyringPassword: "SyncPass" });
    expect(ds2.getGroupKey("1/0/1")?.toString("hex")).toBe("11223344556677889900aabbccddeeff");
    expect(ds2.getDeviceToolKey("1.1.1")?.toString("hex")).toBe("ffeeddccbbaa00998877665544332211");
    // Device/@SequenceNumber = lastValid + 1, and loadFromKeyring sets lastValid = SequenceNumber - 1 -> exact match!
    expect(ds2.getLastValidSequenceNumber("1.1.1")).toBe(280081013561n);
    expect(ds2.getDeviceSerialNumber("1.1.1")?.toString("hex").toUpperCase()).toBe("0071001B7C5D");
  });

  test("loads real ETS 5.7.7 PRUEBA-ACTUALIZADO.knxkeys, edits it, and re-exports under a new password", () => {
    const realFile = path.resolve(__dirname, "../testKey/PRUEBA-ACTUALIZADO.knxkeys");
    if (!fs.existsSync(realFile)) return;

    const kr = KnxKeyring.fromSource(realFile, "123456789");
    expect(kr.project).toBe("PRUEBA");
    const origKey = kr.getGroupKey("1/0/1")!;
    const origToolKey = kr.getDeviceToolKey("1.1.1")!;
    expect(origKey.length).toBe(16);
    expect(origToolKey.length).toBe(16);

    // Add a brand-new device and group address, then re-export with a different password
    const newGaKey = kr.setGroupKey("2/0/1");
    kr.setDevice({ individualAddress: "1.1.99", toolKey: "generate", sequenceNumber: 12345n });
    kr.addInterfaceGroupSender("1.1.200", "2/0/1", "1.1.99");

    const reExported = kr.toBuffer("NewExportPassword2026");
    const reloaded = KnxKeyring.fromSource(reExported, "NewExportPassword2026");

    expect(reloaded.project).toBe("PRUEBA");
    expect(reloaded.getGroupKey("1/0/1")?.equals(origKey)).toBe(true);
    expect(reloaded.getDeviceToolKey("1.1.1")?.equals(origToolKey)).toBe(true);
    expect(reloaded.getGroupKey("2/0/1")?.equals(newGaKey)).toBe(true);
    expect(reloaded.getDevice("1.1.99")?.sequenceNumberBigInt).toBe(12345n);
    expect(reloaded.getGroupSenders("2/0/1")).toContain("1.1.99");
  });
});
