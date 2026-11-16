import fs from "node:fs";
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
});
