import { KNX_MANUFACTURERS } from "../core/resources/KNXManufacturers";
import { KNXHelper } from "../utils/KNXHelper";
import {
  GroupAddressStyle,
  KnxArea,
  KnxComObjectInstanceRef,
  KnxDeviceInstance,
  KnxFunction,
  KnxGroupAddress,
  KnxGroupObjectTree,
  KnxGroupObjectTreeNode,
  KnxGroupRange,
  KnxInstallation,
  KnxLine,
  KnxMasterData,
  KnxProjectArchiveMetadata,
  KnxProjectHistoryEntry,
  KnxProjectInfo,
  KnxProjectUserFile,
  KnxSegment,
  KnxSpace,
  KnxTrade,
} from "./types";

const CRLF = "\r\n";

export function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderAttrs(
  pairs: [string, string | number | boolean | undefined][],
  extraAttrs?: Record<string, string>,
): string {
  const parts: string[] = [];
  const emitted = new Set<string>();
  for (const [key, raw] of pairs) {
    if (raw === undefined) continue;
    emitted.add(key);
    const val = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
    parts.push(`${key}="${escapeXmlAttr(val)}"`);
  }
  if (extraAttrs) {
    for (const [key, val] of Object.entries(extraAttrs)) {
      if (val === undefined || emitted.has(key)) continue;
      parts.push(`${key}="${escapeXmlAttr(val)}"`);
    }
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

function pad(depth: number): string {
  return "  ".repeat(depth);
}

/**
 * Formats a 16-bit KNX Group Address integer according to ETS `GroupAddressStyle`.
 */
export function formatGroupAddressByStyle(addressInt: number, style: GroupAddressStyle = "ThreeLevel"): string {
  const addr = addressInt & 0xffff;
  if (style === "Free") return String(addr);
  if (style === "TwoLevel") return KNXHelper.GetAddress(addr, "/", false);
  return KNXHelper.GetAddress(addr, "/", true);
}

/**
 * Parses a KNX Group Address from integer (`0..65535`), 3-level (`"1/0/1"`), or 2-level (`"1/1"`) notation
 * into its 16-bit unsigned integer value.
 */
export function parseGroupAddressToInt(address: string | number): number {
  if (typeof address === "number") {
    if (!Number.isInteger(address) || address < 0 || address > 65535) {
      throw new Error(`Group Address integer out of range (0..65535): ${address}`);
    }
    return address;
  }
  const trimmed = address.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n < 0 || n > 65535) throw new Error(`Group Address integer out of range (0..65535): ${trimmed}`);
    return n;
  }
  if (!KNXHelper.isValidGroupAddress(trimmed)) {
    throw new Error(`Invalid KNX Group Address: "${address}"`);
  }
  const parts = trimmed.split("/").map((s) => parseInt(s, 10));
  if (parts.length === 3) {
    return ((parts[0] & 0x1f) << 11) | ((parts[1] & 0x07) << 8) | (parts[2] & 0xff);
  }
  if (parts.length === 2) {
    return ((parts[0] & 0x1f) << 11) | (parts[1] & 0x7ff);
  }
  throw new Error(`Invalid KNX Group Address: "${address}"`);
}

// ============================================================================
// 1. Serialize `P-XXXX/project.xml`
// ============================================================================

export function serializeProjectXml(
  meta: KnxProjectArchiveMetadata,
  info: KnxProjectInfo,
  historyEntries: KnxProjectHistoryEntry[],
  userFiles: KnxProjectUserFile[],
  rawExtraChildren: string[] = [],
  targetSchemaVersion?: number,
): string {
  const schemaVer = targetSchemaVersion ?? meta.schemaVersion ?? 20;
  const xmlns = targetSchemaVersion ? `http://knx.org/xml/project/${schemaVer}` : meta.xmlns;
  const lines: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<KNX xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" CreatedBy="${escapeXmlAttr(meta.createdBy)}" ToolVersion="${escapeXmlAttr(meta.toolVersion)}" xmlns="${escapeXmlAttr(xmlns)}">`,
    `  <Project Id="${escapeXmlAttr(info.id)}">`,
  ];

  const piAttrs = renderAttrs(
    [
      ["Name", info.name],
      ["GroupAddressStyle", info.groupAddressStyle],
      ["ProjectNumber", info.projectNumber],
      ["ContractNumber", info.contractNumber],
      ["OrderNumber", info.orderNumber],
      ["LastModified", info.lastModified],
      ["ProjectStart", info.projectStart],
      ["ProjectEnd", info.projectEnd],
      ["Comment", info.comment],
      ["CompletionStatus", info.completionStatus],
      ["ProjectTracingLevel", info.projectTracingLevel],
      ["Hide16BitGroupsFromLegacyPlugins", info.hide16BitGroupsFromLegacyPlugins],
      ["CodePage", info.codePage],
      ["BusAccessLegacyMode", info.busAccessLegacyMode],
      ["DeviceCount", info.deviceCount],
      ["LastUsedPuid", info.lastUsedPuid],
      ["Guid", info.guid],
    ],
    info.extraAttrs,
  );

  const hasInfoChildren = historyEntries.length > 0;
  if (!hasInfoChildren) {
    lines.push(`    <ProjectInformation${piAttrs} />`);
  } else {
    lines.push(`    <ProjectInformation${piAttrs}>`);
    lines.push(`      <HistoryEntries>`);
    for (const h of historyEntries) {
      const hAttrs = renderAttrs(
        [
          ["Date", h.date],
          ["User", h.user],
          ["Text", h.text],
          ["Detail", h.detail],
        ],
        h.extraAttrs,
      );
      lines.push(`        <HistoryEntry${hAttrs} />`);
    }
    lines.push(`      </HistoryEntries>`);
    lines.push(`    </ProjectInformation>`);
  }

  if (userFiles.length > 0) {
    lines.push(`    <UserFiles>`);
    for (const uf of userFiles) {
      const ufAttrs = renderAttrs(
        [
          ["Filename", uf.filename],
          ["Comment", uf.comment],
        ],
        uf.extraAttrs,
      );
      lines.push(`      <UserFile${ufAttrs} />`);
    }
    lines.push(`    </UserFiles>`);
  }

  for (const raw of rawExtraChildren) {
    lines.push(`    ${raw}`);
  }

  lines.push(`  </Project>`);
  lines.push(`</KNX>`);
  return lines.join(CRLF);
}

