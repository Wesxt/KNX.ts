import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KNXService } from "../src/connection/KNXService";
import { CEMI, CEMIInstance } from "../src/core/CEMI";
import { ControlField } from "../src/core/ControlField";
import { ExtendedControlField } from "../src/core/ControlFieldExtended";
import { GroupAddressCache } from "../src/core/cache/GroupAddressCache";
import { KnxDataDecode } from "../src/core/data/KNXDataDecode";
import { APCIEnum } from "../src/core/enum/APCIEnum";
import { AddressType } from "../src/core/enum/EnumControlFieldExtended";
import { APDU } from "../src/core/layers/data/APDU";
import { TPDU } from "../src/core/layers/data/TPDU";
import { APCI } from "../src/core/layers/interfaces/APCI";
import { TPCI, TPCIType } from "../src/core/layers/interfaces/TPCI";
import { MESSAGE_CODE_FIELD } from "../src/core/MessageCodeField";
import { KNXInterfaceObjectType, KNXManagement, KNXSecurityPropertyId } from "../src/management/KNXManagement";
import { DataSecureCEMI, DataSecureFailureEvent, isDataSecureCemi, KnxDataSecure } from "../src/security/KnxDataSecure";
import {
  APCI_DATA_SECURE,
  buildSADataPdu,
  buildSASyncReqPdu,
  buildSASyncResPdu,
  computeDataSecureAtByte,
  decodeScf,
  decodeSeqNr48,
  decryptSADataPdu,
  decryptSASyncReqPdu,
  decryptSASyncResPdu,
  encodeScf,
  encodeSeqNr48,
  MAX_SEQ_NR_48,
  SecureAlService,
  SecurityAlgorithmId,
} from "../src/security/KnxDataSecureCcm";
import { computeKeyringSignatureFromXml, KnxKeyring, normalizeKeyringGroupAddress } from "../src/security/KnxKeyring";
import { deriveKeyringPasswordKey } from "../src/security/KnxSecureKeys";
import { CEMIAdapter } from "../src/utils/CEMIAdapter";
import { KNXHelper } from "../src/utils/KNXHelper";

/**
 * In-memory KNXService mock wired through prepareOutgoingCemi / processIncomingCemi
 * to exercise full end-to-end KNX Data Secure behavior across two endpoints.
 */
class MockDataSecureBus extends KNXService {
  public sentWireFrames: CEMIInstance[] = [];
  private peer?: MockDataSecureBus;
  private wireResponder?: (cemi: CEMIInstance, bus: MockDataSecureBus) => void;

  constructor(individualAddress: string, dataSecure?: KnxDataSecure) {
    super({ individualAddress, dataSecure });
    this.individualAddress = individualAddress;
  }

  public get connectionState(): string {
    return "CONNECTED";
  }

  public connectPeer(other: MockDataSecureBus): void {
    this.peer = other;
  }

  public setWireResponder(fn: (cemi: CEMIInstance, bus: MockDataSecureBus) => void): void {
    this.wireResponder = fn;
  }

  public async connect(): Promise<void> {}
  public disconnect(): void {}

  public async send(data: Buffer | CEMIInstance): Promise<void> {
    const wire = this.prepareOutgoingCemi(data);
    const wireCemi = Buffer.isBuffer(wire) ? CEMI.fromBuffer(wire) : wire;
    this.sentWireFrames.push(wireCemi);

    if (this.wireResponder) {
      queueMicrotask(() => this.wireResponder!(wireCemi, this));
    }
    if (this.peer) {
      // Simulate KNX bus converting L_Data.req (0x11) -> L_Data.ind (0x29) on the remote peer
      const buf = Buffer.from(wireCemi.toBuffer());
      if (buf[0] === MESSAGE_CODE_FIELD["L_Data.req"].CEMI.value) {
        buf[0] = MESSAGE_CODE_FIELD["L_Data.ind"].CEMI.value;
      }
      const remoteInd = CEMI.fromBuffer(buf);
      queueMicrotask(() => this.peer!.receiveFromBus(remoteInd));
    }
  }

  public receiveFromBus(rawCemi: CEMIInstance): void {
    this.emit("raw_indication", rawCemi.toBuffer());
    const processed = this.processIncomingCemi(rawCemi);
    if (!processed) return;
    this.emit("indication", processed);
    if (!this.isCacheDelegated) {
      GroupAddressCache.getInstance().processCEMI(processed);
    }
    if (!this.isEventsDelegated && "destinationAddress" in processed) {
      this.emit(processed.destinationAddress, processed);
    }
  }
}

