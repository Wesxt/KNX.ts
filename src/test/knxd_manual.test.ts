import { KNXTunneling, KNXTunnelingOptions } from '../connection/KNXTunneling';
import { KNXRouting } from '../connection/KNXRouting';
import { ConnectionType } from '../core/enum/KNXnetIPEnum';
import { ServiceMessage } from '../@types/interfaces/ServiceMessage';
import { getLocalIP } from '../utils/localIp';

// Configuration for local knxd
const KNXD_IP = '192.168.1.6'; // Change if knxd is on another machine
const MULTICAST_IP = '224.0.23.12';
const PORT = 3671;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testTunneling() {
    console.log(`
--- Testing Tunneling (Target: ${KNXD_IP}:${PORT}) ---`);

    const options: KNXTunnelingOptions = {
        ip: KNXD_IP,
        port: PORT,
        connectionType: ConnectionType.TUNNEL_CONNECTION,
        localIp: getLocalIP(), // Let OS decide or use getLocalIP()
        transport: 'UDP'
    };

    const client = new KNXTunneling(options);

    client.on('connected', (info) => {
        console.log('[Tunneling] Connected!');
        console.log(`[Tunneling] Channel ID: ${client['channelId']}`);
        if (info) console.log('[Tunneling] Info:', info);
        // let data = 0;
        client.write("1/1/1", 5, { valueDpt5: 1 });
        client.write("1/1/1", 5, { valueDpt5: 62 });
        client.write("1/1/1", 5, { valueDpt5: 63 });
        client.write("1/1/1", 5, { valueDpt5: 64 });
        client.write("1/1/1", 5, { valueDpt5: 65 });

        // setInterval(() => {
        //     data++;
        //     client.write("1/1/1", 5, { valueDpt5: data });
        // }, 1000);
    });

    client.on('disconnected', () => {
        console.log('[Tunneling] Disconnected!');
    });

    client.on('error', (err) => {
        console.error('[Tunneling] Error:', err.message);
    });

    client.on('indication', (msg: ServiceMessage) => {
        console.log('CEMI', msg.constructor.name, msg.toBuffer());
        // console.log(util.inspect(msg.describe(), {
        //     showHidden: false,
        //     depth: null,
        //     colors: true
        // }));
        // console.log('[Tunneling] Received Indication (cEMI)');
    });

    client.on('raw_indication', (msg: Buffer) => {
        console.log('RAW', msg);
    });

    try {
        console.log('[Tunneling] Connecting...');
        await client.connect();

        // Keep connection alive for a few seconds to test Heartbeat
        // console.log('[Tunneling] Waiting 5 seconds...');
        // await sleep(5000);

        // console.log('[Tunneling] Disconnecting...');
        // client.disconnect();
        // // Wait for disconnect to complete
        // await sleep(1000);

    } catch (e: any) {
        console.error("[Tunneling] Failed:", e.message);
    }
    return client;
}

async function testRouting() {
    console.log(`
--- Testing Routing (Group: ${MULTICAST_IP}:${PORT}) ---`);

    const client = new KNXRouting({
        ip: MULTICAST_IP,
        port: PORT
    });

    client.on('connected', () => {
        console.log('[Routing] Socket Bound & Member of Multicast Group');
    });

    client.on('indication', (msg) => {
        console.log("[Routing] Received cEMI Indication");
    });

    client.on('routing_busy', (busy) => {
        console.log("[Routing] Received ROUTING_BUSY", busy);
    });

    client.on('routing_lost_message', (lost) => {
        console.log("[Routing] Received ROUTING_LOST_MESSAGE", lost);
    });

    client.on('error', (err) => {
        console.error('[Routing] Error:', err.message);
    });

    try {
        console.log('[Routing] Connecting...');
        await client.connect();

        console.log('[Routing] Waiting 5 seconds...');
        await sleep(5000);

        console.log('[Routing] Disconnecting...');
        client.disconnect();

    } catch (e: any) {
        console.error("[Routing] Failed:", e.message);
    }
    return client;
}

let clientTunneling: KNXTunneling | null = null;
// let clientRounting: KNXRouting | null = null;

(async () => {
    try {
        clientTunneling = await testTunneling();
        // await testRouting();
        // console.log("Tests Completed.");
        // process.exit(0);
    } catch (e) {
        console.error("Test Suite Failed:", e);
        process.exit(1);
    }
})();

async function gracefulShutdown(reason: string) {
    console.log(`[Shutdown] ${reason}`);
    try {
        if (clientTunneling) {
            console.log('[Tunneling] Disconnecting...');
            clientTunneling.disconnect();
        }
        // clientRounting.disconnect();
        await new Promise(res => setTimeout(res, 200));
    } catch (err) {
        console.error('[Shutdown] Error during disconnect:', err);
    } finally {
        // Salida limpia
        process.exit(0);
    }
}

// Señales comunes (incluye Windows)
process.once('SIGINT', () => gracefulShutdown('SIGINT received (Ctrl+C)'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM received'));
process.once('SIGBREAK', () => gracefulShutdown('SIGBREAK received (Windows)'));

// Para nodemon (restart)
process.once('SIGUSR2' as any, () => gracefulShutdown('SIGUSR2 received (restart)'));

// Capturar excepciones no atrapadas e intentar desconectar limpiamente
process.once('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    void gracefulShutdown('uncaughtException');
});