// ============================================================================
// 2. Serialize `P-XXXX/0.xml` (Installations)
// ============================================================================

function writeGoTreeNode(node: KnxGroupObjectTreeNode, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Type", node.type],
      ["RefId", node.refId],
      ["Text", node.text],
      [
        "GroupObjectInstances",
        node.groupObjectInstances && node.groupObjectInstances.length > 0
          ? node.groupObjectInstances.join(" ")
          : undefined,
      ],
    ],
    node.extraAttrs,
  );
  if (node.nodes.length === 0) {
    out.push(`${pad(depth)}<Node${attrs} />`);
  } else {
    out.push(`${pad(depth)}<Node${attrs}>`);
    out.push(`${pad(depth + 1)}<Nodes>`);
    for (const child of node.nodes) {
      writeGoTreeNode(child, depth + 2, out);
    }
    out.push(`${pad(depth + 1)}</Nodes>`);
    out.push(`${pad(depth)}</Node>`);
  }
}

function writeGoTree(tree: KnxGroupObjectTree, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      [
        "GroupObjectInstances",
        tree.groupObjectInstances && tree.groupObjectInstances.length > 0
          ? tree.groupObjectInstances.join(" ")
          : undefined,
      ],
    ],
    tree.extraAttrs,
  );
  if (tree.nodes.length === 0) {
    out.push(`${pad(depth)}<GroupObjectTree${attrs} />`);
  } else {
    out.push(`${pad(depth)}<GroupObjectTree${attrs}>`);
    out.push(`${pad(depth + 1)}<Nodes>`);
    for (const node of tree.nodes) {
      writeGoTreeNode(node, depth + 2, out);
    }
    out.push(`${pad(depth + 1)}</Nodes>`);
    out.push(`${pad(depth)}</GroupObjectTree>`);
  }
}

function writeComObjectInstanceRef(co: KnxComObjectInstanceRef, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["RefId", co.refId],
      ["Text", co.text],
      ["Description", co.description],
      ["FunctionText", co.functionText],
      ["DatapointType", co.datapointType],
      ["CommunicationFlag", co.communicationFlag],
      ["ReadFlag", co.readFlag],
      ["WriteFlag", co.writeFlag],
      ["TransmitFlag", co.transmitFlag],
      ["UpdateFlag", co.updateFlag],
      ["ReadOnInitFlag", co.readOnInitFlag],
      ["Priority", co.priority],
      ["ChannelId", co.channelId],
      ["Links", co.links.length > 0 ? co.links.join(" ") : undefined],
      ["Acknowledged", co.acknowledged],
      ["IsActive", co.isActive],
    ],
    co.extraAttrs,
  );
  out.push(`${pad(depth)}<ComObjectInstanceRef${attrs} />`);
}

