#!/usr/bin/env npx tsx
/**
 * Cloudflare Workers Custom Domain Configuration
 *
 * 为部署的 Worker 配置自定义域名 {name}.tokenaissance.com
 *
 * Usage:
 *   import { configureDomain } from './configure-domain';
 *   const domain = await configureDomain('tenant-uuid');
 *
 * Environment Variables:
 *   CLOUDFLARE_DOMAIN_API_TOKEN - Preferred: Dedicated API token for domain configuration (won't conflict with wrangler)
 *   CLOUDFLARE_API_TOKEN - Fallback: General API token (may conflict with wrangler login)
 *   CLOUDFLARE_ZONE_ID - Optional: Zone ID for tokenaissance.com domain (will auto-fetch if not provided)
 */

import { execSync } from 'child_process';

interface DomainConfigOptions {
  accountId?: string;
  apiToken?: string;
  zoneId?: string;
  baseDomain?: string;
  workerNamePrefix?: string;
  workerTenantId?: string;  // Optional: Use different ID for Worker name (defaults to tenantName)
}

interface CloudflareAPIResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result?: {
    id: string;
    hostname: string;
    service: string;
    environment: string;
  };
}

/**
 * 从 wrangler 获取 Cloudflare Account ID
 */
function getCloudflareAccountId(): string | null {
  try {
    const output = execSync('npx wrangler whoami 2>/dev/null', { encoding: 'utf-8' });
    const match = output.match(/([a-f0-9]{32})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 通过 API 获取 Zone ID
 */
async function getZoneId(apiToken: string, domainName: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${domainName}`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data: any = await response.json();

    if (data.success && data.result && data.result.length > 0) {
      return data.result[0].id;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 配置 Worker 自定义域名
 *
 * @param tenantName - 租户名称（通常是 user ID）
 * @param options - 可选配置
 * @returns 成功绑定的完整域名
 * @throws 配置失败时抛出错误
 */
export async function configureDomain(
  tenantName: string,
  options: DomainConfigOptions = {}
): Promise<string> {
  // 1. 获取配置
  // 优先级：options.apiToken > CLOUDFLARE_DOMAIN_API_TOKEN > CLOUDFLARE_API_TOKEN
  const apiToken = options.apiToken ||
                   process.env.CLOUDFLARE_DOMAIN_API_TOKEN ||
                   process.env.CLOUDFLARE_API_TOKEN;
  const baseDomain = options.baseDomain || 'tokenaissance.com';
  const workerNamePrefix = options.workerNamePrefix || 'paramita-cloud';

  // 2. 验证 API Token（如果没有，抛出错误让调用方处理）
  if (!apiToken) {
    throw new Error('CLOUDFLARE_DOMAIN_API_TOKEN or CLOUDFLARE_API_TOKEN environment variable is required for custom domain configuration');
  }

  // 3. 获取 Account ID
  const accountId = options.accountId || getCloudflareAccountId();
  if (!accountId) {
    throw new Error('Failed to get Cloudflare Account ID. Make sure wrangler is authenticated.');
  }

  // 4. 获取 Zone ID（优先使用环境变量，否则通过 API 查询）
  let zoneId = options.zoneId || process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) {
    console.log(`[Domain] Fetching zone ID for ${baseDomain}...`);
    zoneId = await getZoneId(apiToken, baseDomain);
    if (!zoneId) {
      throw new Error(`Failed to get zone ID for ${baseDomain}. Please set CLOUDFLARE_ZONE_ID environment variable.`);
    }
    console.log(`[Domain] Zone ID: ${zoneId}`);
  }

  // 5. 构建域名和 Worker 名称
  // Domain uses tenantName (user-friendly subdomain)
  // Worker service uses workerTenantId (stable UUID) if provided, otherwise falls back to tenantName
  const hostname = `${tenantName}.${baseDomain}`;
  const workerTenant = options.workerTenantId || tenantName;
  const serviceName = `${workerNamePrefix}-${workerTenant}`;

  console.log(`[Domain] Configuring custom domain: ${hostname}`);
  console.log(`[Domain] Worker service: ${serviceName}`);

  // 6. 调用 Cloudflare API
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains/records`;

  try {
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        environment: 'production',
        hostname: hostname,
        service: serviceName,
        zone_id: zoneId,
      }),
    });

    const data: CloudflareAPIResponse = await response.json();

    // 7. 处理响应
    if (!response.ok || !data.success) {
      const errorMsg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    console.log(`[Domain] ✅ Custom domain configured successfully: ${hostname}`);
    console.log(`[Domain] SSL certificate will be provisioned automatically`);

    return hostname;

  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to configure custom domain: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 删除 Worker 自定义域名
 */
export async function removeDomain(
  tenantName: string,
  options: DomainConfigOptions = {}
): Promise<void> {
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  const accountId = options.accountId || getCloudflareAccountId();
  const baseDomain = options.baseDomain || 'tokenaissance.com';

  if (!apiToken || !accountId) {
    throw new Error('Missing required configuration');
  }

  const hostname = `${tenantName}.${baseDomain}`;
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains/records/${hostname}`;

  const response = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(`Failed to remove domain: ${JSON.stringify(data)}`);
  }

  console.log(`[Domain] ✅ Custom domain removed: ${hostname}`);
}

// CLI 支持 (ES module 方式)
if (import.meta.url === `file://${process.argv[1]}`) {
  const tenantName = process.argv[2];

  if (!tenantName) {
    console.error('Usage: npx tsx configure-domain.ts <tenant-name>');
    process.exit(1);
  }

  configureDomain(tenantName)
    .then(domain => {
      console.log(`\n✅ Success! Domain configured: ${domain}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`\n❌ Error: ${error.message}`);
      process.exit(1);
    });
}
