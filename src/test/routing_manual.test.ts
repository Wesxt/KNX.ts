import { KNXRouting } from '../connection/KNXRouting';
import { ServiceMessage } from '../@types/interfaces/ServiceMessage';
import { getLocalIP } from '../utils/localIp';

// Configuration for KNX Routing
// Standard Multicast Address for KNXnet/IP Routing
const MULTICAST_IP = '224.0.23.12';
const PORT = 3671;

// async function sleep(ms: number) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }


let routing: KNXRouting;

async function testRouting() {
    console.log(`
--- Testing Routing (Multicast Group: ${MULTICAST_IP}:${PORT}) ---`);

    const localIp = getLocalIP();
    console.log(`Using Local IP: ${localIp}`);

    const client = new KNXRouting({
        ip: MULTICAST_IP,
        port: PORT,
        localIp: localIp
    });

    routing = client;

    client.on('connected', () => {
        console.log('[Routing] Socket Bound & Member of Multicast Group!');
    });

    client.on('error', (err) => {
        console.error('[Routing] Error:', err.message);
    });

    client.on('indication', (msg: ServiceMessage) => {
        console.log('[Routing] Received Indication:', msg.constructor.name);
        // If you want to see the raw data:
        console.log('RAW CEMI:', msg.toBuffer());
    });

    client.on('routing_busy', (busy) => {
        console.warn('[Routing] Server is BUSY. Wait time:', busy.waitTime, 'ms');
    });

    client.on('routing_lost_message', (lost) => {
        console.error('[Routing] Messages LOST:', lost.lostMessages);
    });

    try {
        console.log('[Routing] Connecting...');
        await client.connect();
    } catch (e: any) {
        console.error("[Routing] Failed:", e.message);
    }
}

testRouting().catch(console.error);

async function gracefulShutdown(reason: string) {
    console.log(`[Shutdown] ${reason}`);
    try {
        if (routing) {
            console.log('[Routing] Disconnecting...');
            routing.disconnect();
        }
        await new Promise(res => setTimeout(res, 200));
    } catch (err) {
        console.error('[Shutdown] Error during disconnect:', err);
    } finally {
        process.exit(0);
    }
}

process.once('SIGINT', () => gracefulShutdown('SIGINT received (Ctrl+C)'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM received'));
process.once('SIGBREAK', () => gracefulShutdown('SIGBREAK received (Windows)'));
process.once('SIGUSR2' as any, () => gracefulShutdown('SIGUSR2 received (restart)'));
process.once('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    void gracefulShutdown('uncaughtException');
});
