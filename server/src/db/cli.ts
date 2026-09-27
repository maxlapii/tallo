import 'dotenv/config';
import { loadConfig } from '../config/index.js';
import { StoreRegistry } from '../tenancy/registry.js';
import { SEED_PASSWORD, SEED_USERS, seed, seedUser } from './seed.js';

const command = process.argv[2];
const config = loadConfig();

function openRegistry(): StoreRegistry {
  return new StoreRegistry(config.dataDir);
}

/** Ensures the demo store exists (created with the seeded admin) and returns its db. */
function ensureDemoStore(registry: StoreRegistry) {
  if (!registry.exists(config.demoStore)) {
    registry.createStore({
      slug: config.demoStore,
      name: 'Demo Store',
      admin: { username: 'admin', password: SEED_PASSWORD, fullName: 'Store Admin' },
    });
  }
  return registry.openStore(config.demoStore);
}

switch (command) {
  case 'migrate': {
    const registry = openRegistry();
    const stores = registry.list();
    for (const s of stores) registry.openStore(s.slug); // opening applies pending migrations
    console.log(
      stores.length
        ? `Migrated ${stores.length} store(s): ${stores.map((s) => s.slug).join(', ')}`
        : 'No stores yet.',
    );
    registry.closeAll();
    break;
  }
  case 'seed': {
    const registry = openRegistry();
    const db = ensureDemoStore(registry);
    seed(db);
    for (const u of SEED_USERS) seedUser(db, { ...u, password: SEED_PASSWORD });
    console.log(`Seed data applied to store "${config.demoStore}".`);
    registry.closeAll();
    break;
  }
  case 'reset': {
    if (config.nodeEnv === 'production') {
      console.error('Refusing to reset the database in production.');
      process.exit(1);
    }
    const registry = openRegistry();
    if (registry.exists(config.demoStore)) registry.deleteStore(config.demoStore);
    const db = ensureDemoStore(registry);
    seed(db);
    console.log(`Store "${config.demoStore}" reset, migrated, and seeded.`);
    registry.closeAll();
    break;
  }
  default:
    console.error('Usage: cli.ts <migrate|seed|reset>');
    process.exit(1);
}
