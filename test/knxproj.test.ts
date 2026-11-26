import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { computeCrc32, deriveEts6ZipPassword, KnxProject, ZipReader, ZipWriter } from "../src";

// ============================================================================
// Synthetic Encrypted ZIP Helpers (for testing ETS5 ZipCrypto & ETS6 WinZip AES-256)
// ============================================================================

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC32_TABLE[i] = c >>> 0;
}
function crc32Byte(crc: number, byte: number): number {
  return (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
}

function buildZipCryptoArchive(entries: { name: string; content: Buffer }[], password: string): Buffer {
  const pwdBytes = Buffer.from(password, "utf8");
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBuf = Buffer.from(item.name, "utf8");
    const crc = computeCrc32(item.content);
    const deflated = zlib.deflateRawSync(item.content);

    let k0 = 0x12345678;
    let k1 = 0x23456789;
    let k2 = 0x34567890;
    const updateKeys = (b: number) => {
      k0 = crc32Byte(k0, b);
      k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
      k2 = crc32Byte(k2, (k1 >>> 24) & 0xff);
    };
    const keystreamByte = () => {
      const t = (k2 | 2) & 0xffff;
      return ((t * (t ^ 1)) >>> 8) & 0xff;
    };
    for (const b of pwdBytes) updateKeys(b);

    const header = Buffer.alloc(12, 0x42);
    header[11] = (crc >>> 24) & 0xff;
    const encrypted = Buffer.alloc(12 + deflated.length);
    for (let i = 0; i < 12; i++) {
      const p = header[i];
      encrypted[i] = p ^ keystreamByte();
      updateKeys(p);
    }
    for (let i = 0; i < deflated.length; i++) {
      const p = deflated[i];
      encrypted[12 + i] = p ^ keystreamByte();
      updateKeys(p);
    }

    const flags = 0x0801; // encrypted + UTF-8
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(encrypted.length, 18);
    lfh.writeUInt32LE(item.content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(lfh, 30);

    const cdfh = Buffer.alloc(46 + nameBuf.length);
    cdfh.writeUInt32LE(0x02014b50, 0);
    cdfh.writeUInt16LE(20, 4);
    cdfh.writeUInt16LE(20, 6);
    cdfh.writeUInt16LE(flags, 8);
    cdfh.writeUInt16LE(8, 10);
    cdfh.writeUInt32LE(crc, 16);
    cdfh.writeUInt32LE(encrypted.length, 20);
    cdfh.writeUInt32LE(item.content.length, 24);
    cdfh.writeUInt16LE(nameBuf.length, 28);
    cdfh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdfh, 46);

    localChunks.push(lfh, encrypted);
    centralChunks.push(cdfh);
    offset += lfh.length + encrypted.length;
  }

  const cdSize = centralChunks.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

function buildWinZipAes256Archive(entries: { name: string; content: Buffer }[], zipPassword: string): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBuf = Buffer.from(item.name, "utf8");
    const deflated = zlib.deflateRawSync(item.content);
    const salt = crypto.randomBytes(16);
    const derived = crypto.pbkdf2Sync(Buffer.from(zipPassword, "utf8"), salt, 1000, 66, "sha1");
    const encKey = derived.subarray(0, 32);
    const hmacKey = derived.subarray(32, 64);
    const pwdVerify = derived.subarray(64, 66);

    const cipherText = Buffer.allocUnsafe(deflated.length);
    const ecb = crypto.createCipheriv("aes-256-ecb", encKey, null);
    ecb.setAutoPadding(false);
    const ctr = Buffer.alloc(16, 0);
    let blockNum = 1n;
    for (let off = 0; off < deflated.length; off += 16) {
      ctr.writeBigUInt64LE(blockNum, 0);
      blockNum += 1n;
      const ks = ecb.update(ctr);
      const len = Math.min(16, deflated.length - off);
      for (let j = 0; j < len; j++) cipherText[off + j] = deflated[off + j] ^ ks[j];
    }
    const authCode = crypto.createHmac("sha1", hmacKey).update(cipherText).digest().subarray(0, 10);
    const payload = Buffer.concat([salt, pwdVerify, cipherText, authCode]);

    // WinZip AES extra field (0x9901, 7 bytes: ver=2, "AE", strength=3 (AES-256), actualMethod=8)
    const aesExtra = Buffer.alloc(11);
    aesExtra.writeUInt16LE(0x9901, 0);
    aesExtra.writeUInt16LE(7, 2);
    aesExtra.writeUInt16LE(2, 4);
    aesExtra.write("AE", 6, "ascii");
    aesExtra.writeUInt8(3, 8);
    aesExtra.writeUInt16LE(8, 9);

    const flags = 0x0801;
    const lfh = Buffer.alloc(30 + nameBuf.length + aesExtra.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(51, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(99, 8); // WinZip AES
    lfh.writeUInt32LE(0, 14); // AE-2 uses CRC=0
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(item.content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(aesExtra.length, 28);
    nameBuf.copy(lfh, 30);
    aesExtra.copy(lfh, 30 + nameBuf.length);

    const cdfh = Buffer.alloc(46 + nameBuf.length + aesExtra.length);
    cdfh.writeUInt32LE(0x02014b50, 0);
    cdfh.writeUInt16LE(51, 4);
    cdfh.writeUInt16LE(51, 6);
    cdfh.writeUInt16LE(flags, 8);
    cdfh.writeUInt16LE(99, 10);
    cdfh.writeUInt32LE(0, 16);
    cdfh.writeUInt32LE(payload.length, 20);
    cdfh.writeUInt32LE(item.content.length, 24);
    cdfh.writeUInt16LE(nameBuf.length, 28);
    cdfh.writeUInt16LE(aesExtra.length, 30);
    cdfh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdfh, 46);
    aesExtra.copy(cdfh, 46 + nameBuf.length);

    localChunks.push(lfh, payload);
    centralChunks.push(cdfh);
    offset += lfh.length + payload.length;
  }

  const cdSize = centralChunks.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

// ============================================================================
// 1. ZipWriter & ZipReader (Passthrough, UTF-8, ZipCrypto, WinZip AES-256)
// ============================================================================

describe("ZipWriter & ZipReader", () => {
  test("creates ZIP with UTF-8 names, Store/Deflate, and fast raw passthrough copy", () => {
    const w1 = new ZipWriter();
    w1.addText("dir/español.xml", "<KNX>Hola Ñandú</KNX>", { bom: true });
    w1.addBuffer("small.bin", Buffer.from([1, 2, 3, 4]), { compress: false });
    const bigPayload = Buffer.from("KNX-PROJECT-REPEATING-DATA-".repeat(2000), "utf8");
    w1.addBuffer("big.xml", bigPayload, { compress: true });

    const buf1 = w1.toBuffer();
    const r1 = ZipReader.fromBuffer(buf1);
    expect(r1.readEntryText("dir/español.xml")).toBe("<KNX>Hola Ñandú</KNX>");
    expect(r1.readEntryBuffer("small.bin")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(r1.readEntryBuffer("big.xml")).toEqual(bigPayload);
    expect(r1.getEntry("big.xml")!.compressionMethod).toBe(8);
    expect(r1.getEntry("big.xml")!.crc32).toBe(computeCrc32(bigPayload));

    // Raw passthrough copy into a new ZIP
    const w2 = new ZipWriter();
    w2.copyEntryFrom(r1, "big.xml");
    w2.addText("added.txt", "modified");
    const r2 = ZipReader.fromBuffer(w2.toBuffer());
    expect(r2.readEntryBuffer("big.xml")).toEqual(bigPayload);
    expect(r2.readEntryText("added.txt")).toBe("modified");
  });

  test("decrypts ETS5 ZipCrypto and ETS6 WinZip AES-256 password-protected .knxproj archives", () => {
    const baseProj = KnxProject.create({ name: "Protected Project", projectId: "P-ABCD" });
    baseProj.addGroupAddress({ address: "1/2/3", name: "Secret Light", datapointType: "1.001" });
    const rawArchive = ZipReader.fromBuffer(baseProj.toKnxProjBuffer());
    const projXml = rawArchive.readEntryBuffer("P-ABCD/project.xml");
    const instXml = rawArchive.readEntryBuffer("P-ABCD/0.xml");
    const masterXml = rawArchive.readEntryBuffer("knx_master.xml");

    // A) ETS5 style (ZipCrypto inner P-ABCD.zip)
    const ets5Inner = buildZipCryptoArchive(
      [
        { name: "project.xml", content: projXml },
        { name: "0.xml", content: instXml },
      ],
      "MyETS5Pass!",
    );
    const ets5Outer = new ZipWriter()
      .addBuffer("P-ABCD.zip", ets5Inner, { compress: false })
      .addBuffer("knx_master.xml", masterXml)
      .toBuffer();

    expect(() => KnxProject.fromBuffer(ets5Outer)).toThrow(/password-protected/i);
    expect(() => KnxProject.fromBuffer(ets5Outer, { password: "WrongPassword" })).toThrow(/decrypt/i);
    const openedEts5 = KnxProject.fromBuffer(ets5Outer, { password: "MyETS5Pass!" });
    expect(openedEts5.getProjectInfo().name).toBe("Protected Project");
    expect(openedEts5.getMetadata().isPasswordProtected).toBe(true);
    expect(openedEts5.getGroupAddress("1/2/3")?.name).toBe("Secret Light");

    // B) ETS6 style (WinZip AES-256 with PBKDF2-HMAC-SHA256 salt "21.ets.knx.org")
    const ets6Password = "MyETS6Secret#2026";
    const ets6Inner = buildWinZipAes256Archive(
      [
        { name: "project.xml", content: projXml },
        { name: "0.xml", content: instXml },
      ],
      deriveEts6ZipPassword(ets6Password),
    );
    const ets6Outer = new ZipWriter()
      .addBuffer("P-ABCD.zip", ets6Inner, { compress: false })
      .addBuffer("knx_master.xml", masterXml)
      .toBuffer();

    expect(() => KnxProject.fromBuffer(ets6Outer, { password: "Wrong" })).toThrow(/decrypt/i);
    const openedEts6 = KnxProject.fromBuffer(ets6Outer, { password: ets6Password });
    expect(openedEts6.getProjectInfo().name).toBe("Protected Project");
    expect(openedEts6.getGroupAddress("1/2/3")?.dpt?.formatted).toBe("1.001");
  });
});

// ============================================================================
// 2. Creating, Modifying, Validating & Exporting Projects From Scratch
// ============================================================================

describe("KnxProject create, CRUD, validate & multi-format export", () => {
  test("creates a complete project from scratch, round-trips .knxproj, JSON, GA XML, CSV & Keyring", () => {
    const project = KnxProject.create({
      name: "Edificio Inteligente",
      projectId: "P-1001",
      groupAddressStyle: "ThreeLevel",
      comment: "Proyecto creado por API KNX.ts",
    });

    // Topology
    const area2 = project.addArea({ address: 2, name: "Torre Norte", createMainLine: true });
    const line21 = project.addLine(area2.id, { address: 1, name: "Piso 1 TP", mediumTypeRefId: "MT-0" });
    expect(line21.address).toBe(1);

    // Locations & Trades
    const bldg = project.addSpace({ type: "Building", name: "Sede Principal" });
    const floor1 = project.addSpace({ type: "Floor", name: "Piso 1", parentSpaceId: bldg.id });
    const room101 = project.addSpace({ type: "Room", name: "Sala 101", parentSpaceId: floor1.id, usage: "SU-4" });
    const tradeLighting = project.addTrade({ name: "Iluminación" });

    // Group Ranges & Group Addresses
    project.addMainGroup(1, "Iluminación");
    project.addMiddleGroup(1, 0, "Encendido");
    const gaCmd = project.addGroupAddress({
      address: "1/0/1",
      name: "Sala 101 - On/Off",
      datapointType: "1.001",
      description: "Comando luz principal",
      security: "On",
      key: "00112233445566778899AABBCCDDEEFF",
    });
    const gaStatus = project.addGroupAddress({
      address: "1/0/2",
      name: "Sala 101 - Estado",
      datapointType: "DPST-1-11",
    });
    expect(gaCmd.address).toBe(2049);
    expect(gaCmd.dpt?.formatted).toBe("1.001");
    expect(gaCmd.rangePath).toBe("Iluminación / Encendido");

    // Function inside Space
    project.addFunction(room101.id, {
      name: "Luz Techo 101",
      type: "FT-1",
      groupAddresses: [
        { address: "1/0/1", role: "SwitchOnOff" },
        { address: "1/0/2", role: "InfoOnOff" },
      ],
    });

    // Devices
    const devActuator = project.addDevice("1.1", {
      address: 1,
      name: "Actuador Luces",
      description: "TAB-P1",
      productRefId: "M-0071_H-TEST-1_P-TEST",
      hardware2ProgramRefId: "M-0071_H-TEST-1_HP-1234-10-ABCD",
      serialNumber: "007100112233",
      spaceId: room101.id,
      tradeId: tradeLighting.id,
      ipConfig: { ipAddress: "192.168.1.50", macAddress: "AA:BB:CC:DD:EE:FF" },
      security: { toolKey: "FFEEDDCCBBAA99887766554433221100", deviceManagementPassword: "secret" },
    });
    const devKeypad = project.addDevice("1.1", {
      address: "auto",
      name: "Pulsador 101",
      spaceId: room101.id,
    });
    expect(devActuator.individualAddress).toBe("1.1.1");
    expect(devActuator.serialNumberHex).toBe("007100112233");
    expect(devKeypad.individualAddress).toBe("1.1.2");

    // Parameters & Links
    project.setDeviceParameters("1.1.1", {
      "M-0071_A-1234-10-ABCD_P-1_R-1": 1,
      "M-0071_A-1234-10-ABCD_P-2_R-2": "Sala",
    });
    project.linkComObjectToGroupAddress("1.1.1", "O-1_R-1", "1/0/1", { asSending: true });
    project.linkComObjectToGroupAddress("1.1.1", "O-2_R-2", "1/0/2", { asSending: true });
    project.linkComObjectToGroupAddress("1.1.2", "O-1_R-1", "1/0/1", { asSending: true });
    project.linkComObjectToGroupAddress("1.1.2", "O-1_R-1", "1/0/2");

    // Reverse lookup & Communication Matrix
    const links101 = project.getGroupAddressLinks("1/0/1");
    expect(links101).toHaveLength(2);
    expect(links101.map((l) => l.individualAddress).sort()).toEqual(["1.1.1", "1.1.2"]);

    const matrix = project.getCommunicationMatrix({ linkedOnly: true });
    expect(matrix).toHaveLength(2);

    // Search & Validation
    expect(project.search("Sala 101").groupAddresses).toHaveLength(2);
    expect(project.validate().valid).toBe(true);

    // Export to .knxproj and re-parse!
    const knxprojBuf = project.toKnxProjBuffer();
    const reloaded = KnxProject.fromBuffer(knxprojBuf, {}, "edificio.knxproj");
    expect(reloaded.getProjectInfo().name).toBe("Edificio Inteligente");
    expect(reloaded.getProjectInfo().id).toBe("P-1001");
    expect(reloaded.getDevices()).toHaveLength(2);
    expect(reloaded.getDeviceDetailsSync("1.1.1").serialNumberHex).toBe("007100112233");
    expect(reloaded.getDeviceDetailsSync("1.1.1").ipConfig?.macAddress).toBe("AA:BB:CC:DD:EE:FF");
    expect(reloaded.getDeviceDetailsSync("1.1.1").locationPath).toBe("Sede Principal / Piso 1 / Sala 101");
    expect(reloaded.getDeviceDetailsSync("1.1.1").parameters).toHaveLength(2);
    expect(reloaded.getDeviceDetailsSync("1.1.2").comObjects[0].groupAddresses).toEqual(["1/0/1", "1/0/2"]);
    expect(reloaded.getFunctions()).toHaveLength(1);
    expect(reloaded.getTrades()[0].deviceInstanceRefs).toEqual([devActuator.id]);
    expect(reloaded.validate().valid).toBe(true);

    // Export ETS Group Address XML & CSV
    const gaXml = reloaded.exportGroupAddressesXml();
    expect(gaXml).toContain('xmlns="http://knx.org/xml/ga-export/01"');
    expect(gaXml).toContain('Address="1/0/1"');
    expect(gaXml).toContain('DPTs="DPST-1-1"');

    const gaCsv = reloaded.exportGroupAddressesCsv({ separator: ";" });
    expect(gaCsv).toContain("Iluminación;Encendido;Sala 101 - On/Off;1/0/1");

    // Export Keyring (.knxkeys)
    const keyring = reloaded.exportKeyring();
    expect(keyring.getGroupKey("1/0/1")?.toString("hex").toUpperCase()).toBe("00112233445566778899AABBCCDDEEFF");
    expect(keyring.getDevice("1.1.1")?.decryptedToolKey?.toString("hex").toUpperCase()).toBe(
      "FFEEDDCCBBAA99887766554433221100",
    );

    // JSON round-trip
    const fromJson = KnxProject.fromJSON(reloaded.toJSON());
    expect(fromJson.getGroupAddress(gaStatus.id)?.name).toBe("Sala 101 - Estado");

    // Referential cleanup on delete & move
    const moved = reloaded.moveDevice("1.1.2", { area: 2, line: 1 }, 10);
    expect(moved.individualAddress).toBe("2.1.10");
    expect(reloaded.removeGroupAddress("1/0/2")).toBe(true);
    expect(reloaded.getDeviceDetailsSync("2.1.10").comObjects[0].groupAddresses).toEqual(["1/0/1"]);
    expect(reloaded.removeDevice("1.1.1")).toBe(true);
    expect(reloaded.getSpace(room101.id)?.deviceInstanceRefs).toEqual([devKeypad.id]);
    expect(reloaded.validate().valid).toBe(true);
  });

  test("exports password-protected .knxproj (ETS5 ZipCrypto & ETS6 WinZip AES-256) with UserFiles, History & Multi-Installation", () => {
    const project = KnxProject.create({ name: "Proyecto Cifrado", projectId: "P-9900", schemaVersion: 21 });
    project.addGroupAddress({ address: "2/1/5", name: "Clima Principal", datapointType: "9.001" });
    project.addUserFile("notas/resumen.txt", "Manual de instalación KNX", "Documentación");
    project.addHistoryEntry({ user: "arnold", text: "Versión 1.0 creada", detail: "Con cifrado" });

    // Second installation
    const inst2 = project.addInstallation({ name: "Anexo", createDefaultTopology: true });
    expect(inst2.installationId).toBe("1");
    project.addGroupAddress({ address: "3/0/1", name: "Anexo Luz" }, "1");

    // A) ETS6 WinZip AES-256 export & round-trip
    const ets6Buf = project.toKnxProjBuffer({ password: "ETS6-Secret#Password", encryption: "ets6" });
    const outerEts6 = ZipReader.fromBuffer(ets6Buf);
    expect(outerEts6.hasEntry("P-9900.zip")).toBe(true);
    expect(outerEts6.hasEntry("P-9900/project.xml")).toBe(false);

    expect(() => KnxProject.fromBuffer(ets6Buf)).toThrow(/password-protected/i);
    expect(() => KnxProject.fromBuffer(ets6Buf, { password: "Wrong" })).toThrow(/decrypt/i);
    const opened6 = KnxProject.fromBuffer(ets6Buf, { password: "ETS6-Secret#Password" });
    expect(opened6.getMetadata().isPasswordProtected).toBe(true);
    expect(opened6.getGroupAddress("2/1/5")?.name).toBe("Clima Principal");
    expect(opened6.getInstallations()).toHaveLength(2);
    expect(opened6.getGroupAddress("3/0/1", "1")?.name).toBe("Anexo Luz");
    expect(opened6.readUserFile("notas/resumen.txt").toString("utf8")).toBe("Manual de instalación KNX");
    expect(opened6.getHistoryEntries()[0].user).toBe("arnold");

    // B) ETS5 ZipCrypto export & round-trip
    const ets5Buf = opened6.toKnxProjBuffer({
      password: "ETS5-LegacyPassword",
      encryption: "ets5",
      targetSchemaVersion: 20,
    });
    expect(() => KnxProject.fromBuffer(ets5Buf, { password: "Wrong" })).toThrow(/decrypt/i);
    const opened5 = KnxProject.fromBuffer(ets5Buf, { password: "ETS5-LegacyPassword" });
    expect(opened5.getGroupAddress("2/1/5")?.dpt?.formatted).toBe("9.001");
    expect(opened5.readUserFile("notas/resumen.txt").toString("utf8")).toBe("Manual de instalación KNX");

    // Cleanup userFile & installation
    expect(opened5.removeUserFile("notas/resumen.txt")).toBe(true);
    expect(opened5.listUserFiles()).toHaveLength(0);
    expect(opened5.removeInstallation("1")).toBe(true);
    expect(opened5.getInstallations()).toHaveLength(1);
  });

  test("computes automatic KNX Line & Area Coupler Filter Tables + BusInterfaces & AdditionalAddresses CRUD", () => {
    const project = KnxProject.create({ name: "Filtro Topología" });
    project.addLine(1, { address: 2, name: "Line 1.2" });
    const area2 = project.addArea({ address: 2, name: "Area 2", createMainLine: true });
    project.addLine(area2.id, { address: 1, name: "Line 2.1" });

    // Devices on 1.1, 1.2, and 2.1
    project.addDevice("1.1", { address: 1, name: "Dev 1.1.1" });
    project.addDevice("1.1", { address: 2, name: "Dev 1.1.2" });
    project.addDevice("1.2", { address: 1, name: "Dev 1.2.1" });
    project.addDevice("2.1", { address: 1, name: "Dev 2.1.1" });

    // 4 Group Addresses with distinct routing behaviors:
    project.addGroupAddress({ address: "1/0/1", name: "Intra-line 1.1 only" }); // addr 2049
    project.addGroupAddress({ address: "1/0/2", name: "Cross-line 1.1 <-> 1.2" }); // addr 2050
    project.addGroupAddress({ address: "1/0/3", name: "Cross-area 1.1 <-> 2.1" }); // addr 2051
    project.addGroupAddress({ address: "1/0/4", name: "Unfiltered Global", unfiltered: true }); // addr 2052

    // Intra-line only (1.1.1 <-> 1.1.2) -> must NOT appear in any coupler filter table
    project.linkComObjectToGroupAddress("1.1.1", "O-1_R-1", "1/0/1", { asSending: true });
    project.linkComObjectToGroupAddress("1.1.2", "O-1_R-1", "1/0/1");
    // Cross-line within Area 1 (1.1.1 <-> 1.2.1) -> routed by 1.1.0 & 1.2.0, NOT area couplers!
    project.linkComObjectToGroupAddress("1.1.1", "O-2_R-2", "1/0/2", { asSending: true });
    project.linkComObjectToGroupAddress("1.2.1", "O-2_R-2", "1/0/2");
    // Cross-area (1.1.1 <-> 2.1.1) -> routed by 1.1.0, 2.1.0, 1.0.0, 2.0.0!
    project.linkComObjectToGroupAddress("1.1.1", "O-3_R-3", "1/0/3", { asSending: true });
    project.linkComObjectToGroupAddress("2.1.1", "O-3_R-3", "1/0/3");
    // Manual AdditionalGroupAddress on Line 1.2
    project.addLineAdditionalGroupAddress("1.2", "5/0/1");

    // BusInterfaces & AdditionalAddresses on IP gateway 1.1.1
    project.setDeviceBusInterface("1.1.1", {
      refId: "M-0071_H-IP_BI-1",
      name: "Tunnel 1",
      connectors: ["1/0/1"],
    });
    project.addDeviceAdditionalAddress("1.1.1", { address: 240, name: "Tunnel Slot 1" });

    const tables = project.computeFilterTables();
    const lc11 = tables.lineCouplers.find((c) => c.couplerAddress === "1.1.0")!;
    const lc12 = tables.lineCouplers.find((c) => c.couplerAddress === "1.2.0")!;
    const lc21 = tables.lineCouplers.find((c) => c.couplerAddress === "2.1.0")!;
    const ac1 = tables.areaCouplers.find((c) => c.couplerAddress === "1.0.0")!;
    const ac2 = tables.areaCouplers.find((c) => c.couplerAddress === "2.0.0")!;

    expect(lc11.groupAddresses.map((g) => g.addressFormatted)).toEqual(["1/0/2", "1/0/3", "1/0/4"]);
    expect(lc12.groupAddresses.map((g) => g.addressFormatted)).toEqual(["1/0/2", "1/0/4", "5/0/1"]);
    expect(lc21.groupAddresses.map((g) => g.addressFormatted)).toEqual(["1/0/3", "1/0/4"]);
    expect(ac1.groupAddresses.map((g) => g.addressFormatted)).toEqual(["1/0/3", "1/0/4"]);
    expect(ac2.groupAddresses.map((g) => g.addressFormatted)).toEqual(["1/0/3", "1/0/4"]);

    // Verify 8192-byte KNX filter table bitmask sets bit 2050 (1/0/2) and clears bit 2049 (1/0/1) on 1.1.0
    const maskBuf = Buffer.from(lc11.filterTableBitmaskHex, "hex");
    expect(maskBuf.length).toBe(8192);
    expect((maskBuf[2049 >> 3] >> (2049 & 7)) & 1).toBe(0);
    expect((maskBuf[2050 >> 3] >> (2050 & 7)) & 1).toBe(1);
    expect((maskBuf[2051 >> 3] >> (2051 & 7)) & 1).toBe(1);

    // Round-trip BusInterfaces, AdditionalAddresses & AdditionalGroupAddresses
    const reloaded = KnxProject.fromBuffer(project.toKnxProjBuffer());
    expect(reloaded.getDeviceBusInterfaces("1.1.1")).toHaveLength(1);
    expect(reloaded.getDeviceBusInterfaces("1.1.1")[0].connectors).toHaveLength(1);
    expect(reloaded.getDeviceDetailsSync("1.1.1").additionalAddresses[0].address).toBe(240);
    expect(reloaded.getLineAdditionalGroupAddresses("1.2")[0].addressFormatted).toBe("5/0/1");
  });

  test("supports ETS6 <Segment> topology and TwoLevel / Free GroupAddressStyle", () => {
    const project = KnxProject.create({ name: "ETS6 Test", groupAddressStyle: "TwoLevel", schemaVersion: 22 });
    project.addSegment("1.1", { number: 0, name: "Main Segment" });
    project.addSegment("1.1", { number: 1, name: "Sub Segment" });
    const d1 = project.addDevice("1.1", { address: 5, name: "Seg0 Dev", segmentNumber: 0 });
    const d2 = project.addDevice("1.1", { address: 6, name: "Seg1 Dev", segmentNumber: 1 });
    expect(d1.segmentNumber).toBe(0);
    expect(d2.segmentNumber).toBe(1);

    const ga = project.addGroupAddress({ address: "2/300", name: "TwoLevel GA" });
    expect(ga.addressFormatted).toBe("2/300");

    const reloaded = KnxProject.fromBuffer(project.toKnxProjBuffer());
    expect(reloaded.getMetadata().schemaVersion).toBe(22);
    expect(reloaded.getDeviceDetailsSync("1.1.5").segmentNumber).toBe(0);
    expect(reloaded.getDeviceDetailsSync("1.1.6").segmentNumber).toBe(1);
    expect(reloaded.getGroupAddress("2/300")?.addressFormatted).toBe("2/300");
  });
});

// ============================================================================
// 3. Importing Real `.knxprod` into a New `.knxproj` + DeviceConfigSession Bridge
// ============================================================================

const MAXINBOX_PROD = path.resolve(__dirname, "../Ignore/[Cert.]_MAXinBOX_66_v3_2.1_EIFAItRUk.knxprod");
const RAILQUAD_PROD = path.resolve(__dirname, "../Ignore/[Cert.]_RailQUAD_8_v2_1.3_EIFAItRUk.knxprod");

describe("KnxProject .knxprod import & live DeviceConfigSession bridge", () => {
  const maybeTest = fs.existsSync(MAXINBOX_PROD) ? test : test.skip;

  maybeTest(
    "imports .knxprod catalogs into a new project, opens DeviceConfigSession, applies edits, and exports round-trip .knxproj",
    async () => {
      const project = KnxProject.create({ name: "Proyecto desde Cero con Zennio" });
      const imp1 = project.importKnxProd(MAXINBOX_PROD, "es-ES");
      expect(imp1.manufacturerId).toBe("M-0071");
      expect(imp1.productCount).toBeGreaterThan(0);
      expect(imp1.applicationIds.length).toBe(1);

      // Import a second Zennio .knxprod to test merging into existing M-0071 catalog
      if (fs.existsSync(RAILQUAD_PROD)) {
        const imp2 = project.importKnxProd(RAILQUAD_PROD, "es-ES");
        expect(imp2.mergedIntoExistingManufacturer).toBe(true);
        expect(project.listCatalogProducts("M-0071").length).toBeGreaterThanOrEqual(2);
      }

      const maxinboxProduct = project
        .listCatalogProducts("M-0071")
        .find((p) => p.applicationProgramRefIds.includes(imp1.applicationIds[0]))!;
      expect(maxinboxProduct).toBeDefined();

      // Add device to Line 1.1
      const dev = project.addDevice("1.1", {
        address: 1,
        name: "MAXinBOX Tablero 1",
        productRefId: maxinboxProduct.productRefId,
        hardware2ProgramRefId: maxinboxProduct.hardware2ProgramRefIds[0],
      });
      expect(dev.individualAddress).toBe("1.1.1");
      expect(dev.applicationProgramRefId).toBe(imp1.applicationIds[0]);

      // Open live DeviceConfigSession from the project!
      const session = await project.openDeviceSession("1.1.1", { language: "es-ES" });
      const ui1 = session.getUiState();
      expect(ui1.catalog.applicationId).toBe(imp1.applicationIds[0]);

      // Enable outputs & channel 1 (same as maxinbox_1_1_1.json) & link a ComObject
      session.setParameters({
        bOutput: 1,
        "outputCh[0].type": 1,
        "indOutput[0].bEnabled": 1,
      });
      const activeCom = session.findComObjects("Encender", { limit: 1 })[0] ?? session.getUiState().comObjects[0];
      expect(activeCom).toBeDefined();
      session.linkGroupObject(activeCom.number, { sending: "1/0/10" });

      // Apply session edits back into KnxProject (auto-creating GA 1/0/10 + regenerating GroupObjectTree)
      const applied = project.applyDeviceSession("1.1.1", session, { autoCreateGroupAddresses: true });
      expect(applied.updatedParameters).toBeGreaterThan(0);
      expect(applied.updatedComObjects).toBeGreaterThan(0);
      expect(applied.createdGroupAddresses).toContain("1/0/10");
      expect(project.getDeviceDetailsSync("1.1.1").groupObjectTree).toBeDefined();
      expect(project.hasOfficialMaskVersions()).toBe(true);

      // Export .knxproj and re-open it!
      const exportedBuf = project.toKnxProjBuffer();
      const reopened = KnxProject.fromBuffer(exportedBuf, { language: "es-ES" });
      expect(reopened.getGroupAddress("1/0/10")).toBeDefined();
      expect(reopened.getGroupAddressLinks("1/0/10")).toHaveLength(1);
      expect(reopened.getDeviceDetailsSync("1.1.1").groupObjectTree).toBeDefined();

      // Re-open DeviceConfigSession from the exported .knxproj and verify parameter & link persisted
      const reopenedSession = await reopened.openDeviceSession("1.1.1", { language: "es-ES" });
      const reopenedCom = reopenedSession.getUiState().comObjects.find((c) => c.number === activeCom.number);
      expect(reopenedCom?.sendingGroupAddress).toBe("1/0/10");
    },
    30000,
  );

  maybeTest(
    "supports lightweight project with user-supplied external catalog provider (embedApplicationXml: false) and setMasterXml()",
    async () => {
      const project = KnxProject.create({ name: "Proyecto Ligero con Catálogo Externo" });
      expect(project.hasOfficialMaskVersions()).toBe(false);

      const masterXmlPath = path.resolve(__dirname, "../test_xml/knx_master.xml");
      if (fs.existsSync(masterXmlPath)) {
        project.setMasterXml(masterXmlPath);
        expect(project.hasOfficialMaskVersions()).toBe(true);
      }

      const imp = project.importKnxProd(MAXINBOX_PROD, { language: "es-ES", embedApplicationXml: false });
      const prod = project.listCatalogProducts(imp.manufacturerId)[0];
      project.addDevice("1.1", {
        address: 5,
        name: "MAXinBOX Externo",
        productRefId: prod.productRefId,
        hardware2ProgramRefId: prod.hardware2ProgramRefIds[0],
      });

      // Verify exported .knxproj is tiny (< 500 KB) because 64 MB ApplicationProgram XML was NOT embedded
      const leanBuf = project.toKnxProjBuffer();
      expect(leanBuf.length).toBeLessThan(500 * 1024);

      const reopened = KnxProject.fromBuffer(leanBuf);
      expect(reopened.getDeviceDetailsSync("1.1.5").hasEmbeddedApplicationXml).toBe(false);

      // Register user-supplied external catalog provider
      reopened.registerCatalogProvider((appId) => (appId === imp.applicationIds[0] ? MAXINBOX_PROD : undefined));
      const session = await reopened.openDeviceSession("1.1.5", { language: "es-ES" });
      expect(session.getUiState().catalog.applicationId).toBe(imp.applicationIds[0]);
    },
    30000,
  );
});

// ============================================================================
// 4. Real ETS Sample `.knxproj` Files (Read, Enrich, Modify & Lossless Export)
// ============================================================================

const KNXPROJ_DIR = path.resolve(__dirname, "../Ignore/knxproj");
const SAMPLE_ALCALDIA = path.join(KNXPROJ_DIR, "Alcaldia de Chia V2.knxproj");
const SAMPLE_BODEGA = path.join(KNXPROJ_DIR, "Bodega WEG Pantalla.knxproj");
const SAMPLE_DAVIARENA = path.join(KNXPROJ_DIR, "DaviArena DEF_1 (4) (1) (1).knxproj");

describe("Real ETS .knxproj files (Alcaldia, Bodega WEG, DaviArena)", () => {
  const testAlcaldia = fs.existsSync(SAMPLE_ALCALDIA) ? test : test.skip;
  const testBodega = fs.existsSync(SAMPLE_BODEGA) ? test : test.skip;
  const testDavi = fs.existsSync(SAMPLE_DAVIARENA) ? test : test.skip;

  testAlcaldia(
    "reads Alcaldia de Chia V2 (364 MB uncompressed) quickly, queries, modifies and re-exports losslessly",
    async () => {
      const t0 = Date.now();
      const proj = KnxProject.fromFile(SAMPLE_ALCALDIA, { language: "es-ES" });
      const loadMs = Date.now() - t0;
      expect(loadMs).toBeLessThan(5000);

      const summary = proj.getSummary();
      expect(summary.projectInfo.id).toBe("P-0596");
      expect(summary.projectInfo.name).toBe("Alcaldia de Chia V2");
      expect(summary.metadata.schemaVersion).toBe(20);
      expect(summary.metadata.hasProjectSignature).toBe(true);
      expect(summary.metadata.certificate?.license).toBe("ETS5 Professional");
      expect(summary.stats.devices).toBe(275);
      expect(summary.stats.groupAddresses).toBe(7800);
      expect(summary.stats.totalLinks).toBe(5396);
      expect(summary.stats.spaces).toBe(45);
      expect(summary.manufacturers.length).toBe(4);

      // Verify GA lookup, DPT resolution & reverse links
      const gaHora = proj.getGroupAddress("0/1/1"); // Address 257 = 0/1/1
      expect(gaHora?.name).toBe("HORA");
      expect(gaHora?.dpt?.formatted).toBe("10.001");

      // Verify SerialNumber decoding & location path
      const dev277 = proj.getDeviceDetailsSync("P-0596-0_DI-277");
      expect(dev277.serialNumberHex).toBe("00710012EC5C");
      expect(dev277.locationPath).toContain("Alcaldia de Chia");
      expect(dev277.locationPath).toContain("T-IL100-S");

      // Verify Baggage reading
      const baggages = proj.listBaggages();
      expect(baggages.length).toBeGreaterThan(0);
      expect(proj.readBaggage(baggages[0].zipEntryPath).length).toBe(188688);

      // Verify lazy catalog enrichment & live DeviceConfigSession on a real ETS device (M-008E SP6-32)
      const sp6 = await proj.getDeviceDetails("1.1.124", { resolveCatalog: true, language: "es-ES" });
      expect(sp6.description).toBe("SP6-32");
      expect(sp6.comObjects.some((c) => c.catalogInfo !== undefined)).toBe(true);
      const sp6Session = await proj.openDeviceSession("1.1.124", { language: "es-ES" });
      expect(sp6Session.getUiState().catalog.applicationId).toBe(sp6.applicationProgramRefId);

      // Modify the real ETS project and export!
      proj.updateProjectInfo({ name: "Alcaldia de Chia V2 - Modificado API", comment: "Editado con KNX.ts" });
      proj.addGroupAddress({
        address: "31/7/250",
        name: "GA Prueba API",
        datapointType: "1.001",
        autoCreateRanges: true,
      });
      const addedDev = proj.addDevice("1.1", {
        address: "auto",
        name: "Dispositivo API",
        productRefId: sp6.productRefId,
        hardware2ProgramRefId: sp6.hardware2ProgramRefId,
      });
      proj.linkComObjectToGroupAddress(addedDev.id, "O-1_R-2", "31/7/250", { asSending: true });

      const tExp = Date.now();
      const exportedBuf = proj.toKnxProjBuffer();
      const exportMs = Date.now() - tExp;
      expect(exportMs).toBeLessThan(5000); // Raw passthrough avoids recompressing 364 MB!

      // Verify stale project signature dropped while unmodified M-0071.signature preserved!
      const exportedZip = ZipReader.fromBuffer(exportedBuf);
      expect(exportedZip.hasEntry("M-0071.signature")).toBe(true);
      expect(exportedZip.hasEntry("P-0596.signature")).toBe(false);
      expect(exportedZip.hasEntry(".validation")).toBe(false);

      // Re-open exported .knxproj and verify ALL original + new data survived!
      const reloaded = KnxProject.fromBuffer(exportedBuf);
      expect(reloaded.getProjectInfo().name).toBe("Alcaldia de Chia V2 - Modificado API");
      expect(reloaded.getStats().devices).toBe(276);
      expect(reloaded.getStats().groupAddresses).toBe(7801);
      expect(reloaded.getStats().totalLinks).toBe(5397);
      expect(reloaded.getGroupAddress("31/7/250")?.name).toBe("GA Prueba API");
      expect(reloaded.getGroupAddressLinks("31/7/250")[0].deviceId).toBe(addedDev.id);
      expect(reloaded.getDeviceDetailsSync("P-0596-0_DI-290").hasLoadedImage).toBe(true);
    },
    30000,
  );

  testBodega(
    "reads Bodega WEG Pantalla (IPConfig, Security, Baggages PNGs, ModuleInstances bridge) and round-trips",
    async () => {
      const proj = KnxProject.fromFile(SAMPLE_BODEGA, { language: "es-ES" });
      const stats = proj.getStats();
      expect(stats.devices).toBe(158);
      expect(stats.groupAddresses).toBe(1254);
      expect(stats.totalLinks).toBe(1773);

      const ipDevices = proj.getDevices().filter((d) => Boolean(d.macAddress));
      expect(ipDevices.length).toBe(7);

      const secDevices = proj.getDevices().filter((d) => d.hasSecurity);
      expect(secDevices.length).toBeGreaterThan(0);

      const pngBaggage = proj.listBaggages().find((b) => b.name.endsWith(".png"));
      expect(pngBaggage).toBeDefined();
      const pngBuf = proj.readBaggage(pngBaggage!.zipEntryPath);
      // PNG magic header: 89 50 4E 47
      expect(pngBuf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      // Test real ModuleInstances (<ModuleDef>/<Repeat>) bidirectional bridge on P-0348-0_DI-130!
      const modDevDetails = await proj.getDeviceDetails("P-0348-0_DI-130", { resolveCatalog: true, language: "es-ES" });
      expect(modDevDetails.moduleInstances.length).toBeGreaterThan(0);
      expect(modDevDetails.comObjects.some((c) => c.refId.includes("_MI-") && c.catalogInfo !== undefined)).toBe(true);

      const modSession = await proj.openDeviceSession("P-0348-0_DI-130", { language: "es-ES" });
      const evaluated = modSession.getEvaluatedState();
      expect(evaluated.instantiatedModules.length).toBeGreaterThan(0);
      // Verify ETS module-instance ComObject links (e.g. MD-1_M-15_MI-1_O-2-0_R-4) loaded into DeviceConfigSession!
      const linkedModuleCos = modSession.getUiState().comObjects.filter((c) => c.groupAddresses.length > 0);
      expect(linkedModuleCos.length).toBeGreaterThan(0);

      // Apply back & verify ModuleInstances and GroupObjectTree stay intact
      const applyRes = proj.applyDeviceSession("P-0348-0_DI-130", modSession);
      expect(applyRes.syncedModuleInstances).toBeGreaterThan(0);

      // Verify automatic coupler filter tables run cleanly on a real 11-line ETS project
      const filterTables = proj.computeFilterTables();
      expect(filterTables.lineCouplers.length).toBeGreaterThan(0);

      // Round-trip export
      proj.updateProjectInfo({ comment: "Bodega WEG checked" });
      const reloaded = KnxProject.fromBuffer(proj.toKnxProjBuffer());
      expect(reloaded.getStats().devices).toBe(158);
      expect(reloaded.getStats().groupAddresses).toBe(1254);
      expect(reloaded.getDevices().filter((d) => Boolean(d.macAddress)).length).toBe(7);
      expect(reloaded.getDeviceDetailsSync("P-0348-0_DI-130").moduleInstances.length).toBeGreaterThan(0);
    },
    30000,
  );

  testDavi("reads DaviArena DEF_1 (ModuleInstances, AdditionalGroupAddresses, 1725 GAs) and round-trips", () => {
    const proj = KnxProject.fromFile(SAMPLE_DAVIARENA);
    const stats = proj.getStats();
    expect(stats.devices).toBe(223);
    expect(stats.groupAddresses).toBe(1725);
    expect(stats.totalLinks).toBe(2443);

    // Verify AdditionalGroupAddresses on Line 1.2 preserved (285 filter table entries total across lines)
    const totalAdditionalGas = proj.getLines().reduce((s, l) => s + l.line.additionalGroupAddresses.length, 0);
    expect(totalAdditionalGas).toBe(285);
    const line12 = proj.getLine({ area: 1, line: 2 });
    expect(line12?.additionalGroupAddresses.length).toBeGreaterThan(0);

    // Verify ModuleInstances on DALI device preserved
    const devWithModules = proj.getDeviceDetailsSync("P-05B7-0_DI-181");
    expect(devWithModules.moduleInstances.length).toBeGreaterThan(0);

    // Export and verify preservation
    const reloaded = KnxProject.fromBuffer(proj.toKnxProjBuffer());
    expect(reloaded.getLine({ area: 1, line: 2 })?.additionalGroupAddresses).toEqual(line12?.additionalGroupAddresses);
    expect(reloaded.getDeviceDetailsSync("P-05B7-0_DI-181").moduleInstances).toEqual(devWithModules.moduleInstances);
  });
});
