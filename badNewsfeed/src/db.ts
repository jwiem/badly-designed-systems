import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.join(process.cwd(), "app.db");
export const db = new Database(dbPath, { fileMustExist: false });

export function all<T = any> (sql: string, params?: any[]): T[] {
    return db.prepare(sql).all(params) as T[];
}

export function get<T = any>(sql: string, params?: any[]): T | undefined {
    return db.prepare(sql).get(params);
}

export function run(sql: string, params?: any[]): void {
    db.prepare(sql).run(params);
}
