import fs from "fs";
import Database from "better-sqlite3";
import {initializeSchema, runMigrations} from "./schema.js";

export function createDatabase(config) {
    if (config.dbPath !== ":memory:") {
        fs.mkdirSync(config.dataDir, {recursive: true});
    }

    const db = new Database(config.dbPath);
    initializeSchema(db);
    runMigrations(db, config);
    return db;
}
