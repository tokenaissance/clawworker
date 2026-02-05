#!/usr/bin/env npx tsx
/**
 * Multi-tenant deployment script
 *
 * Usage:
 *   npm run deploy:tenant -- --tenant=alice
 *   npm run deploy:tenant -- --tenant=alice --instance-type=standard-4
 *   npm run deploy:tenant -- --tenant=alice --dry-run
 *
 * This script:
 * 1. Generates a tenant-specific wrangler configuration
 * 2. Creates the R2 bucket if it doesn't exist
 * 3. Deploys the Worker with tenant-specific settings
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface TenantConfig {
  tenant: string;
  instanceType: string;
  maxInstances: number;
  dryRun: boolean;
}

function parseArgs(): TenantConfig {
  const args = process.argv.slice(2);
  const config: TenantConfig = {
    tenant: '',
    instanceType: 'standard-1',
    maxInstances: 1,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--tenant=')) {
      config.tenant = arg.split('=')[1];
    } else if (arg.startsWith('--instance-type=')) {
      config.instanceType = arg.split('=')[1];
    } else if (arg.startsWith('--max-instances=')) {
      config.maxInstances = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    }
  }

  return config;
}

function validateTenant(tenant: string): void {
  if (!tenant) {
    console.error('Error: --tenant is required');
    console.error('Usage: npm run deploy:tenant -- --tenant=<name>');
    process.exit(1);
  }

  // Validate tenant name (alphanumeric, lowercase, hyphens allowed)
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(tenant)) {
    console.error('Error: Tenant name must be lowercase alphanumeric with optional hyphens');
    console.error('Examples: alice, bob, my-company, user123');
    process.exit(1);
  }

  // Reserved names
  const reserved = ['production', 'development', 'staging', 'test', 'dev', 'prod'];
  if (reserved.includes(tenant)) {
    console.error(`Error: "${tenant}" is a reserved environment name`);
    console.error('Use npm run deploy:prod or deploy:dev for these environments');
    process.exit(1);
  }
}

function generateWranglerConfig(config: TenantConfig): object {
  const { tenant, instanceType, maxInstances } = config;

  return {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": `paramita-cloud-${tenant}`,
    "main": "src/index.ts",
    "compatibility_date": "2025-05-06",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true },
    "assets": {
      "directory": "./dist/client",
      "not_found_handling": "single-page-application",
      "html_handling": "auto-trailing-slash",
      "binding": "ASSETS",
      "run_worker_first": true,
    },
    "rules": [
      { "type": "Text", "globs": ["**/*.html"], "fallthrough": false },
      { "type": "Data", "globs": ["**/*.png"], "fallthrough": false },
    ],
    "build": { "command": "npm run build" },
    "containers": [
      {
        "class_name": "Sandbox",
        "image": "./Dockerfile",
        "instance_type": instanceType,
        "max_instances": maxInstances,
      },
    ],
    "durable_objects": {
      "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }],
    },
    "migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }],
    "triggers": { "crons": ["*/5 * * * *"] },
    "browser": { "binding": "BROWSER" },
    "vars": {
      "ENVIRONMENT": tenant,
    },
    "r2_buckets": [
      {
        "binding": "MOLTBOT_BUCKET",
        "bucket_name": `moltbot-data-${tenant}`,
      },
    ],
  };
}

function ensureR2Bucket(tenant: string, dryRun: boolean): void {
  const bucketName = `moltbot-data-${tenant}`;

  console.log(`\n[R2] Checking bucket: ${bucketName}`);

  if (dryRun) {
    console.log(`[R2] (dry-run) Would create bucket: ${bucketName}`);
    return;
  }

  try {
    // Check if bucket exists
    execSync(`wrangler r2 bucket list | grep -q "^${bucketName}$"`, { stdio: 'pipe' });
    console.log(`[R2] Bucket already exists: ${bucketName}`);
  } catch {
    // Bucket doesn't exist, create it
    console.log(`[R2] Creating bucket: ${bucketName}`);
    try {
      execSync(`wrangler r2 bucket create ${bucketName}`, { stdio: 'inherit' });
      console.log(`[R2] Bucket created: ${bucketName}`);
    } catch (error) {
      console.error(`[R2] Failed to create bucket: ${error}`);
      process.exit(1);
    }
  }
}

function deploy(configPath: string, dryRun: boolean): void {
  console.log(`\n[Deploy] Using config: ${configPath}`);

  if (dryRun) {
    console.log('[Deploy] (dry-run) Would run: wrangler deploy --config', configPath);
    return;
  }

  try {
    execSync(`wrangler deploy --config ${configPath}`, { stdio: 'inherit' });
    console.log('\n[Deploy] Success!');
  } catch (error) {
    console.error('[Deploy] Failed:', error);
    process.exit(1);
  }
}

function main(): void {
  const config = parseArgs();
  validateTenant(config.tenant);

  console.log('='.repeat(60));
  console.log(`Multi-tenant Deployment: ${config.tenant}`);
  console.log('='.repeat(60));
  console.log(`Worker name:    paramita-cloud-${config.tenant}`);
  console.log(`R2 bucket:      moltbot-data-${config.tenant}`);
  console.log(`Instance type:  ${config.instanceType}`);
  console.log(`Max instances:  ${config.maxInstances}`);
  if (config.dryRun) {
    console.log('Mode:           DRY RUN (no changes will be made)');
  }

  // Generate wrangler config
  const wranglerConfig = generateWranglerConfig(config);
  const configPath = path.join(process.cwd(), `wrangler.tenant-${config.tenant}.jsonc`);

  console.log(`\n[Config] Generating: ${configPath}`);
  if (!config.dryRun) {
    fs.writeFileSync(configPath, JSON.stringify(wranglerConfig, null, 2));
  } else {
    console.log('[Config] (dry-run) Would generate config:');
    console.log(JSON.stringify(wranglerConfig, null, 2));
  }

  // Ensure R2 bucket exists
  ensureR2Bucket(config.tenant, config.dryRun);

  // Build first
  console.log('\n[Build] Running npm run build...');
  if (!config.dryRun) {
    execSync('npm run build', { stdio: 'inherit' });
  } else {
    console.log('[Build] (dry-run) Would run: npm run build');
  }

  // Deploy
  deploy(configPath, config.dryRun);

  // Cleanup generated config (optional - keep for debugging)
  // if (!config.dryRun) {
  //   fs.unlinkSync(configPath);
  // }

  console.log('\n' + '='.repeat(60));
  console.log('Deployment complete!');
  console.log('='.repeat(60));
  console.log(`\nNext steps:`);
  console.log(`1. Set secrets for the tenant:`);
  console.log(`   wrangler secret put ANTHROPIC_API_KEY --name paramita-cloud-${config.tenant}`);
  console.log(`   wrangler secret put CLAWDBOT_GATEWAY_TOKEN --name paramita-cloud-${config.tenant}`);
  console.log(`   wrangler secret put CF_ACCESS_TEAM_DOMAIN --name paramita-cloud-${config.tenant}`);
  console.log(`   wrangler secret put CF_ACCESS_AUD --name paramita-cloud-${config.tenant}`);
  console.log(`\n2. Access the tenant at:`);
  console.log(`   https://paramita-cloud-${config.tenant}.<your-subdomain>.workers.dev`);
}

main();
