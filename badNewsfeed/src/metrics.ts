import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";

interface Metrics {
    dbQueries: number;
    dbTime: number; // in ms
}

export const asyncLocalStorage = new AsyncLocalStorage<Metrics>();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
    asyncLocalStorage.run({ start: Date.now(), queries: 0 }, () => {
        res.on("finish", () => {
            const metrics = asyncLocalStorage.getStore();
            if (metrics) {
                console.log(`[Metrics] ${req.method} ${req.originalUrl} - DB Queries: ${metrics.dbQueries}, DB Time: ${metrics.dbTime.toFixed(2)}ms`);
            }
        });
        next();
    });
}
