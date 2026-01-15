import { pool } from '../server/db';
import { readFileSync } from 'fs';
import { join } from 'path';

async function applyMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Applying configuration tables migration...');
    
    // Read migration file
    const migrationPath = join(__dirname, '../db/migrations/001_create_config_tables.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Start transaction
    await client.query('BEGIN');
    
    // Execute migration
    await client.query(migrationSQL);
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('📊 Created tables:');
    console.log('  - trading_config (dynamic configuration storage)');
    console.log('  - config_change (audit trail)');
    console.log('  - config_preset (preset templates)');
    console.log('');
    console.log('🎯 Default presets created:');
    console.log('  - conservative (6/7/5 signals, 1% risk)');
    console.log('  - balanced (5/6/4 signals, 2% risk)');
    console.log('  - aggressive (4/5/3 signals, 3% risk)');
    console.log('');
    console.log('🔧 Next steps:');
    console.log('  1. Restart the bot to load dynamic configuration');
    console.log('  2. Access Settings > Trading Configuration in dashboard');
    console.log('  3. Select a preset or create custom configuration');
    console.log('  4. Changes will apply in real-time without restart');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
