import express from 'express';
export interface ServerConfig {
    port?: number;
    redisUrl?: string;
    messageQueueUrl?: string;
    corsOrigin?: string | boolean;
}
export declare function startServer(config?: ServerConfig): Promise<{
    app: ReturnType<typeof express>;
    shutdown: () => Promise<void>;
}>;
//# sourceMappingURL=index.d.ts.map