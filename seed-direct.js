const fs = require('fs');
const path = require('path');

// Read .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

// Parse it
const lines = envContent.split('\n');
let directUrl = '';

for (const line of lines) {
  if (line.startsWith('DIRECT_DATABASE_URL=')) {
    directUrl = line.split('=')[1].replace(/"/g, '');
    break;
  }
}

if (!directUrl) {
  console.error('❌ Could not find DIRECT_DATABASE_URL in .env.local');
  process.exit(1);
}

// Set it as DATABASE_URL
process.env.DATABASE_URL = directUrl;

// Now run the seed
require('./scripts/seed-community-spaces.ts');
