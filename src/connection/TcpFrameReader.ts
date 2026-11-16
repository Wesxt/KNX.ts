import { KNXnetIPHeader } from "../core/KNXnetIPHeader";

export interface TcpFrameReaderOptions {
  /**
   * Maximum frame size to store in memory (default: 4096 octets, matching KNX CCM limit of 4080 + headers).
   * Frames declaring a larger total length up to 65535 octets have their body skipped without allocating
   * buffer space, per KNX Standard 03_08_02 §8.4.3.3.
   */
  maxFrameLength?: number;
  /**
   * If true, frames with protocol version !== 0x10 throw a fatal stream error instead of being skipped.
   * Default: false (frames with valid length but unsupported version are skipped without dropping TCP).
   */
  closeOnUnsupportedVersion?: boolean;
}

/**
 * Reassembles KNXnet/IP frames from a TCP byte stream according to KNX Standard 03_08_02 §8.4.3.3.
 *
 * Handles arbitrary TCP segmentation (1-byte chunks, multiple frames per chunk, oversized frames).
 * Throws an Error when the KNXnet/IP header is malformed (header length !== 0x06 or total length < 6),
 * signaling the caller to close the TCP connection immediately.
 */
export class TcpFrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private skipRemaining: number = 0;
  private readonly maxFrameLength: number;
  private readonly closeOnUnsupportedVersion: boolean;

  constructor(options: TcpFrameReaderOptions = {}) {
    this.maxFrameLength = options.maxFrameLength ?? 4096;
    this.closeOnUnsupportedVersion = options.closeOnUnsupportedVersion ?? false;
  }

  /**
   * Feeds a newly received TCP chunk and returns all complete, valid KNXnet/IP frames.
   * @throws Error if a malformed KNXnet/IP header is encountered (caller must close the TCP socket).
   */
  public push(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) return [];

    let incoming = chunk;

    // If we are currently skipping the body of an oversized frame (03_08_02 §8.4.3.3)
    if (this.skipRemaining > 0) {
      if (incoming.length <= this.skipRemaining) {
        this.skipRemaining -= incoming.length;
        return [];
      }
      incoming = incoming.subarray(this.skipRemaining);
      this.skipRemaining = 0;
    }

    this.buffer = this.buffer.length === 0 ? Buffer.from(incoming) : Buffer.concat([this.buffer, incoming]);
    const frames: Buffer[] = [];

    while (this.buffer.length >= KNXnetIPHeader.HEADER_SIZE_10) {
      const headerLength = this.buffer.readUInt8(0);
      const protocolVersion = this.buffer.readUInt8(1);
      const totalLength = this.buffer.readUInt16BE(4);

      if (headerLength !== KNXnetIPHeader.HEADER_SIZE_10) {
        this.reset();
        throw new Error(`Malformed KNXnet/IP header on TCP stream: invalid header length 0x${headerLength.toString(16)}`);
      }

      if (totalLength < KNXnetIPHeader.HEADER_SIZE_10) {
        this.reset();
        throw new Error(`Malformed KNXnet/IP header on TCP stream: invalid total length ${totalLength}`);
      }

      if (this.closeOnUnsupportedVersion && protocolVersion !== KNXnetIPHeader.KNXNETIP_VERSION_10) {
        this.reset();
        throw new Error(
          `Malformed KNXnet/IP header on TCP stream: unsupported protocol version 0x${protocolVersion.toString(16)}`,
        );
      }

      // Oversized frame: skip body without buffering (03_08_02 §8.4.3.3)
      if (totalLength > this.maxFrameLength) {
        if (this.buffer.length >= totalLength) {
          this.buffer = this.buffer.subarray(totalLength);
          continue;
        } else {
          this.skipRemaining = totalLength - this.buffer.length;
          this.buffer = Buffer.alloc(0);
          break;
        }
      }

      // Wait for remaining octets of current frame
      if (this.buffer.length < totalLength) {
        break;
      }

      const frame = Buffer.from(this.buffer.subarray(0, totalLength));
      this.buffer = this.buffer.subarray(totalLength);

      // Skip frame if protocol version is unsupported when closeOnUnsupportedVersion is false
      if (protocolVersion !== KNXnetIPHeader.KNXNETIP_VERSION_10) {
        continue;
      }

      frames.push(frame);
    }

    return frames;
  }

  /**
   * Returns true if there is a partial frame or skipped body currently in progress.
   */
  public get hasPendingBytes(): boolean {
    return this.buffer.length > 0 || this.skipRemaining > 0;
  }

  /**
   * Clears all buffered state.
   */
  public reset(): void {
    this.buffer = Buffer.alloc(0);
    this.skipRemaining = 0;
  }
}
