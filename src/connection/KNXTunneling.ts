import dgram from 'dgram';
import net from 'net';
import { KNXClient, KNXClientOptions } from './KNXClient';
import { KNXnetIPHeader } from '../core/KNXnetIPHeader';
import { HPAI, CRI, CRD } from '../core/KNXnetIPStructures';
import { KNXnetIPServiceType, KNXnetIPErrorCodes, HostProtocolCode, ConnectionType } from '../core/enum/KNXnetIPEnum';
import { CEMI } from '../core/CEMI';
import { ServiceMessage } from '../@types/interfaces/ServiceMessage';

export interface KNXTunnelingOptions extends KNXClientOptions {
    transport?: 'UDP' | 'TCP';
    connectionType?: ConnectionType;
}

export class KNXTunneling extends KNXClient {
    private channelId: number = 0;
    private sequenceNumber: number = 0;
    private rxSequenceNumber: number = 0;
    private isConnected: boolean = false;
    private tcpBuffer: Buffer = Buffer.alloc(0);
    public assignedAddress: number = 0; // Assigned Individual Address

    // Heartbeat
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private heartbeatFailures: number = 0;
    private heartbeatRetryTimer: NodeJS.Timeout | null = null;

    // Message Queue
    private msgQueue: { packet: Buffer, resolve: () => void, reject: (e: Error) => void; }[] = [];
    private isSending: boolean = false;
    private pendingAck: { seq: number, timer: NodeJS.Timeout, retryCount: number, currentMsg: any; } | null = null;

    // Disconnect
    private disconnectTimeout: NodeJS.Timeout | null = null;

    constructor(options: KNXTunnelingOptions) {
        super(options);
        this._transport = options.transport || 'UDP';
        if (!(this.options as KNXTunnelingOptions).connectionType) {
            (this.options as KNXTunnelingOptions).connectionType = ConnectionType.TUNNEL_CONNECTION;
        }
    }

    async connect(): Promise<void> {
        this.rxSequenceNumber = 0;
        if (this._transport === 'TCP') {
            await this.connectTCP();
        } else {
            await this.connectUDP();
        }
    }

