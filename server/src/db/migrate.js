import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const migrationsUrl = new URL('./migrations/', import.meta.url);
try {
  const directory = fileURLToPath(migrationsUrl);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const name of files) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied migration ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Database schema is up to date.');
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