function writeDeviceInstance(dev: KnxDeviceInstance, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", dev.id],
      ["Address", dev.address],
      ["Name", dev.name],
      ["ProductRefId", dev.productRefId],
      ["Hardware2ProgramRefId", dev.hardware2ProgramRefId],
      ["Comment", dev.comment],
      ["Description", dev.description],
      ["SerialNumber", dev.serialNumber],
      ["UniqueNumber", dev.uniqueNumber],
      ["CompletionStatus", dev.completionStatus],
      ["ApplicationProgramLoaded", dev.applicationProgramLoaded],
      ["CommunicationPartLoaded", dev.communicationPartLoaded],
      ["IndividualAddressLoaded", dev.individualAddressLoaded],
      ["MediumConfigLoaded", dev.mediumConfigLoaded],
      ["ParametersLoaded", dev.parametersLoaded],
      ["IsActivityCalculated", dev.isActivityCalculated],
      ["Broken", dev.broken],
      ["LastModified", dev.lastModified],
      ["LastDownload", dev.lastDownload],
      ["LastUsedAPDULength", dev.lastUsedApduLength],
      ["ReadMaxAPDULength", dev.readMaxApduLength],
      ["ReadMaxRoutingAPDULength", dev.readMaxRoutingApduLength],
      ["CheckSums", dev.checkSums],
      ["LoadedImage", dev.loadedImage],
      ["Puid", dev.puid],
    ],
    dev.extraAttrs,
  );

  const hasChildren =
    dev.parameterInstanceRefs.length > 0 ||
    dev.comObjectInstanceRefs.length > 0 ||
    dev.moduleInstances.length > 0 ||
    dev.groupObjectTree !== undefined ||
    dev.additionalAddresses.length > 0 ||
    dev.ipConfig !== undefined ||
    dev.security !== undefined ||
    dev.busInterfaces.length > 0 ||
    dev.binaryData.length > 0 ||
    (dev.rawExtraChildren !== undefined && dev.rawExtraChildren.length > 0);

  if (!hasChildren) {
    out.push(`${pad(depth)}<DeviceInstance${attrs} />`);
    return;
  }

  out.push(`${pad(depth)}<DeviceInstance${attrs}>`);

  if (dev.parameterInstanceRefs.length > 0) {
    out.push(`${pad(depth + 1)}<ParameterInstanceRefs>`);
    for (const pr of dev.parameterInstanceRefs) {
      const prAttrs = renderAttrs(
        [
          ["RefId", pr.refId],
          ["Value", pr.value],
        ],
        pr.extraAttrs,
      );
      out.push(`${pad(depth + 2)}<ParameterInstanceRef${prAttrs} />`);
    }
    out.push(`${pad(depth + 1)}</ParameterInstanceRefs>`);
  }

  if (dev.comObjectInstanceRefs.length > 0) {
    out.push(`${pad(depth + 1)}<ComObjectInstanceRefs>`);
    for (const co of dev.comObjectInstanceRefs) {
      writeComObjectInstanceRef(co, depth + 2, out);
    }
    out.push(`${pad(depth + 1)}</ComObjectInstanceRefs>`);
  }

  if (dev.groupObjectTree) {
    writeGoTree(dev.groupObjectTree, depth + 1, out);
  }

  if (dev.additionalAddresses.length > 0) {
    out.push(`${pad(depth + 1)}<AdditionalAddresses>`);
    for (const aa of dev.additionalAddresses) {
      const aaAttrs = renderAttrs(
        [
          ["Address", aa.address],
          ["Name", aa.name],
          ["Description", aa.description],
          ["Comment", aa.comment],
        ],
        aa.extraAttrs,
      );
      out.push(`${pad(depth + 2)}<Address${aaAttrs} />`);
    }
    out.push(`${pad(depth + 1)}</AdditionalAddresses>`);
  }

  if (dev.binaryData.length > 0) {
    out.push(`${pad(depth + 1)}<BinaryData>`);
    for (const bd of dev.binaryData) {
      const bdAttrs = renderAttrs(
        [
          ["Name", bd.name],
          ["InternalDescription", bd.internalDescription],
        ],
        bd.extraAttrs,
      );
      out.push(`${pad(depth + 2)}<BinaryData${bdAttrs}>`);
      out.push(`${pad(depth + 3)}<Data>${escapeXmlText(bd.dataBase64)}</Data>`);
      out.push(`${pad(depth + 2)}</BinaryData>`);
    }
    out.push(`${pad(depth + 1)}</BinaryData>`);
  }

  if (dev.ipConfig) {
    const ipAttrs = renderAttrs(
      [
        ["Assign", dev.ipConfig.assign],
        ["IPAddress", dev.ipConfig.ipAddress],
        ["SubnetMask", dev.ipConfig.subnetMask],
        ["DefaultGateway", dev.ipConfig.defaultGateway],
        ["MACAddress", dev.ipConfig.macAddress],
      ],
      dev.ipConfig.extraAttrs,
    );
    out.push(`${pad(depth + 1)}<IPConfig${ipAttrs} />`);
  }

  if (dev.security) {
    const s = dev.security;
    const secAttrs = renderAttrs(
      [
        ["LoadedIPRoutingBackboneKey", s.loadedIpRoutingBackboneKey],
        ["DeviceAuthenticationCode", s.deviceAuthenticationCode],
        ["DeviceAuthenticationCodeHash", s.deviceAuthenticationCodeHash],
        ["LoadedDeviceAuthenticationCodeHash", s.loadedDeviceAuthenticationCodeHash],
        ["DeviceManagementPassword", s.deviceManagementPassword],
        ["DeviceManagementPasswordHash", s.deviceManagementPasswordHash],
        ["LoadedDeviceManagementPasswordHash", s.loadedDeviceManagementPasswordHash],
        ["ToolKey", s.toolKey],
        ["LoadedToolKey", s.loadedToolKey],
        ["SequenceNumber", s.sequenceNumber],
        ["SequenceNumberTimestamp", s.sequenceNumberTimestamp],
      ],
      s.extraAttrs,
    );
    out.push(`${pad(depth + 1)}<Security${secAttrs} />`);
  }

  if (dev.busInterfaces.length > 0) {
    out.push(`${pad(depth + 1)}<BusInterfaces>`);
    for (const bi of dev.busInterfaces) {
      const biAttrs = renderAttrs(
        [
          ["RefId", bi.refId],
          ["Name", bi.name],
          ["Description", bi.description],
          ["Comment", bi.comment],
          ["Password", bi.password],
          ["PasswordHash", bi.passwordHash],
        ],
        bi.extraAttrs,
      );
      if (bi.connectors.length === 0) {
        out.push(`${pad(depth + 2)}<BusInterface${biAttrs} />`);
      } else {
        out.push(`${pad(depth + 2)}<BusInterface${biAttrs}>`);
        out.push(`${pad(depth + 3)}<Connectors>`);
        for (const conn of bi.connectors) {
          const cAttrs = renderAttrs([["GroupAddressRefId", conn.groupAddressRefId]], conn.extraAttrs);
          out.push(`${pad(depth + 4)}<Connector${cAttrs} />`);
        }
        out.push(`${pad(depth + 3)}</Connectors>`);
        out.push(`${pad(depth + 2)}</BusInterface>`);
      }
    }
    out.push(`${pad(depth + 1)}</BusInterfaces>`);
  }

  if (dev.moduleInstances.length > 0) {
    out.push(`${pad(depth + 1)}<ModuleInstances>`);
    for (const mi of dev.moduleInstances) {
      const miAttrs = renderAttrs(
        [
          ["Id", mi.id],
          ["RefId", mi.refId],
          ["RepeatIndex", mi.repeatIndex],
        ],
        mi.extraAttrs,
      );
      if (mi.arguments.length === 0) {
        out.push(`${pad(depth + 2)}<ModuleInstance${miAttrs} />`);
      } else {
        out.push(`${pad(depth + 2)}<ModuleInstance${miAttrs}>`);
        out.push(`${pad(depth + 3)}<Arguments>`);
        for (const arg of mi.arguments) {
          const argAttrs = renderAttrs(
            [
              ["RefId", arg.refId],
              ["Value", arg.value],
            ],
            arg.extraAttrs,
          );
          out.push(`${pad(depth + 4)}<Argument${argAttrs} />`);
        }
        out.push(`${pad(depth + 3)}</Arguments>`);
        out.push(`${pad(depth + 2)}</ModuleInstance>`);
      }
    }
    out.push(`${pad(depth + 1)}</ModuleInstances>`);
  }

  if (dev.rawExtraChildren) {
    for (const raw of dev.rawExtraChildren) {
      out.push(`${pad(depth + 1)}${raw}`);
    }
  }

  out.push(`${pad(depth)}</DeviceInstance>`);
}

