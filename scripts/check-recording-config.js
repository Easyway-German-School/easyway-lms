#!/usr/bin/env node

/**
 * Check if class recording is configured on Vercel.
 * 
 * Run locally:
 *   node scripts/check-recording-config.js
 * 
 * Or in a Vercel deployment, add to your build:
 *   npm run check-recording-config
 */

const required = [
  'RECORDING_S3_BUCKET',
  'RECORDING_S3_REGION',
  'RECORDING_S3_ACCESS_KEY',
  'RECORDING_S3_SECRET',
];

const optional = [
  'RECORDING_S3_ENDPOINT',
  'RECORDING_PUBLIC_BASE_URL',
  'RECORDING_VARIANT',
];

const fallbacks = [
  'STORAGE_S3_BUCKET',
  'STORAGE_S3_REGION',
  'STORAGE_S3_ACCESS_KEY',
  'STORAGE_S3_SECRET',
];

console.log('\n' + '='.repeat(70));
console.log('  CLASS RECORDING CONFIGURATION CHECK');
console.log('='.repeat(70) + '\n');

let recordingConfigured = true;

console.log('📋 Required Variables (must be set):');
console.log('-'.repeat(70));

for (const key of required) {
  const value = process.env[key];
  if (value) {
    const masked = value.length > 4 
      ? value.slice(0, 2) + '*'.repeat(Math.min(10, value.length - 4)) + value.slice(-2)
      : '*'.repeat(value.length);
    console.log(`  ✅ ${key}: ${masked}`);
  } else {
    console.log(`  ❌ ${key}: MISSING`);
    recordingConfigured = false;
  }
}

console.log('\n📋 Fallback Variables (used if RECORDING_S3_* not set):');
console.log('-'.repeat(70));

let fallbackConfigured = false;
for (const key of fallbacks) {
  const value = process.env[key];
  if (value) {
    const masked = value.length > 4 
      ? value.slice(0, 2) + '*'.repeat(Math.min(10, value.length - 4)) + value.slice(-2)
      : '*'.repeat(value.length);
    console.log(`  ✅ ${key}: ${masked}`);
    fallbackConfigured = true;
  } else {
    console.log(`  ⏸️  ${key}: not set`);
  }
}

console.log('\n📋 Optional Variables (enhance recording):');
console.log('-'.repeat(70));

for (const key of optional) {
  const value = process.env[key];
  if (value) {
    console.log(`  ✅ ${key}: ${value}`);
  } else {
    console.log(`  ⏸️  ${key}: not set`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('  DIAGNOSIS');
console.log('='.repeat(70) + '\n');

if (recordingConfigured) {
  console.log('✅ RECORDING IS CONFIGURED');
  console.log('   Classes will be recorded automatically.\n');
} else if (fallbackConfigured) {
  console.log('⚠️  RECORDING IS USING STORAGE FALLBACK');
  console.log('   Using STORAGE_S3_* variables instead of RECORDING_S3_*');
  console.log('   This works, but a dedicated bucket is recommended.\n');
} else {
  console.log('❌ RECORDING IS NOT CONFIGURED');
  console.log('\n   Live classes WILL NOT be recorded.\n');
  console.log('   To fix:');
  console.log('   1. Create an S3-compatible bucket (R2, B2, AWS S3, MinIO)');
  console.log('   2. Set these on Vercel:');
  for (const key of required) {
    console.log(`      - ${key}`);
  }
  console.log('   3. Redeploy: vercel redeploy\n');
  console.log('   See RECORDING_TROUBLESHOOTING.md for detailed steps.\n');
}

// Also check LiveKit
console.log('📡 LiveKit Configuration:');
console.log('-'.repeat(70));

if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
  console.log('  ✅ LiveKit is configured\n');
} else {
  console.log('  ❌ LiveKit not properly configured');
  console.log('     Classrooms will not work at all\n');
}

// Check database
console.log('🗄️  Database Configuration:');
console.log('-'.repeat(70));

if (process.env.DATABASE_URL) {
  console.log('  ✅ DATABASE_URL is set\n');
} else {
  console.log('  ❌ DATABASE_URL is missing\n');
}

// Summary
console.log('='.repeat(70));
console.log('  NEXT STEPS');
console.log('='.repeat(70) + '\n');

if (recordingConfigured) {
  console.log('1. Join a live classroom');
  console.log('2. Watch Vercel function logs during class');
  console.log('3. Look for: "ensureRecordingStarted() → started egress ID: ..."');
  console.log('4. After class ends, check the Video Library → Watch shelf');
  console.log('5. If recording doesn\'t appear, run:');
  console.log('   curl -X POST https://yourdomain.com/api/live/recording/reconcile \\');
  console.log('     -H "Authorization: Bearer $CRON_SECRET"\n');
} else if (fallbackConfigured) {
  console.log('Recording will work but is not optimized.');
  console.log('Consider setting up dedicated RECORDING_S3_* variables.\n');
} else {
  console.log('BLOCKING: Set up recording storage first.');
  console.log('See RECORDING_TROUBLESHOOTING.md for step-by-step guide.\n');
}

process.exit(recordingConfigured ? 0 : 1);
