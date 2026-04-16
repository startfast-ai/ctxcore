import { createDatabase, createVecTable } from '../../src/database.js';
import type Database from 'better-sqlite3';

export function createTestDb(dimensions: number = 1024): Database.Database {
  const db = createDatabase(':memory:');
  createVecTable(db, dimensions);
  return db;
}