function writeSegment(seg: KnxSegment, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", seg.id],
      ["Number", seg.number],
      ["Name", seg.name],
      ["Description", seg.description],
      ["Comment", seg.comment],
      ["MediumTypeRefId", seg.mediumTypeRefId],
      ["Puid", seg.puid],
    ],
    seg.extraAttrs,
  );
  const hasChildren = seg.devices.length > 0 || (seg.rawExtraChildren !== undefined && seg.rawExtraChildren.length > 0);
  if (!hasChildren) {
    out.push(`${pad(depth)}<Segment${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<Segment${attrs}>`);
  for (const dev of seg.devices) {
    writeDeviceInstance(dev, depth + 1, out);
  }
  if (seg.rawExtraChildren) {
    for (const raw of seg.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Segment>`);
}

function writeLine(line: KnxLine, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", line.id],
      ["Address", line.address],
      ["Name", line.name],
      ["MediumTypeRefId", line.mediumTypeRefId],
      ["DomainAddress", line.domainAddress],
      ["Description", line.description],
      ["Comment", line.comment],
      ["CompletionStatus", line.completionStatus],
      ["Puid", line.puid],
    ],
    line.extraAttrs,
  );
  const hasChildren =
    line.segments.length > 0 ||
    line.devices.length > 0 ||
    line.additionalGroupAddresses.length > 0 ||
    (line.rawExtraChildren !== undefined && line.rawExtraChildren.length > 0);

  if (!hasChildren) {
    out.push(`${pad(depth)}<Line${attrs} />`);
    return;
  }

  out.push(`${pad(depth)}<Line${attrs}>`);
  for (const seg of line.segments) {
    writeSegment(seg, depth + 1, out);
  }
  for (const dev of line.devices) {
    writeDeviceInstance(dev, depth + 1, out);
  }
  if (line.additionalGroupAddresses.length > 0) {
    out.push(`${pad(depth + 1)}<AdditionalGroupAddresses>`);
    for (const addr of line.additionalGroupAddresses) {
      out.push(`${pad(depth + 2)}<GroupAddress Address="${addr}" />`);
    }
    out.push(`${pad(depth + 1)}</AdditionalGroupAddresses>`);
  }
  if (line.rawExtraChildren) {
    for (const raw of line.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Line>`);
}

function writeArea(area: KnxArea, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", area.id],
      ["Address", area.address],
      ["Name", area.name],
      ["Description", area.description],
      ["Comment", area.comment],
      ["CompletionStatus", area.completionStatus],
      ["Puid", area.puid],
    ],
    area.extraAttrs,
  );
  const hasChildren =
    area.lines.length > 0 || (area.rawExtraChildren !== undefined && area.rawExtraChildren.length > 0);
  if (!hasChildren) {
    out.push(`${pad(depth)}<Area${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<Area${attrs}>`);
  for (const line of area.lines) {
    writeLine(line, depth + 1, out);
  }
  if (area.rawExtraChildren) {
    for (const raw of area.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Area>`);
}

function writeFunction(fn: KnxFunction, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", fn.id],
      ["Name", fn.name],
      ["Type", fn.type],
      ["Number", fn.number],
      ["Description", fn.description],
      ["Comment", fn.comment],
      ["DefaultGroupRange", fn.defaultGroupRange],
      ["CompletionStatus", fn.completionStatus],
      ["Puid", fn.puid],
    ],
    fn.extraAttrs,
  );
  const hasChildren =
    fn.groupAddressRefs.length > 0 || (fn.rawExtraChildren !== undefined && fn.rawExtraChildren.length > 0);
  if (!hasChildren) {
    out.push(`${pad(depth)}<Function${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<Function${attrs}>`);
  for (const ref of fn.groupAddressRefs) {
    const rAttrs = renderAttrs(
      [
        ["Id", ref.id],
        ["RefId", ref.refId],
        ["Name", ref.name],
        ["Role", ref.role],
        ["Puid", ref.puid],
      ],
      ref.extraAttrs,
    );
    out.push(`${pad(depth + 1)}<GroupAddressRef${rAttrs} />`);
  }
  if (fn.rawExtraChildren) {
    for (const raw of fn.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Function>`);
}

function writeSpace(sp: KnxSpace, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Type", sp.type],
      ["Id", sp.id],
      ["Name", sp.name],
      ["Number", sp.number],
      ["Description", sp.description],
      ["Comment", sp.comment],
      ["Usage", sp.usage],
      ["DefaultLine", sp.defaultLine],
      ["CompletionStatus", sp.completionStatus],
      ["Puid", sp.puid],
    ],
    sp.extraAttrs,
  );
  const hasChildren =
    sp.spaces.length > 0 ||
    sp.deviceInstanceRefs.length > 0 ||
    sp.functions.length > 0 ||
    (sp.rawExtraChildren !== undefined && sp.rawExtraChildren.length > 0);
  if (!hasChildren) {
    out.push(`${pad(depth)}<Space${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<Space${attrs}>`);
  for (const child of sp.spaces) {
    writeSpace(child, depth + 1, out);
  }
  for (const refId of sp.deviceInstanceRefs) {
    out.push(`${pad(depth + 1)}<DeviceInstanceRef RefId="${escapeXmlAttr(refId)}" />`);
  }
  for (const fn of sp.functions) {
    writeFunction(fn, depth + 1, out);
  }
  if (sp.rawExtraChildren) {
    for (const raw of sp.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Space>`);
}

function writeGroupAddress(ga: KnxGroupAddress, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", ga.id],
      ["Address", ga.address],
      ["Name", ga.name],
      ["Description", ga.description],
      ["Comment", ga.comment],
      ["DatapointType", ga.datapointType],
      ["Central", ga.central],
      ["Unfiltered", ga.unfiltered],
      ["Security", ga.security],
      ["Key", ga.key],
      ["Puid", ga.puid],
    ],
    ga.extraAttrs,
  );
  out.push(`${pad(depth)}<GroupAddress${attrs} />`);
}

function writeGroupRange(gr: KnxGroupRange, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", gr.id],
      ["RangeStart", gr.rangeStart],
      ["RangeEnd", gr.rangeEnd],
      ["Name", gr.name],
      ["Description", gr.description],
      ["Comment", gr.comment],
      ["Unfiltered", gr.unfiltered],
      ["Security", gr.security],
      ["Puid", gr.puid],
    ],
    gr.extraAttrs,
  );
  const hasChildren = gr.groupRanges.length > 0 || gr.groupAddresses.length > 0;
  if (!hasChildren) {
    out.push(`${pad(depth)}<GroupRange${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<GroupRange${attrs}>`);
  for (const sub of gr.groupRanges) {
    writeGroupRange(sub, depth + 1, out);
  }
  for (const ga of gr.groupAddresses) {
    writeGroupAddress(ga, depth + 1, out);
  }
  out.push(`${pad(depth)}</GroupRange>`);
}

function writeTrade(tr: KnxTrade, depth: number, out: string[]): void {
  const attrs = renderAttrs(
    [
      ["Id", tr.id],
      ["Name", tr.name],
      ["Number", tr.number],
      ["Description", tr.description],
      ["Comment", tr.comment],
      ["CompletionStatus", tr.completionStatus],
      ["Puid", tr.puid],
    ],
    tr.extraAttrs,
  );
  const hasChildren =
    tr.trades.length > 0 ||
    tr.deviceInstanceRefs.length > 0 ||
    (tr.rawExtraChildren !== undefined && tr.rawExtraChildren.length > 0);
  if (!hasChildren) {
    out.push(`${pad(depth)}<Trade${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<Trade${attrs}>`);
  for (const sub of tr.trades) {
    writeTrade(sub, depth + 1, out);
  }
  for (const refId of tr.deviceInstanceRefs) {
    out.push(`${pad(depth + 1)}<DeviceInstanceRef RefId="${escapeXmlAttr(refId)}" />`);
  }
  if (tr.rawExtraChildren) {
    for (const raw of tr.rawExtraChildren) out.push(`${pad(depth + 1)}${raw}`);
  }
  out.push(`${pad(depth)}</Trade>`);
}

export function serializeInstallationXml(
  meta: KnxProjectArchiveMetadata,
  projectId: string,
  inst: KnxInstallation,
  targetSchemaVersion?: number,
): string {
  const schemaVer = targetSchemaVersion ?? meta.schemaVersion ?? 20;
  const xmlns = targetSchemaVersion ? `http://knx.org/xml/project/${schemaVer}` : meta.xmlns;
  const out: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<KNX xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" CreatedBy="${escapeXmlAttr(meta.createdBy)}" ToolVersion="${escapeXmlAttr(meta.toolVersion)}" xmlns="${escapeXmlAttr(xmlns)}">`,
    `  <Project Id="${escapeXmlAttr(projectId)}">`,
    `    <Installations>`,
  ];

  const instAttrs = renderAttrs(
    [
      ["Name", inst.name],
      ["BCUKey", inst.bcuKey],
      ["DefaultLine", inst.defaultLine],
      ["IPRoutingLatencyTolerance", inst.ipRoutingLatencyTolerance],
      ["IPRoutingMulticastAddress", inst.ipRoutingMulticastAddress],
      ["IPRoutingBackboneKey", inst.ipRoutingBackboneKey],
      ["IPRoutingBackboneGroup", inst.ipRoutingBackboneGroup],
      ["SplitType", inst.splitType],
    ],
    inst.extraAttrs,
  );
  out.push(`      <Installation${instAttrs}>`);

  // Topology
  out.push(`        <Topology>`);
  for (const area of inst.topology.areas) {
    writeArea(area, 5, out);
  }
  if (inst.topology.unassignedDevices.length > 0) {
    out.push(`          <UnassignedDevices>`);
    for (const dev of inst.topology.unassignedDevices) {
      writeDeviceInstance(dev, 6, out);
    }
    out.push(`          </UnassignedDevices>`);
  }
  if (inst.topology.rawExtraChildren) {
    for (const raw of inst.topology.rawExtraChildren) {
      out.push(`          ${raw}`);
    }
  }
  out.push(`        </Topology>`);

  // Locations
  if (inst.locations.length > 0) {
    out.push(`        <Locations>`);
    for (const sp of inst.locations) {
      writeSpace(sp, 5, out);
    }
    out.push(`        </Locations>`);
  } else {
    out.push(`        <Locations />`);
  }

  // GroupAddresses
  if (inst.groupRanges.length > 0) {
    out.push(`        <GroupAddresses>`);
    out.push(`          <GroupRanges>`);
    for (const gr of inst.groupRanges) {
      writeGroupRange(gr, 6, out);
    }
    out.push(`          </GroupRanges>`);
    out.push(`        </GroupAddresses>`);
  } else {
    out.push(`        <GroupAddresses>`);
    out.push(`          <GroupRanges />`);
    out.push(`        </GroupAddresses>`);
  }

  // Trades (optional)
  if (inst.trades.length > 0) {
    out.push(`        <Trades>`);
    for (const tr of inst.trades) {
      writeTrade(tr, 5, out);
    }
    out.push(`        </Trades>`);
  }

  // Preserved unknown top-level sections
  if (inst.rawExtraSections) {
    for (const raw of inst.rawExtraSections) {
      out.push(`        ${raw}`);
    }
  }

  out.push(`      </Installation>`);
  out.push(`    </Installations>`);
  out.push(`  </Project>`);
  out.push(`</KNX>`);
  return out.join(CRLF);
}

// ============================================================================
// 3. Minimal Valid `knx_master.xml` Generator (for projects created from scratch)
// ============================================================================

export function buildDefaultMasterData(schemaVersion: number = 20): KnxMasterData {
  const manufacturers: KnxMasterData["manufacturers"] = {};
  for (const [numStr, name] of Object.entries(KNX_MANUFACTURERS)) {
    const num = Number(numStr);
    const id = `M-${num.toString(16).toUpperCase().padStart(4, "0")}`;
    manufacturers[id] = { id, numericId: num, name: String(name) };
  }

  const mediumTypes: KnxMasterData["mediumTypes"] = {
    "MT-0": { id: "MT-0", number: 0, name: "TP", text: "Twisted Pair (TP)", domainAddressLength: 0 },
    "MT-1": { id: "MT-1", number: 1, name: "PL", text: "Powerline (PL)", domainAddressLength: 2 },
    "MT-2": { id: "MT-2", number: 2, name: "RF", text: "Radio Frequency (RF)", domainAddressLength: 6 },
    "MT-5": { id: "MT-5", number: 5, name: "IP", text: "IP", domainAddressLength: 0 },
  };

  const dptDefs: {
    num: number;
    text: string;
    bits: number;
    subs: [number, string, string, boolean?][];
  }[] = [
    {
      num: 1,
      text: "1-bit",
      bits: 1,
      subs: [
        [1, "DPT_Switch", "switch", true],
        [2, "DPT_Bool", "boolean"],
        [3, "DPT_Enable", "enable"],
        [7, "DPT_Step", "step"],
        [8, "DPT_UpDown", "up/down"],
        [9, "DPT_OpenClose", "open/close"],
        [10, "DPT_Start", "start/stop"],
        [11, "DPT_State", "state"],
        [17, "DPT_Trigger", "trigger"],
        [19, "DPT_Window_Door", "window/door"],
      ],
    },
    { num: 2, text: "1-bit controlled", bits: 2, subs: [[1, "DPT_Switch_Control", "switch control", true]] },
    {
      num: 3,
      text: "3-bit controlled",
      bits: 4,
      subs: [
        [7, "DPT_Control_Dimming", "dimming control", true],
        [8, "DPT_Control_Blinds", "blinds control"],
      ],
    },
    {
      num: 5,
      text: "8-bit unsigned value",
      bits: 8,
      subs: [
        [1, "DPT_Scaling", "percentage (0..100%)", true],
        [3, "DPT_Angle", "angle (degrees)"],
        [4, "DPT_Percent_U8", "percentage (0..255%)"],
        [10, "DPT_Value_1_Ucount", "counter pulses (0..255)"],
      ],
    },
    {
      num: 6,
      text: "8-bit signed value",
      bits: 8,
      subs: [
        [1, "DPT_Percent_V8", "percentage (-128..127%)", true],
        [10, "DPT_Value_1_Count", "counter pulses (-128..127)"],
      ],
    },
    {
      num: 7,
      text: "2-byte unsigned value",
      bits: 16,
      subs: [
        [1, "DPT_Value_2_Ucount", "pulses", true],
        [5, "DPT_TimePeriodSec", "time (s)"],
        [6, "DPT_TimePeriodMin", "time (min)"],
        [7, "DPT_TimePeriodHrs", "time (h)"],
        [12, "DPT_UElCurrentmA", "current (mA)"],
        [13, "DPT_Brightness", "brightness (lux)"],
        [600, "DPT_Absolute_Colour_Temperature", "absolute colour temperature (K)"],
      ],
    },
    {
      num: 8,
      text: "2-byte signed value",
      bits: 16,
      subs: [[1, "DPT_Value_2_Count", "pulses difference", true]],
    },
    {
      num: 9,
      text: "2-byte float value",
      bits: 16,
      subs: [
        [1, "DPT_Value_Temp", "temperature (°C)", true],
        [2, "DPT_Value_Tempd", "temperature difference (K)"],
        [4, "DPT_Value_Lux", "lux (Lux)"],
        [5, "DPT_Value_Wsp", "wind speed (m/s)"],
        [6, "DPT_Value_Pres", "pressure (Pa)"],
        [7, "DPT_Value_Humidity", "humidity (%)"],
        [8, "DPT_Value_AirQuality", "parts/million (ppm)"],
        [24, "DPT_Value_Power", "power (kW)"],
      ],
    },
    { num: 10, text: "time", bits: 24, subs: [[1, "DPT_TimeOfDay", "time of day", true]] },
    { num: 11, text: "date", bits: 24, subs: [[1, "DPT_Date", "date", true]] },
    { num: 12, text: "4-byte unsigned value", bits: 32, subs: [[1, "DPT_Value_4_Ucount", "counter pulses", true]] },
    {
      num: 13,
      text: "4-byte signed value",
      bits: 32,
      subs: [
        [1, "DPT_Value_4_Count", "counter pulses", true],
        [10, "DPT_ActiveEnergy", "active energy (Wh)"],
        [13, "DPT_ActiveEnergy_kWh", "active energy (kWh)"],
      ],
    },
    {
      num: 14,
      text: "4-byte float value",
      bits: 32,
      subs: [
        [19, "DPT_Value_Electric_Current", "electric current (A)"],
        [27, "DPT_Value_Electric_Potential", "electric potential (V)"],
        [33, "DPT_Value_Frequency", "frequency (Hz)"],
        [56, "DPT_Value_Power", "power (W)", true],
      ],
    },
    {
      num: 16,
      text: "character string",
      bits: 112,
      subs: [
        [0, "DPT_String_ASCII", "Character String (ASCII)", true],
        [1, "DPT_String_8859_1", "Character String (ISO 8859-1)"],
      ],
    },
    { num: 17, text: "scene number", bits: 8, subs: [[1, "DPT_SceneNumber", "scene number", true]] },
    { num: 18, text: "scene control", bits: 8, subs: [[1, "DPT_SceneControl", "scene control", true]] },
    { num: 19, text: "date time", bits: 64, subs: [[1, "DPT_DateTime", "date time", true]] },
    {
      num: 20,
      text: "1-byte",
      bits: 8,
      subs: [[102, "DPT_HVACMode", "HVAC mode", true]],
    },
    {
      num: 232,
      text: "3-byte colour RGB",
      bits: 24,
      subs: [[600, "DPT_Colour_RGB", "RGB value 3x(0..255)", true]],
    },
  ];

  const datapointTypes: KnxMasterData["datapointTypes"] = {};
  const datapointSubtypes: KnxMasterData["datapointSubtypes"] = {};
  for (const def of dptDefs) {
    const id = `DPT-${def.num}`;
    const subtypes = def.subs.map(([subNum, name, text, isDef]) => {
      const subId = `DPST-${def.num}-${subNum}`;
      const entry = {
        id: subId,
        dptId: id,
        dptNumber: def.num,
        number: subNum,
        formatted: `${def.num}.${String(subNum).padStart(3, "0")}`,
        name,
        text,
        sizeInBit: def.bits,
        isDefault: isDef,
      };
      datapointSubtypes[subId] = entry;
      return entry;
    });
    datapointTypes[id] = {
      id,
      number: def.num,
      name: `${def.num}.xxx`,
      text: def.text,
      sizeInBit: def.bits,
      subtypes,
    };
  }

  return {
    version: 1,
    schemaVersion,
    manufacturers,
    mediumTypes,
    datapointTypes,
    datapointSubtypes,
    spaceUsages: {
      "SU-1": { id: "SU-1", number: 1, text: "Living Room" },
      "SU-2": { id: "SU-2", number: 2, text: "Bedroom" },
      "SU-3": { id: "SU-3", number: 3, text: "Kitchen" },
      "SU-4": { id: "SU-4", number: 4, text: "Office" },
      "SU-5": { id: "SU-5", number: 5, text: "Technical Room" },
    },
    functionTypes: {
      "FT-0": { id: "FT-0", number: 0, text: "Custom" },
      "FT-1": { id: "FT-1", number: 1, text: "Switchable Light" },
      "FT-2": { id: "FT-2", number: 2, text: "Dimmable Light" },
      "FT-3": { id: "FT-3", number: 3, text: "Sunblind" },
      "FT-4": { id: "FT-4", number: 4, text: "Heating Radiator" },
      "FT-6": { id: "FT-6", number: 6, text: "Heating/Cooling" },
    },
  };
}

export function serializeMinimalKnxMasterXml(master: KnxMasterData, schemaVersion: number = 20): string {
  const out: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<KNX xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" CreatedBy="KNX.ts" ToolVersion="2.3.1" xmlns="http://knx.org/xml/project/${schemaVersion}">`,
    `  <MasterData Version="${master.version ?? 1}">`,
    `    <DatapointTypes>`,
  ];

  for (const dpt of Object.values(master.datapointTypes)) {
    out.push(
      `      <DatapointType Id="${escapeXmlAttr(dpt.id)}" Number="${dpt.number}" Name="${escapeXmlAttr(dpt.name)}" Text="${escapeXmlAttr(dpt.text)}" SizeInBit="${dpt.sizeInBit}">`,
    );
    if (dpt.subtypes.length > 0) {
      out.push(`        <DatapointSubtypes>`);
      for (const sub of dpt.subtypes) {
        const defAttr = sub.isDefault ? ` Default="true"` : "";
        out.push(
          `          <DatapointSubtype Id="${escapeXmlAttr(sub.id)}" Number="${sub.number}" Name="${escapeXmlAttr(sub.name)}" Text="${escapeXmlAttr(sub.text)}"${defAttr} />`,
        );
      }
      out.push(`        </DatapointSubtypes>`);
    }
    out.push(`      </DatapointType>`);
  }
  out.push(`    </DatapointTypes>`);

  out.push(`    <MediumTypes>`);
  for (const mt of Object.values(master.mediumTypes)) {
    const domAttr = mt.domainAddressLength !== undefined ? ` DomainAddressLength="${mt.domainAddressLength}"` : "";
    out.push(
      `      <MediumType Id="${escapeXmlAttr(mt.id)}" Number="${mt.number}" Name="${escapeXmlAttr(mt.name)}" Text="${escapeXmlAttr(mt.text)}"${domAttr} />`,
    );
  }
  out.push(`    </MediumTypes>`);

  if (Object.keys(master.functionTypes).length > 0) {
    out.push(`    <FunctionTypes>`);
    for (const ft of Object.values(master.functionTypes)) {
      out.push(
        `      <FunctionType Id="${escapeXmlAttr(ft.id)}" Number="${ft.number ?? 0}" Text="${escapeXmlAttr(ft.text)}" />`,
      );
    }
    out.push(`    </FunctionTypes>`);
  }

  if (Object.keys(master.spaceUsages).length > 0) {
    out.push(`    <SpaceUsages>`);
    for (const su of Object.values(master.spaceUsages)) {
      out.push(
        `      <SpaceUsage Id="${escapeXmlAttr(su.id)}" Number="${su.number ?? 0}" Text="${escapeXmlAttr(su.text)}" />`,
      );
    }
    out.push(`    </SpaceUsages>`);
  }

  out.push(`    <Manufacturers>`);
  for (const m of Object.values(master.manufacturers)) {
    out.push(
      `      <Manufacturer Id="${escapeXmlAttr(m.id)}" Name="${escapeXmlAttr(m.name)}" KnxManufacturerId="${m.numericId}" />`,
    );
  }
  out.push(`    </Manufacturers>`);

  out.push(`  </MasterData>`);
  out.push(`</KNX>`);
  return out.join(CRLF);
}

// ============================================================================
// 4. ETS Group Addresses XML Export (`http://knx.org/xml/ga-export/01`) & CSV Export
// ============================================================================

function writeGaExportRange(gr: KnxGroupRange, style: GroupAddressStyle, depth: number, out: string[]): void {
  const attrs = renderAttrs([
    ["Name", gr.name],
    ["RangeStart", gr.rangeStart],
    ["RangeEnd", gr.rangeEnd],
    ["Description", gr.description || undefined],
    ["Unfiltered", gr.unfiltered || undefined],
    ["Security", gr.security],
  ]);
  const hasChildren = gr.groupRanges.length > 0 || gr.groupAddresses.length > 0;
  if (!hasChildren) {
    out.push(`${pad(depth)}<GroupRange${attrs} />`);
    return;
  }
  out.push(`${pad(depth)}<GroupRange${attrs}>`);
  for (const sub of gr.groupRanges) {
    writeGaExportRange(sub, style, depth + 1, out);
  }
  for (const ga of gr.groupAddresses) {
    const gaAttrs = renderAttrs([
      ["Name", ga.name],
      ["Address", formatGroupAddressByStyle(ga.address, style)],
      ["Central", ga.central || undefined],
      ["Unfiltered", ga.unfiltered || undefined],
      ["Description", ga.description || undefined],
      ["DPTs", ga.datapointType || undefined],
      ["Security", ga.security],
    ]);
    out.push(`${pad(depth + 1)}<GroupAddress${gaAttrs} />`);
  }
  out.push(`${pad(depth)}</GroupRange>`);
}

/**
 * Generates an official ETS Group Address XML export (`http://knx.org/xml/ga-export/01`),
 * directly importable into ETS4, ETS5, and ETS6 without project signature requirements.
 */
export function serializeGroupAddressesExportXml(
  groupRanges: KnxGroupRange[],
  style: GroupAddressStyle = "ThreeLevel",
): string {
  const out: string[] = [
    `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`,
    `<GroupAddress-Export xmlns="http://knx.org/xml/ga-export/01">`,
  ];
  for (const gr of groupRanges) {
    writeGaExportRange(gr, style, 1, out);
  }
  out.push(`</GroupAddress-Export>`);
  return out.join(CRLF);
}

function escapeCsvCell(val: string, sep: string): string {
  if (val.includes('"') || val.includes(sep) || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export interface GroupAddressCsvExportOptions {
  /** Column separator (default: `","`). */
  separator?: "," | ";" | "\t";
  /** Include header row (default: `true`). */
  includeHeader?: boolean;
}

/**
 * Generates an ETS-compatible Group Addresses CSV table.
 */
export function serializeGroupAddressesCsv(
  groupRanges: KnxGroupRange[],
  style: GroupAddressStyle = "ThreeLevel",
  options: GroupAddressCsvExportOptions = {},
): string {
  const sep = options.separator ?? ",";
  const rows: string[] = [];
  if (options.includeHeader !== false) {
    rows.push(
      ["Main", "Middle", "Sub", "Address", "Central", "Unfiltered", "Description", "DatapointType", "Security"]
        .map((c) => escapeCsvCell(c, sep))
        .join(sep),
    );
  }

  const walk = (gr: KnxGroupRange, pathNames: string[]) => {
    const nextPath = [...pathNames, gr.name];
    for (const sub of gr.groupRanges) {
      walk(sub, nextPath);
    }
    for (const ga of gr.groupAddresses) {
      const mainName = nextPath[0] ?? "";
      const middleName = nextPath[1] ?? "";
      const cols = [
        mainName,
        middleName,
        ga.name,
        formatGroupAddressByStyle(ga.address, style),
        ga.central ? "true" : "",
        ga.unfiltered ? "true" : "",
        ga.description ?? "",
        ga.datapointType ?? "",
        ga.security ?? "Auto",
      ];
      rows.push(cols.map((c) => escapeCsvCell(c, sep)).join(sep));
    }
  };

  for (const gr of groupRanges) {
    walk(gr, []);
  }
  return rows.join(CRLF);
}

// ============================================================================
// 5. Merge Manufacturer XMLs (Hardware.xml / Catalog.xml / Baggages.xml) on `.knxprod` import
// ============================================================================

/**
 * Extracts all direct child elements of a given tag name inside a container tag from a KNX manufacturer XML
 * and merges any elements whose `Id="..."` is not already present in `existingXml`.
 */
export function mergeManufacturerContainerXml(
  existingXml: string,
  incomingXml: string,
  containerTag: string,
  itemTag: string,
): string {
  const extractItemsById = (xml: string): Map<string, string> => {
    const items = new Map<string, string>();
    const clean = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
    const openRe = new RegExp(`<${itemTag}\\b[^>]*\\bId="([^"]+)"[^>]*>`, "g");
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(clean)) !== null) {
      const id = m[1];
      const start = m.index;
      const openTag = m[0];
      if (openTag.endsWith("/>")) {
        items.set(id, openTag);
        continue;
      }
      // Find matching closing tag accounting for nested same-name tags (e.g. Hardware or CatalogSection)
      let depth = 1;
      const cursor = start + openTag.length;
      const tagRe = new RegExp(`<(/?)${itemTag}\\b([^>]*)>`, "g");
      tagRe.lastIndex = cursor;
      let endIdx = -1;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(clean)) !== null) {
        const isClosing = tm[1] === "/";
        const isSelfClosing = tm[2].endsWith("/");
        if (isClosing) {
          depth--;
          if (depth === 0) {
            endIdx = tm.index + tm[0].length;
            break;
          }
        } else if (!isSelfClosing) {
          depth++;
        }
      }
      if (endIdx !== -1) {
        items.set(id, clean.slice(start, endIdx));
        openRe.lastIndex = endIdx;
      }
    }
    return items;
  };

  const existingIds = new Set(extractItemsById(existingXml).keys());
  const incomingItems = extractItemsById(incomingXml);
  const toInsert: string[] = [];

  for (const [id, raw] of incomingItems.entries()) {
    if (!existingIds.has(id)) {
      toInsert.push(raw);
    }
  }
  if (toInsert.length === 0) return existingXml;

  // Insert right before the LAST closing `</containerTag>` inside Manufacturer
  const closeToken = `</${containerTag}>`;
  const idx = existingXml.lastIndexOf(closeToken);
  if (idx === -1) return existingXml;

  return `${existingXml.slice(0, idx)}${CRLF}        ${toInsert.join(`${CRLF}        `)}${CRLF}      ${existingXml.slice(idx)}`;
}