    private async connectUDP(): Promise<void> {
        this.socket = dgram.createSocket('udp4');

        // Manejo de mensajes entrantes
        this.socket.on('message', (msg) => this.handleMessage(msg));

        // ERROR GLOBAL: Si el socket muere, desconectamos
        this.socket.on('error', (err) => {
            this.emit('error', err);
            this.disconnect();
        });

        return new Promise((resolve, reject) => {
            // Listener temporal para atrapar errores DURANTE la conexión inicial
            const errorListener = (err: Error) => {
                this.removeListener('connected', successListener);
                reject(err);
            };

            const successListener = (info: any) => {
                this.removeListener('error', errorListener); // Limpiamos el listener de error temporal
                resolve();
            };

            // Escuchamos ambos eventos
            this.once('error', errorListener);
            this.once('connected', successListener);

            // Bind
            (this.socket as dgram.Socket).bind(this.options.localPort, this.options.localIp, () => {
                try {
                    this.sendConnectRequest();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    private async connectTCP(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();

            (this.socket as net.Socket).connect(this.options.port!, this.options.ip!, () => {
                this.sendConnectRequest();
                this.once('connected', resolve);
            });

            (this.socket as net.Socket).on('data', (data) => {
                this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);
                while (this.tcpBuffer.length >= 6) {
                    const totalLength = this.tcpBuffer.readUInt16BE(4);
                    if (this.tcpBuffer.length >= totalLength) {
                        const frame = this.tcpBuffer.subarray(0, totalLength);
                        this.tcpBuffer = this.tcpBuffer.subarray(totalLength);
                        this.handleMessage(frame);
                    } else {
                        break;
                    }
                }
            });

            (this.socket as net.Socket).on('error', (err) => {
                this.emit('error', err);
                this.disconnect();
                reject(err);
            });

            (this.socket as net.Socket).on('close', () => this.disconnect());
        });
    }

    private sendConnectRequest() {
        const localPort = this._transport === 'UDP'
            ? (this.socket as dgram.Socket).address().port
            : (this.socket as net.Socket).localPort!;

        const hpai = new HPAI(
            this._transport === 'TCP' ? HostProtocolCode.IPV4_TCP : HostProtocolCode.IPV4_UDP,
            this.options.localIp!,
            localPort
        );
        // @ts-ignore
        const cri = new CRI(this.options.connectionType!);

        const header = new KNXnetIPHeader(KNXnetIPServiceType.CONNECT_REQUEST, 0);
        // CORRECCIÓN
        // Estructura: HPAI (Control) -> HPAI (Data) -> CRI
        const body = Buffer.concat([hpai.toBuffer(), hpai.toBuffer(), cri.toBuffer()]);
        header.totalLength = 6 + body.length;

        this.sendRaw(Buffer.concat([header.toBuffer(), body]));
    }

    disconnect() {
        if (this.isConnected && this.channelId) {
            const localPort = this._transport === 'UDP'
                ? (this.socket as dgram.Socket).address().port
                : (this.socket as net.Socket).localPort!;
            const hpai = new HPAI(this._transport === 'TCP' ? HostProtocolCode.IPV4_TCP : HostProtocolCode.IPV4_UDP, this.options.localIp!, localPort);

            const header = new KNXnetIPHeader(KNXnetIPServiceType.DISCONNECT_REQUEST, 0);
            const body = Buffer.concat([Buffer.from([this.channelId, 0x00]), hpai.toBuffer()]);
            header.totalLength = 6 + body.length;
            this.sendRaw(Buffer.concat([header.toBuffer(), body]));

            // Graceful disconnect: Wait for response or timeout (1s)
            this.disconnectTimeout = setTimeout(() => {
                this.closeSocket();
            }, 1000);
        } else {
            this.closeSocket();
        }
    }

    private closeSocket() {
        this.stopHeartbeat();
        if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
        }
        this.isConnected = false;
        this.channelId = 0;

        if (this.socket) {
            if (this._transport === 'UDP') (this.socket as dgram.Socket).close();
            else (this.socket as net.Socket).destroy();
            this.socket = null;
        }
        this.emit('disconnected');
    }

    // #region Message Queue & Sending
    async send(cemi: ServiceMessage | Buffer): Promise<void> {
        if (!this.isConnected) throw new Error("Not connected");

        const cemiBuffer = Buffer.isBuffer(cemi) ? cemi : cemi.toBuffer();
        return new Promise((resolve, reject) => {
            this.msgQueue.push({ packet: cemiBuffer, resolve, reject });
            this.processQueue();
        });
    }

    private processQueue() {
        if (this.isSending || this.msgQueue.length === 0) return;

        this.isSending = true;
        const msg = this.msgQueue.shift()!;

        const isDeviceMgmt = (this.options as KNXTunnelingOptions).connectionType === ConnectionType.DEVICE_MGMT_CONNECTION;
        const serviceType = isDeviceMgmt ? KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST : KNXnetIPServiceType.TUNNELLING_REQUEST;

        const header = new KNXnetIPHeader(serviceType, 0);
        const connHeader = Buffer.from([0x04, this.channelId, this.sequenceNumber, 0x00]);
        header.totalLength = 6 + connHeader.length + msg.packet.length;
        const packet = Buffer.concat([header.toBuffer(), connHeader, msg.packet]);

        this.pendingAck = {
            seq: this.sequenceNumber,
            timer: setTimeout(() => this.handleAckTimeout(), 1000),
            retryCount: 0,
            currentMsg: msg
        };

        this.sendRaw(packet);
    }

    private handleAckTimeout() {
        if (!this.pendingAck) return;

        if (this.pendingAck.retryCount < 1) { // 1 retry
            this.pendingAck.retryCount++;
            const msg = this.pendingAck.currentMsg;

            const isDeviceMgmt = (this.options as KNXTunnelingOptions).connectionType === ConnectionType.DEVICE_MGMT_CONNECTION;
            const serviceType = isDeviceMgmt ? KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST : KNXnetIPServiceType.TUNNELLING_REQUEST;

            const header = new KNXnetIPHeader(serviceType, 0);
            const connHeader = Buffer.from([0x04, this.channelId, this.pendingAck.seq, 0x00]);
            header.totalLength = 6 + connHeader.length + msg.packet.length;
            const packet = Buffer.concat([header.toBuffer(), connHeader, msg.packet]);

            this.sendRaw(packet);
            this.pendingAck.timer = setTimeout(() => this.handleAckTimeout(), 1000);
        } else {
            // Fail
            const reject = this.pendingAck.currentMsg.reject;
            this.pendingAck = null;
            this.isSending = false;
            reject(new Error("Tunneling ACK Timeout"));
            this.closeSocket();
        }
    }
    // #endregion

    // #region Tunneling Features
    public async getFeature(featureId: number): Promise<Buffer> {
        if (!this.isConnected) throw new Error("Not connected");
        return new Promise((resolve, reject) => {
            const header = new KNXnetIPHeader(KNXnetIPServiceType.TUNNELLING_FEATURE_GET, 0);
            const connHeader = Buffer.from([0x04, this.channelId, this.sequenceNumber, 0x00]);
            const body = Buffer.from([featureId, 0x00]); // FeatureID + Reserved
            header.totalLength = 6 + connHeader.length + body.length;

            const listener = (msg: Buffer) => {
                try {
                    const hdr = KNXnetIPHeader.fromBuffer(msg);
                    if (hdr.serviceType === KNXnetIPServiceType.TUNNELLING_FEATURE_RESPONSE) {
                        const respBody = msg.subarray(6);
                        // ConnHeader(4) + FeatureID(1) + ReturnCode(1) + Value(n)
                        if (respBody[0] === 0x04 && respBody[1] === this.channelId && respBody[2] === this.sequenceNumber) {
                            if (respBody[4] === featureId) {
                                this.removeListener('raw_message', listener);
                                const returnCode = respBody[5];
                                if (returnCode === KNXnetIPErrorCodes.E_NO_ERROR) {
                                    resolve(respBody.subarray(6));
                                } else {
                                    reject(new Error(`Feature Error: 0x${returnCode.toString(16)}`));
                                }
                            }
                        }
                    }
                } catch (e) { }
            };
            this.on('raw_message', listener);

            // Timeout for feature get
            setTimeout(() => {
                this.removeListener('raw_message', listener);
                reject(new Error("Feature GET Timeout"));
            }, 3000);

            this.sendRaw(Buffer.concat([header.toBuffer(), connHeader, body]));
            // Increment sequence number for the next request (Feature Get uses the seq number)
            this.sequenceNumber = (this.sequenceNumber + 1) & 0xFF;
        });
    }
    // #endregion

    private handleMessage(msg: Buffer) {
        this.emit('raw_message', msg);
        try {
            const header = KNXnetIPHeader.fromBuffer(msg);
            const body = msg.subarray(6);

            switch (header.serviceType) {
                case KNXnetIPServiceType.CONNECT_RESPONSE:
                    const status = body[1];
                    if (status === KNXnetIPErrorCodes.E_NO_ERROR) {
                        this.channelId = body[0];
                        this.sequenceNumber = 0;
                        this.rxSequenceNumber = 0;
                        this.isConnected = true;

                        // Parse CRD
                        if (body.length >= 14) {
                            const crd = CRD.fromBuffer(body.subarray(10));
                            this.assignedAddress = crd.knxAddress;
                            this.emit('connected', { channelId: this.channelId, assignedAddress: crd.knxAddress });
                        } else {
                            this.emit('connected', { channelId: this.channelId });
                        }
                        this.startHeartbeat();
                    } else {
                        this.emit('error', new Error(`Connect Error: 0x${status.toString(16)}`));
                    }
                    break;
                case KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE:
                    if (body[0] === this.channelId && body[1] === KNXnetIPErrorCodes.E_NO_ERROR) {
                        this.heartbeatFailures = 0;
                        if (this.heartbeatRetryTimer) {
                            clearTimeout(this.heartbeatRetryTimer);
                            this.heartbeatRetryTimer = null;
                        }
                    }
                    break;
                case KNXnetIPServiceType.CONNECTIONSTATE_REQUEST:
                    if (body[0] === this.channelId) {
                        const respHeader = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_RESPONSE, 0);
                        const respBody = Buffer.from([this.channelId, KNXnetIPErrorCodes.E_NO_ERROR]);
                        respHeader.totalLength = 6 + respBody.length;
                        this.sendRaw(Buffer.concat([respHeader.toBuffer(), respBody]));
                    }
                    break;
                case KNXnetIPServiceType.TUNNELLING_REQUEST:
                    this.handleRequest(body, KNXnetIPServiceType.TUNNELLING_ACK);
                    break;
                case KNXnetIPServiceType.DEVICE_CONFIGURATION_REQUEST:
                    this.handleRequest(body, KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK);
                    break;
                case KNXnetIPServiceType.TUNNELLING_ACK:
                case KNXnetIPServiceType.DEVICE_CONFIGURATION_ACK:
                    if (this.pendingAck && body[2] === this.pendingAck.seq) {
                        clearTimeout(this.pendingAck.timer);
                        const resolve = this.pendingAck.currentMsg.resolve;
                        this.pendingAck = null;
                        this.isSending = false;
                        this.sequenceNumber = (this.sequenceNumber + 1) & 0xFF;
                        resolve();
                        this.processQueue();
                    }
                    break;
                case KNXnetIPServiceType.DISCONNECT_REQUEST:
                    // Server closed connection
                    this.closeSocket();
                    break;
                case KNXnetIPServiceType.DISCONNECT_RESPONSE:
                    this.closeSocket();
                    break;
                case KNXnetIPServiceType.TUNNELLING_FEATURE_INFO:
                    // Body: ConnHeader(4) + FeatureID(1) + Len(1) + Value...
                    if (body[0] === 0x04 && body[1] === this.channelId) { // Check Conn Header length & Channel ID
                        const featureId = body[4];
                        const val = body.subarray(6);
                        this.emit('feature_info', featureId, val);
                    }
                    break;
            }
        } catch (e) {
            this.emit('error', e);
        }
    }

    private handleRequest(body: Buffer, ackType: KNXnetIPServiceType) {
        const seq = body[2];

        // Check for sequence number
        if (seq === this.rxSequenceNumber) {
            // Correct sequence
            this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
            this.rxSequenceNumber = (this.rxSequenceNumber + 1) & 0xFF;

            try {
                const len = body[0]; // Connection Header Length
                const data = body.subarray(len);
                const cemi = CEMI.fromBuffer(data);
                this.emit('indication', cemi);
                this.emit('raw_indication', data);
            } catch (e) { }
        } else if (seq === ((this.rxSequenceNumber - 1) & 0xFF)) {
            // Duplicate frame, send ACK again but don't process
            this.sendAck(ackType, seq, KNXnetIPErrorCodes.E_NO_ERROR);
        } else {
            // Out of sequence, discard (TCP handles this mostly, but for UDP/Tunneling logic)
            // Do not ACK
        }
    }

    private sendAck(type: KNXnetIPServiceType, seq: number, status: number) {
        const header = new KNXnetIPHeader(type, 0);
        const body = Buffer.from([0x04, this.channelId, seq, status]);
        header.totalLength = 6 + body.length;
        this.sendRaw(Buffer.concat([header.toBuffer(), body]));
    }

    private sendRaw(buffer: Buffer) {
        if (!this.socket) return;
        if (this._transport === 'UDP') {
            (this.socket as dgram.Socket).send(buffer, this.options.port!, this.options.ip!);
        } else {
            (this.socket as net.Socket).write(buffer);
        }
    }

    private startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatFailures = 0;

        // Spec: Check every 60s
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeatRequest();
        }, 60000);
    }

    private sendHeartbeatRequest() {
        const localPort = this._transport === 'UDP'
            ? (this.socket as dgram.Socket).address().port
            : (this.socket as net.Socket).localPort!;

        const hpai = new HPAI(this._transport === 'TCP' ? HostProtocolCode.IPV4_TCP : HostProtocolCode.IPV4_UDP, this.options.localIp!, localPort);
        const header = new KNXnetIPHeader(KNXnetIPServiceType.CONNECTIONSTATE_REQUEST, 0);
        const body = Buffer.concat([Buffer.from([this.channelId, 0x00]), hpai.toBuffer()]);
        header.totalLength = 6 + body.length;

        this.sendRaw(Buffer.concat([header.toBuffer(), body]));

        // Check timeout in 10s
        if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
        this.heartbeatRetryTimer = setTimeout(() => this.handleHeartbeatTimeout(), 10000);
    }

    private handleHeartbeatTimeout() {
        this.heartbeatFailures++;
        if (this.heartbeatFailures >= 3) {
            this.emit('error', new Error("Heartbeat failed 3 times"));
            this.disconnect();
        } else {
            // Immediate retry
            this.sendHeartbeatRequest();
        }
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.heartbeatRetryTimer) clearTimeout(this.heartbeatRetryTimer);
        this.heartbeatTimer = null;
        this.heartbeatRetryTimer = null;
    }
}