describe("KNX Data Security (KNX Standard 03_03_07 §5, Annex C, 03_05_01 §6.3, 03_05_02 §4)", () => {
  const ANNEX_C_TOOL_KEY = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

  describe("1. Official KNX Standard 03_03_07 Annex C Test Vectors", () => {
    test("C.1.1 S-A_Data-PDU (PropertyValue_Write A+C, connectionless)", () => {
      const plainApdu = Buffer.from("03d705351001202122232425262728292a2b2c2d2e2f", "hex");
      const built = buildSADataPdu({
        key: ANNEX_C_TOOL_KEY,
        seqNr: 4n,
        plainApdu,
        confidentiality: true,
        toolAccess: true,
        systemBroadcast: false,
        sourceAddress: "15.15.103", // FF67h
        destinationAddress: "15.15.0", // FF00h
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x00,
      });

      expect(built.scfByte).toBe(0x90);
      expect(built.secureAsdu.toString("hex")).toBe(
        "90" + "000000000004" + "6767242a2308ca76a11774214ee4cf5d94909f743d050d8fc168",
      );
      expect(built.tpduBuffer.subarray(0, 2).toString("hex")).toBe("03f1");

      const dec = decryptSADataPdu({
        key: ANNEX_C_TOOL_KEY,
        secureAsdu: built.secureAsdu,
        sourceAddress: "15.15.103",
        destinationAddress: "15.15.0",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x03,
      });
      expect(dec.ok).toBe(true);
      expect(dec.cryptoVerified).toBe(true);
      expect(dec.reservedBitsValid).toBe(true);
      expect(dec.seqNr).toBe(4n);
      expect(dec.plainApdu?.toString("hex")).toBe(plainApdu.toString("hex"));
    });

    test("C.1.2 S-A_Data-PDU (PropertyValue_Response A+C, connectionless)", () => {
      const plainApdu = Buffer.from("03d605351001202122232425262728292a2b2c2d2e2f", "hex");
      const built = buildSADataPdu({
        key: ANNEX_C_TOOL_KEY,
        seqNr: 3n,
        plainApdu,
        confidentiality: true,
        toolAccess: true,
        systemBroadcast: false,
        sourceAddress: "15.15.0", // FF00h
        destinationAddress: "15.15.103", // FF67h
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x00,
      });

      expect(built.scfByte).toBe(0x90);
      expect(built.secureAsdu.toString("hex")).toBe(
        "90" + "000000000003" + "706f533105503557cb2b24f1dd341b60b7e017ecd6b06849a72b",
      );

      const dec = decryptSADataPdu({
        key: ANNEX_C_TOOL_KEY,
        secureAsdu: built.secureAsdu,
        sourceAddress: "15.15.0",
        destinationAddress: "15.15.103",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x03,
      });
      expect(dec.ok).toBe(true);
      expect(dec.plainApdu?.toString("hex")).toBe(plainApdu.toString("hex"));
    });

    test("C.1.3 S-A_Sync.req (T_Data_Connected seq=0, Tool Key)", () => {
      const built = buildSASyncReqPdu({
        key: ANNEX_C_TOOL_KEY,
        seqNrLocal: 1n,
        serialNumber: Buffer.alloc(6, 0x00),
        challenge: Buffer.from("000000000003", "hex"),
        toolAccess: true,
        systemBroadcast: false,
        sourceAddress: "15.15.103",
        destinationAddress: "15.15.0",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x40, // T_Data_Connected seq 0 -> TPCI/APCI = 43F1h
      });

      expect(built.scfByte).toBe(0x92);
      expect(built.tpduBuffer.subarray(0, 2).toString("hex")).toBe("43f1");
      expect(built.secureAsdu.toString("hex")).toBe("92" + "000000000001" + "000000000000" + "c1cf4506f09bd79fab55");

      const dec = decryptSASyncReqPdu({
        key: ANNEX_C_TOOL_KEY,
        secureAsdu: built.secureAsdu,
        sourceAddress: "15.15.103",
        destinationAddress: "15.15.0",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x43,
      });
      expect(dec.ok).toBe(true);
      expect(dec.seqNrLocal).toBe(1n);
      expect(dec.challenge?.toString("hex")).toBe("000000000003");
    });

    test("C.1.4 S-A_Sync.res (T_Data_Connected seq=0, Tool Key)", () => {
      const challenge = Buffer.from("000000000003", "hex");
      const random = Buffer.from("aaaaaaaaaaaa", "hex");
      const built = buildSASyncResPdu({
        key: ANNEX_C_TOOL_KEY,
        challenge,
        random,
        seqNrRemote: 3n,
        seqNrLocal: 4n,
        toolAccess: true,
        systemBroadcast: false,
        sourceAddress: "15.15.0",
        destinationAddress: "15.15.103",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x40,
      });

      expect(built.scfByte).toBe(0x93);
      expect(built.tpduBuffer.subarray(0, 2).toString("hex")).toBe("43f1");
      expect(built.secureAsdu.toString("hex")).toBe("93" + "aaaaaaaaaaa9" + "9c023ad25e146470693e638d5b70cac4");

      const dec = decryptSASyncResPdu({
        key: ANNEX_C_TOOL_KEY,
        challenge,
        secureAsdu: built.secureAsdu,
        sourceAddress: "15.15.0",
        destinationAddress: "15.15.103",
        addressType: AddressType.INDIVIDUAL,
        isExtendedFrame: true,
        eff: 0,
        tpciByte: 0x43,
      });
      expect(dec.ok).toBe(true);
      expect(dec.random?.toString("hex")).toBe("aaaaaaaaaaaa");
      expect(dec.seqNrRemote).toBe(3n);
      expect(dec.seqNrLocal).toBe(4n);
    });
  });

  describe("2. SCF, Auth-Only, AT Byte, and 48-bit Sequence Numbers", () => {
    test("encodes and validates SCF per 03_03_07 Fig. 106", () => {
      expect(
        encodeScf({
          toolAccess: false,
          algorithmId: SecurityAlgorithmId.CCM_AUTH_ONLY,
          systemBroadcast: false,
          service: SecureAlService.S_A_DATA,
        }),
      ).toBe(0x00);
      expect(
        encodeScf({
          toolAccess: false,
          algorithmId: SecurityAlgorithmId.CCM_AUTH_CONF,
          systemBroadcast: false,
          service: SecureAlService.S_A_DATA,
        }),
      ).toBe(0x10);
      expect(
        encodeScf({
          toolAccess: true,
          algorithmId: SecurityAlgorithmId.CCM_AUTH_CONF,
          systemBroadcast: true,
          service: SecureAlService.S_A_SYNC_REQ,
        }),
      ).toBe(0x9a);

      // Reserved SAI (010b = 0x20) -> null
      expect(decodeScf(0x20)).toBeNull();
      // Reserved S-AL service (100b = 0x04) -> null
      expect(decodeScf(0x94)).toBeNull();
      // S-A_Sync with auth-only SAI=0 -> null
      expect(decodeScf(0x82)).toBeNull();
      expect(decodeScf(0x83)).toBeNull();
    });

    test("Authentication-only S-A_Data (SAI=0) preserves plaintext APDU and rejects tampered MAC/payload", () => {
      const groupKey = Buffer.from("11223344556677889900aabbccddeeff", "hex");
      const plainApdu = Buffer.from([0x00, 0x81]); // GroupValue_Write(true)

      const built = buildSADataPdu({
        key: groupKey,
        seqNr: 100n,
        plainApdu,
        confidentiality: false,
        toolAccess: false,
        systemBroadcast: false,
        sourceAddress: "1.1.250",
        destinationAddress: "1/0/1",
        addressType: AddressType.GROUP,
        isExtendedFrame: false,
        eff: 0,
        tpciByte: 0x00,
      });

      expect(built.scfByte).toBe(0x00);
      // Plaintext APDU is unencrypted at bytes 7..9
      expect(built.secureAsdu.subarray(7, 9).equals(plainApdu)).toBe(true);

      const ok = decryptSADataPdu({
        key: groupKey,
        secureAsdu: built.secureAsdu,
        sourceAddress: "1.1.250",
        destinationAddress: "1/0/1",
        addressType: AddressType.GROUP,
        isExtendedFrame: false,
        eff: 0,
        tpciByte: 0x03,
      });
      expect(ok.ok).toBe(true);
      expect(ok.plainApdu?.equals(plainApdu)).toBe(true);

      // Tamper 1 bit of plain payload -> MAC fails
      const tampered = Buffer.from(built.secureAsdu);
      tampered[8] ^= 0x01;
      const fail = decryptSADataPdu({
        key: groupKey,
        secureAsdu: tampered,
        sourceAddress: "1.1.250",
        destinationAddress: "1/0/1",
        addressType: AddressType.GROUP,
        isExtendedFrame: false,
        eff: 0,
        tpciByte: 0x03,
      });
      expect(fail.ok).toBe(false);
      expect(fail.cryptoVerified).toBe(false);
    });

    test("AT byte calculation and 48-bit sequence number encode/decode", () => {
      expect(computeDataSecureAtByte(AddressType.GROUP, false, 0x05)).toBe(0x80);
      expect(computeDataSecureAtByte(AddressType.GROUP, true, 0x05)).toBe(0x85);
      expect(computeDataSecureAtByte(AddressType.INDIVIDUAL, true, 0x00)).toBe(0x00);

      const bigSeq = 280081012411n; // Exact SequenceNumber from PRUEBA.knxkeys
      expect(decodeSeqNr48(encodeSeqNr48(bigSeq))).toBe(bigSeq);
      expect(decodeSeqNr48(encodeSeqNr48(MAX_SEQ_NR_48))).toBe(MAX_SEQ_NR_48);
    });
  });

  describe("3. KnxKeyring Group Address Normalization & PRUEBA.knxkeys", () => {
    test("normalizes ETS integer group addresses ('2049' <-> '1/0/1')", () => {
      expect(normalizeKeyringGroupAddress("2049")).toEqual({ formatted: "1/0/1", intValue: 2049 });
      expect(normalizeKeyringGroupAddress(2305)).toEqual({ formatted: "1/1/1", intValue: 2305 });
      expect(normalizeKeyringGroupAddress("1/0/6")).toEqual({ formatted: "1/0/6", intValue: 2054 });

      const pwd = "test-password";
      const created = "2024-10-03T12:34:56Z";
      const groupKeyEnc = "DFZA8HL9wnFWS3LGw40k/w==";
      const unsignedXml = `<?xml version="1.0" encoding="utf-8"?>
<Keyring Project="TEST" CreatedBy="ETS 5.7.7" Created="${created}">
  <GroupAddresses>
    <Group Address="2049" Key="${groupKeyEnc}" />
  </GroupAddresses>
  <Devices>
    <Device IndividualAddress="1.1.1" SequenceNumber="280081012411" />
  </Devices>
</Keyring>`;
      const { computed } = computeKeyringSignatureFromXml(unsignedXml, deriveKeyringPasswordKey(pwd));
      const signed = unsignedXml.replace(/<Keyring\b/, `<Keyring Signature="${computed.toString("base64")}"`);

      const kr = KnxKeyring.fromSource(signed, pwd);
      expect(kr.getGroupAddress("1/0/1")?.addressInt).toBe(2049);
      expect(kr.getGroupAddress("2049")?.addressFormatted).toBe("1/0/1");
      expect(kr.getGroupAddress(2049)?.decryptedKey).toBeDefined();
      expect(kr.getDevice("1.1.1")?.sequenceNumberBigInt).toBe(280081012411n);
    });
  });

  describe("4. End-to-End Group Communication, Anti-Replay, Extended Frames & Persistence", () => {
    const GROUP_KEY_1 = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const GROUP_KEY_2 = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

    test("transparently encrypts & decrypts short (DPT 1.001) and long (DPT 9.001 -> Extended Frame) group telegrams", async () => {
      const senderSec = new KnxDataSecure({
        sourceAddress: "1.1.250",
        initialSequenceNumber: 10n,
        groupKeys: { "1/0/1": GROUP_KEY_1, "1/1/1": GROUP_KEY_2 },
        groupSecurityModes: { "1/1/1": "auth_only" },
      });
      const receiverSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        groupKeys: { "1/0/1": GROUP_KEY_1, "1/1/1": GROUP_KEY_2 },
      });

      const senderBus = new MockDataSecureBus("1.1.250", senderSec);
      const receiverBus = new MockDataSecureBus("1.1.1", receiverSec);
      senderBus.connectPeer(receiverBus);

      const received: DataSecureCEMI[] = [];
      receiverBus.on("indication", (cemi: DataSecureCEMI) => received.push(cemi));

      // 1. DPT 1.001 (A+C, short payload -> APDU length 14, Standard Frame FT=1)
      await senderBus.write("1/0/1", "1.001", true);
      // 2. DPT 9.001 (A+C, 2-byte float -> APDU length 16 > 15, MUST auto-switch to Extended Frame FT=0!)
      await senderBus.write("1/0/1", "9.001", 21.5);
      // 3. DPT 5.001 (Auth-only on 1/1/1)
      await senderBus.write("1/1/1", "5.001", 50);
      // 4. GroupValue_Read on 1/0/1
      await senderBus.read("1/0/1");
      // 5. GroupValue_Response on 1/0/1
      await senderBus.respond("1/0/1", "1.001", false);

      await new Promise((r) => setTimeout(r, 20));

      expect(senderBus.sentWireFrames).toHaveLength(5);
      expect(senderBus.sentWireFrames.every((f) => isDataSecureCemi(f))).toBe(true);
      // Wire frame #0 (DPT 1.001) length=14 -> Standard Frame (FT=1)
      expect((senderBus.sentWireFrames[0] as any).controlField1.frameType).toBe(true);
      // Wire frame #1 (DPT 9.001) length=16 -> Extended Frame (FT=0)
      expect((senderBus.sentWireFrames[1] as any).controlField1.frameType).toBe(false);
      // Sequence number incremented 5 times (10 -> 15)
      expect(senderSec.sequenceNumberSending).toBe(15n);

      expect(received).toHaveLength(5);
      // #0: DPT 1.001 true (A+C, seq=10)
      expect(KnxDataDecode.decodeThis("1.001", (received[0] as any).TPDU.apdu.data)).toBe(true);
      expect(received[0].dataSecure?.authenticated).toBe(true);
      expect(received[0].dataSecure?.confidential).toBe(true);
      expect(received[0].dataSecure?.sequenceNumber).toBe(10n);

      // #1: DPT 9.001 21.5 (A+C, seq=11)
      expect(KnxDataDecode.decodeThis("9.001", (received[1] as any).TPDU.apdu.data)).toBeCloseTo(21.5, 1);
      expect(received[1].dataSecure?.sequenceNumber).toBe(11n);

      // #2: DPT 5.001 ~50% (Auth-only, seq=12)
      const decoded5001 = KnxDataDecode.decodeThis("5.001", (received[2] as any).TPDU.apdu.data) as {
        value: number;
        unit: string;
      };
      expect(decoded5001.value).toBeCloseTo(50, 0);
      expect(decoded5001.unit).toBe("%");
      expect(received[2].dataSecure?.confidential).toBe(false);
      expect(received[2].dataSecure?.sequenceNumber).toBe(12n);

      // #3: GroupValue_Read (seq=13)
      expect((received[3] as any).TPDU.apdu.apci.value).toBe(APCIEnum.A_GroupValue_Read_Protocol_Data_Unit);
      expect(received[3].dataSecure?.sequenceNumber).toBe(13n);

      // #4: GroupValue_Response false (seq=14)
      expect((received[4] as any).TPDU.apdu.apci.value).toBe(APCIEnum.A_GroupValue_Response_Protocol_Data_Unit);
      expect(KnxDataDecode.decodeThis("1.001", (received[4] as any).TPDU.apdu.data)).toBe(false);
    });

    test("enforces anti-replay (duplicate vs lower seq), Tool flag attack on T_Data_Group, and 48-bit overflow guard", () => {
      const receiver = new KnxDataSecure({
        sourceAddress: "1.1.1",
        groupKeys: { "1/0/1": GROUP_KEY_1 },
      });
      const failures: DataSecureFailureEvent[] = [];
      receiver.on("security_failure", (e: DataSecureFailureEvent) => failures.push(e));

      const sender = new KnxDataSecure({
        sourceAddress: "1.1.250",
        groupKeys: { "1/0/1": GROUP_KEY_1 },
      });

      const makeGroupInd = (seq: bigint) => {
        const tpdu = new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_GroupValue_Write_Protocol_Data_Unit),
            Buffer.from([0x01]),
            true,
          ),
          Buffer.from([0x01]),
        );
        const plain = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
          null,
          new ControlField(0xbc),
          new ExtendedControlField(0xe0),
          "1.1.250",
          "1/0/1",
          tpdu,
        );
        return sender.wrapCemi(plain, { sequenceNumber: seq });
      };

      // Valid seq=5
      expect(receiver.unwrapCemi(makeGroupInd(5n)).plainCemi).not.toBeNull();
      expect(receiver.getLastValidSequenceNumber("1.1.250")).toBe(5n);

      // Duplicate seq=5 -> ignored WITHOUT incrementing seqNrErrors (03_03_07 §5.3.1 Note 28)
      const dupRes = receiver.unwrapCemi(makeGroupInd(5n));
      expect(dupRes.plainCemi).toBeNull();
      expect(dupRes.failureReason).toBe("seq_duplicate");
      expect(receiver.getSecurityFailureCounters().seqNrErrors).toBe(0);

      // Replay seq=4 < 5 -> rejected AND increments seqNrErrors
      const replayRes = receiver.unwrapCemi(makeGroupInd(4n));
      expect(replayRes.plainCemi).toBeNull();
      expect(replayRes.failureReason).toBe("seq_too_low");
      expect(receiver.getSecurityFailureCounters().seqNrErrors).toBe(1);

      // SeqNr = 0 -> rejected (03_03_07 §5.3.1 Note 31)
      expect(receiver.unwrapCemi(makeGroupInd(0n)).failureReason).toBe("seq_zero");

      // Tool Access flag (T=1) on T_Data_Group -> attack, increments accessRoleErrors (03_03_07 §5.5.3.2)
      const forged = buildSADataPdu({
        key: GROUP_KEY_1,
        seqNr: 6n,
        plainApdu: Buffer.from([0x00, 0x81]),
        confidentiality: true,
        toolAccess: true,
        systemBroadcast: false,
        sourceAddress: "1.1.250",
        destinationAddress: "1/0/1",
        addressType: AddressType.GROUP,
        isExtendedFrame: false,
        eff: 0,
        tpciByte: 0x00,
      });
      const forgedCemi = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
        null,
        new ControlField(0xbc),
        new ExtendedControlField(0xe0),
        "1.1.250",
        "1/0/1",
        new TPDU(
          new TPCI(TPCIType.T_DATA_GROUP_PDU),
          new APDU(
            new TPCI(TPCIType.T_DATA_GROUP_PDU),
            new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
            forged.secureAsdu,
            false,
          ),
          forged.secureAsdu,
        ),
      );
      const toolAttack = receiver.unwrapCemi(forgedCemi);
      expect(toolAttack.plainCemi).toBeNull();
      expect(toolAttack.failureReason).toBe("tool_flag_on_group");
      expect(receiver.getSecurityFailureCounters().accessRoleErrors).toBe(1);

      // Overflow guard at 0xFFFFFFFFFFFFn (03_03_07 §5.3.1)
      sender.setSequenceNumberSending(MAX_SEQ_NR_48);
      expect(() => sender.consumeSequenceNumberSending()).toThrow(/cannot wrap/i);
      expect(failures.length).toBeGreaterThanOrEqual(2);
    });

    test("persists and restores sequence numbers to/from JSON file", () => {
      const tmpFile = path.join(os.tmpdir(), `knx-ts-ds-seq-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
      try {
        const s1 = new KnxDataSecure({
          sourceAddress: "1.1.250",
          initialSequenceNumber: 50n,
          sequenceNumberFile: tmpFile,
        });
        expect(s1.consumeSequenceNumberSending()).toBe(50n);
        s1.setLastValidSequenceNumber("1.1.1", 280081012499n);
        expect(fs.existsSync(tmpFile)).toBe(true);

        const s2 = new KnxDataSecure({
          sourceAddress: "1.1.250",
          initialSequenceNumber: 1n,
          sequenceNumberFile: tmpFile,
        });
        expect(s2.sequenceNumberSending).toBe(51n);
        expect(s2.getLastValidSequenceNumber("1.1.1")).toBe(280081012499n);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe("5. S-A_Sync (DM_SecureSync_RCl & DM_SecureSync_SBC) & Secure KNXManagement", () => {
    const TOOL_KEY = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    const FDSK = Buffer.from("fedcba98765432100123456789abcdef", "hex");
    const DEVICE_SN = Buffer.from("008301020304", "hex");

    test("DM_SecureSync_RCl (connectionless) and DM_SecureSync_SBC (broadcast) with FDSK fallback", async () => {
      const clientSec = new KnxDataSecure({
        sourceAddress: "1.1.250",
        initialSequenceNumber: 2n,
        deviceToolKeys: { "1.1.1": TOOL_KEY },
        deviceFdsKeys: { "1.1.1": FDSK },
      });
      clientSec.setDeviceSerialNumber("1.1.1", DEVICE_SN);

      const deviceSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        initialSequenceNumber: 500n,
        ownToolKey: TOOL_KEY,
        ownSerialNumber: DEVICE_SN,
        respondToSyncRequests: true,
      });
      deviceSec.setToolAccessLastValidSeq(99n); // Expects next >= 100 from MaC

      const clientBus = new MockDataSecureBus("1.1.250", clientSec);
      const deviceBus = new MockDataSecureBus("1.1.1", deviceSec);
      clientBus.connectPeer(deviceBus);
      deviceBus.connectPeer(clientBus);

      // 1. Point-to-point connectionless sync (DM_SecureSync_RCl)
      const sync1 = await clientSec.syncSequenceNumber(clientBus, "1.1.1", {
        commMode: "individual",
        timeoutMs: 500,
        retries: 0,
      });
      expect(sync1.remoteAddress).toBe("1.1.1");
      expect(sync1.seqNrRemote).toBe(500n);
      expect(sync1.seqNrLocal).toBe(100n);
      expect(sync1.usedToolKey).toBe(true);
      expect(sync1.usedFallbackKey).toBe(false);
      // Local state updated per 03_03_07 §5.3.2 Comparisons 1 & 2
      expect(clientSec.sequenceNumberSending).toBe(100n);
      expect(clientSec.getLastValidSequenceNumber("1.1.1")).toBe(499n);
      // Sync must NOT increment device's Sequence Number Sending (NOTE 44)
      expect(deviceSec.sequenceNumberSending).toBe(500n);

      // 2. Simulate factory-reset device using FDSK instead of ToolKey + Broadcast sync (DM_SecureSync_SBC)
      // Wait >1s or reset responder rate limit via fresh deviceSec
      const freshDeviceSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        initialSequenceNumber: 12n,
        ownToolKey: FDSK,
        ownSerialNumber: DEVICE_SN,
        respondToSyncRequests: true,
      });
      const freshDeviceBus = new MockDataSecureBus("1.1.1", freshDeviceSec);
      clientBus.connectPeer(freshDeviceBus);
      freshDeviceBus.connectPeer(clientBus);

      const sync2 = await clientSec.syncSequenceNumber(clientBus, "1.1.1", {
        commMode: "broadcast",
        timeoutMs: 120,
        retries: 0,
      });
      expect(sync2.usedFallbackKey).toBe(true);
      expect(sync2.seqNrRemote).toBe(12n);
      expect(sync2.seqNrLocal).toBe(100n); // Client proposed 100, fresh device updated stored to 99 and returned 100
      expect(freshDeviceSec.toolAccessLastValidSeq).toBe(99n);
    });

    test("Secure KNXManagement session (T_Connect + connected S-A_Sync + Security Interface Object 17)", async () => {
      const clientSec = new KnxDataSecure({
        sourceAddress: "1.1.250",
        initialSequenceNumber: 5n,
        deviceToolKeys: { "1.1.1": TOOL_KEY },
      });

      const deviceSec = new KnxDataSecure({
        sourceAddress: "1.1.1",
        initialSequenceNumber: 777n,
        ownToolKey: TOOL_KEY,
      });
      deviceSec.setToolAccessLastValidSeq(20n);

      const clientBus = new MockDataSecureBus("1.1.250", clientSec);

      // Simulated KNX Data Secure device (MAXinBOX 66 v3 at 1.1.1) handling T_Connect, T_ACK, S-A_Sync, and Object 17
      let devTxSeq = 0;
      let securityMode = true;
      const sendDevConnected = (apciVal: APCIEnum | number, data: Buffer) => {
        const tpci = new TPCI(TPCIType.T_DATA_CONNECTED_PDU);
        tpci.sequenceNumber = devTxSeq;
        const plainInd = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
          null,
          new ControlField(0x30),
          new ExtendedControlField(0x60),
          "1.1.1",
          "1.1.250",
          new TPDU(
            tpci,
            new APDU(new TPCI(tpci.getValue() as TPCIType), new APCI(apciVal as APCIEnum), data, false),
            data,
          ),
        );
        const secInd = deviceSec.wrapCemi(plainInd, { toolAccess: true, key: TOOL_KEY, confidentiality: true });
        devTxSeq = (devTxSeq + 1) & 0x0f;
        setTimeout(() => clientBus.receiveFromBus(secInd), 2);
      };

      const sendDevAck = (seq: number) => {
        const ackTpci = new TPCI(((TPCIType.T_ACK_PDU & 0xc3) | ((seq & 0x0f) << 2)) as TPCIType);
        const ackInd = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
          null,
          new ControlField(0xb0),
          new ExtendedControlField(0x60),
          "1.1.1",
          "1.1.250",
          new TPDU(ackTpci, new APDU(ackTpci, new APCI(0), Buffer.alloc(0), false), Buffer.alloc(0)),
        );
        setTimeout(() => clientBus.receiveFromBus(ackInd), 1);
      };

      clientBus.setWireResponder((wireCemi) => {
        if (!("TPDU" in wireCemi)) return;
        const tpci = wireCemi.TPDU.tpci;
        if (tpci.dataControlFlag) {
          if (tpci.getValue() === TPCIType.T_CONNECT_PDU) devTxSeq = 0;
          return;
        }
        if (!tpci.numberedFlag) return;
        const rxSeq = tpci.sequenceNumber;
        sendDevAck(rxSeq);

        expect(wireCemi.TPDU.apdu.apci.value).toBe(APCI_DATA_SECURE);
        const asdu = wireCemi.TPDU.apdu.data;
        const scf = decodeScf(asdu[0]);
        expect(scf).not.toBeNull();

        if (scf!.service === SecureAlService.S_A_SYNC_REQ) {
          const decReq = decryptSASyncReqPdu({
            key: TOOL_KEY,
            secureAsdu: asdu,
            sourceAddress: wireCemi.sourceAddress,
            destinationAddress: wireCemi.destinationAddress,
            addressType: AddressType.INDIVIDUAL,
            isExtendedFrame: !wireCemi.controlField1.frameType,
            eff: wireCemi.controlField2.eff,
            tpciByte: tpci.getValue(),
          });
          expect(decReq.ok).toBe(true);
          const replyTpciByte = TPCIType.T_DATA_CONNECTED_PDU | ((devTxSeq & 0x0f) << 2);
          const builtRes = buildSASyncResPdu({
            key: TOOL_KEY,
            challenge: decReq.challenge!,
            seqNrRemote: deviceSec.sequenceNumberSending,
            seqNrLocal: deviceSec.toolAccessLastValidSeq + 1n, // 21n
            toolAccess: true,
            systemBroadcast: false,
            sourceAddress: "1.1.1",
            destinationAddress: "1.1.250",
            addressType: AddressType.INDIVIDUAL,
            isExtendedFrame: true,
            eff: 0,
            tpciByte: replyTpciByte,
          });
          const resInd = new CEMI.DataLinkLayerCEMI["L_Data.ind"](
            null,
            new ControlField(0x30),
            new ExtendedControlField(0x60),
            "1.1.1",
            "1.1.250",
            new TPDU(
              new TPCI(replyTpciByte as TPCIType),
              new APDU(
                new TPCI(replyTpciByte as TPCIType),
                new APCI(APCIEnum.A_DataSecure_Protocol_Data_Unit),
                builtRes.secureAsdu,
                false,
              ),
              builtRes.secureAsdu,
            ),
          );
          devTxSeq = (devTxSeq + 1) & 0x0f;
          setTimeout(() => clientBus.receiveFromBus(resInd), 3);
          return;
        }

        // S-A_Data management request
        const unwrapped = deviceSec.unwrapCemi(
          CEMI.fromBuffer(Buffer.concat([Buffer.from([0x29]), wireCemi.toBuffer().subarray(1)])),
        );
        expect(unwrapped.plainCemi).not.toBeNull();
        const innerApdu = (unwrapped.plainCemi as any).TPDU.apdu as APDU;
        const apciVal = innerApdu.apci.value;

        if (apciVal === APCIEnum.A_FunctionPropertyExtState_Read_Protocol_Data_Unit) {
          // Format: ObjType(2) | ObjInst(12b)+PropIdHigh(4b) | PropIdLow(8b) | data...
          const objType = innerApdu.data.readUInt16BE(0);
          const instProp = innerApdu.data.readUInt16BE(2);
          const propId = ((instProp & 0x0f) << 8) | innerApdu.data[4];
          expect(objType).toBe(KNXInterfaceObjectType.SECURITY_OBJECT);
          if (propId === KNXSecurityPropertyId.PID_SECURITY_MODE) {
            const resp = Buffer.concat([
              innerApdu.data.subarray(0, 5),
              Buffer.from([0x00, 0x00, securityMode ? 1 : 0]),
            ]);
            sendDevConnected(APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit, resp);
          } else if (propId === KNXSecurityPropertyId.PID_SECURITY_FAILURES_LOG) {
            const counters = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x03, 0x00, 0x01]);
            const resp = Buffer.concat([innerApdu.data.subarray(0, 5), counters]);
            sendDevConnected(APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit, resp);
          }
        } else if (apciVal === APCIEnum.A_FunctionPropertyExtCommand_Protocol_Data_Unit) {
          const propId = ((innerApdu.data.readUInt16BE(2) & 0x0f) << 8) | innerApdu.data[4];
          if (propId === KNXSecurityPropertyId.PID_SECURITY_MODE) {
            securityMode = innerApdu.data[7] !== 0;
            const resp = Buffer.concat([innerApdu.data.subarray(0, 5), Buffer.from([0x00, 0x00])]);
            sendDevConnected(APCIEnum.A_FunctionPropertyExtState_Response_Protocol_Data_Unit, resp);
          }
        } else if (apciVal === APCIEnum.A_PropertyExtValue_Read_Protocol_Data_Unit) {
          const propId = ((innerApdu.data.readUInt16BE(2) & 0x0f) << 8) | innerApdu.data[4];
          const startIdx = innerApdu.data.readUInt16BE(6);
          if (propId === KNXSecurityPropertyId.PID_SEQUENCE_NUMBER_SENDING) {
            const resp = Buffer.concat([innerApdu.data.subarray(0, 8), encodeSeqNr48(deviceSec.sequenceNumberSending)]);
            sendDevConnected(APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit, resp);
          } else if (propId === KNXSecurityPropertyId.PID_SECURITY_INDIVIDUAL_ADDRESS_TABLE) {
            const payload =
              startIdx === 0
                ? Buffer.from([0x00, 0x01]) // 1 entry
                : Buffer.concat([KNXHelper.GetAddress("1.1.250", "."), encodeSeqNr48(42n)]);
            const resp = Buffer.concat([innerApdu.data.subarray(0, 8), payload]);
            sendDevConnected(APCIEnum.A_PropertyExtValue_Response_Protocol_Data_Unit, resp);
          }
        }
      });

      const mgmt = new KNXManagement(clientBus, { sourceAddress: "1.1.250", minFrameDelayMs: 0 });
      await mgmt.withSession(
        "1.1.1",
        async (session) => {
          // Auto connected S-A_Sync updated clientSeq to 21n and remote lastValid to 776n
          expect(clientSec.sequenceNumberSending).toBe(21n);

          expect(await session.readSecurityMode()).toBe(true);
          await session.writeSecurityMode(false);
          expect(await session.readSecurityMode()).toBe(false);

          const log = await session.readSecurityFailuresLog();
          expect(log).toEqual({ returnCode: 0, seqNrErrors: 2, cryptoErrors: 3, accessRoleErrors: 1 });

          const seqSending = await session.readSequenceNumberSending();
          expect(seqSending).toBeGreaterThanOrEqual(777n);

          const iaTable = await session.readSecurityIndividualAddressTable();
          expect(iaTable).toEqual([{ individualAddress: "1.1.250", lastValidSeqNr: 42n }]);
        },
        { secure: true },
      );
    });
  });

  describe("6. CEMIAdapter Extended Frame Support (TPUART / EMI2)", () => {
    test("decodes Extended Frame (FT=0) EMI buffer containing a 16-byte Data Secure APDU", () => {
      // [MC=0x29] [CF1=0x3C (FT=0)] [CF2=0xE0 (Group, Hop=6)] [Src=1.1.250] [Dst=1/0/1] [Len=16] [TPDU (17 bytes)]
      const dummyAsdu = Buffer.alloc(15, 0xaa);
      dummyAsdu[0] = 0x10; // SCF
      const emi = Buffer.concat([Buffer.from([0x29, 0x3c, 0xe0, 0x11, 0xfa, 0x08, 0x01, 16, 0x03, 0xf1]), dummyAsdu]);
      const cemi = CEMIAdapter.emiToCemi(emi);
      expect(cemi).not.toBeNull();
      expect(isDataSecureCemi(cemi!)).toBe(true);
      expect((cemi as any).controlField1.frameType).toBe(false);
      expect((cemi as any).sourceAddress).toBe("1.1.250");
      expect((cemi as any).destinationAddress).toBe("1/0/1");
      expect((cemi as any).TPDU.apdu.data.length).toBe(15);
    });
  });
});
