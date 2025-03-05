export interface LocalEndPoint {
    host: string;
    port: number;
    toBytes: () => Buffer<ArrayBuffer>;
}