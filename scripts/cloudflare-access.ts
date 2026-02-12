/**
 * Cloudflare Access API automation
 *
 * This module provides TypeScript functions to automate Cloudflare Access configuration:
 * - Create Access Applications for Workers
 * - Configure email-based access policies
 * - Retrieve Application Audience (AUD) tags
 *
 * Replaces the bash script setup-cloudflare-access.sh with type-safe TypeScript implementation.
 */

import { execSync } from 'child_process';

/**
 * Cloudflare API response wrapper
 */
interface CloudflareAPIResponse<T = unknown> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
    total_pages: number;
  };
}

/**
 * Access Organization (team domain)
 */
interface AccessOrganization {
  auth_domain: string;
  name: string;
  is_ui_read_only: boolean;
  user_seat_expiration_inactive_time: string;
  auto_redirect_to_identity: boolean;
}

/**
 * Access Application
 */
interface AccessApplication {
  id: string;
  aud: string;
  name: string;
  domain: string;
  type: 'self_hosted' | 'saas' | 'ssh' | 'vnc' | 'app_launcher' | 'warp' | 'biso' | 'bookmark' | 'dash_sso';
  session_duration: string;
  auto_redirect_to_identity: boolean;
  allowed_idps: string[];
  cors_headers?: {
    allow_all_origins: boolean;
    allow_all_methods: boolean;
    allow_all_headers: boolean;
    allow_credentials: boolean;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Access Policy
 */
interface AccessPolicy {
  id: string;
  name: string;
  decision: 'allow' | 'deny' | 'non_identity' | 'bypass';
  include: PolicyRule[];
  exclude?: PolicyRule[];
  require?: PolicyRule[];
  precedence: number;
  session_duration?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Policy rule types
 */
interface PolicyRule {
  email?: { email: string };
  email_domain?: { domain: string };
  everyone?: Record<string, never>;
  ip?: { ip: string };
  ip_list?: { id: string };
  certificate?: Record<string, never>;
  access_group?: { id: string };
  azure_ad?: { id: string; identity_provider_id: string };
  github_organization?: { name: string; identity_provider_id: string };
  gsuite?: { email: string; identity_provider_id: string };
  okta?: { name: string; identity_provider_id: string };
  saml?: { attribute_name: string; attribute_value: string };
  service_token?: { token_id: string };
}

/**
 * Configuration options for setupCloudflareAccess
 */
interface CloudflareAccessConfig {
  accountId: string;
  apiToken: string;
  workerName: string;
  workerUrl: string;
  allowedEmail: string;
  teamDomain?: string;
}

/**
 * Result from setupCloudflareAccess
 */
interface CloudflareAccessResult {
  teamDomain: string;
  applicationId: string;
  aud: string;
  policyId: string;
  existed: boolean;
}

/**
 * Normalize a URL for comparison
 * Removes protocol, trailing slashes, and converts to lowercase
 */
export function normalizeUrl(url: string): string {
  return url
    .toLowerCase()               // Normalize case first
    .replace(/^https?:\/\//, '') // Remove protocol
    .replace(/\/$/, '');          // Remove trailing slash
}

/**
 * Cloudflare Access API client
 */
class CloudflareAccessClient {
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(accountId: string, apiToken: string) {
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  /**
   * Make an API request to Cloudflare
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<CloudflareAPIResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as CloudflareAPIResponse<T>;

    if (!data.success) {
      const errorMessages = data.errors.map(e => e.message).join(', ');
      throw new Error(`Cloudflare API error: ${errorMessages}`);
    }

    return data;
  }

  /**
   * Get Access Organization (team domain)
   */
  async getOrganization(): Promise<AccessOrganization> {
    const response = await this.request<AccessOrganization>(
      'GET',
      `/accounts/${this.accountId}/access/organizations`
    );
    return response.result;
  }

  /**
   * List all Access Applications (with pagination support)
   * Fetches all pages to ensure complete results
   */
  async listApplications(): Promise<AccessApplication[]> {
    const allApps: AccessApplication[] = [];
    let page = 1;
    const perPage = 50;

    while (true) {
      const response = await this.request<AccessApplication[]>(
        'GET',
        `/accounts/${this.accountId}/access/apps?page=${page}&per_page=${perPage}`
      );

      allApps.push(...response.result);

      // Check if there are more pages
      if (!response.result_info || page >= response.result_info.total_pages) {
        break;
      }

      page++;
    }

    console.log(`[Access] Fetched ${allApps.length} total applications across ${page} page(s)`);
    return allApps;
  }

  /**
   * Get a specific Access Application
   */
  async getApplication(appId: string): Promise<AccessApplication> {
    const response = await this.request<AccessApplication>(
      'GET',
      `/accounts/${this.accountId}/access/apps/${appId}`
    );
    return response.result;
  }

  /**
   * Create a new Access Application
   */
  async createApplication(config: {
    name: string;
    domain: string;
    type: string;
    sessionDuration: string;
    autoRedirectToIdentity: boolean;
    allowedIdps: string[];
    corsHeaders?: {
      allow_all_origins: boolean;
      allow_all_methods: boolean;
      allow_all_headers: boolean;
      allow_credentials: boolean;
    };
  }): Promise<AccessApplication> {
    const response = await this.request<AccessApplication>(
      'POST',
      `/accounts/${this.accountId}/access/apps`,
      {
        name: config.name,
        domain: config.domain,
        type: config.type,
        session_duration: config.sessionDuration,
        auto_redirect_to_identity: config.autoRedirectToIdentity,
        allowed_idps: config.allowedIdps,
        cors_headers: config.corsHeaders,
      }
    );
    return response.result;
  }

  /**
   * Create an Access Policy for an Application
   */
  async createPolicy(appId: string, config: {
    name: string;
    decision: string;
    include: PolicyRule[];
    precedence: number;
    sessionDuration?: string;
  }): Promise<AccessPolicy> {
    const response = await this.request<AccessPolicy>(
      'POST',
      `/accounts/${this.accountId}/access/apps/${appId}/policies`,
      {
        name: config.name,
        decision: config.decision,
        include: config.include,
        precedence: config.precedence,
        session_duration: config.sessionDuration,
      }
    );
    return response.result;
  }
}

/**
 * Get Cloudflare Account ID from wrangler CLI
 *
 * @returns Account ID (32-character hex string)
 * @throws Error if account ID cannot be extracted
 */
export async function getAccountIdFromWrangler(): Promise<string> {
  try {
    const output = execSync('npx wrangler whoami', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Extract 32-character hex account ID
    const match = output.match(/[a-f0-9]{32}/);
    if (!match) {
      throw new Error('Could not extract account ID from wrangler whoami output');
    }

    return match[0];
  } catch (error) {
    throw new Error(
      `Failed to get account ID from wrangler: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Setup Cloudflare Access for a Worker
 *
 * This function automates the complete Cloudflare Access setup:
 * 1. Fetches the team domain (if not provided)
 * 2. Checks for existing Access Application
 * 3. Creates new Application and Policy if needed
 * 4. Returns configuration details (team domain, AUD tag)
 *
 * @param config - Configuration options
 * @returns Access configuration result
 * @throws Error if API calls fail or team domain cannot be determined
 */
export async function setupCloudflareAccess(
  config: CloudflareAccessConfig
): Promise<CloudflareAccessResult> {
  const client = new CloudflareAccessClient(config.accountId, config.apiToken);

  // 1. Get team domain (if not provided)
  let teamDomain = config.teamDomain;
  if (!teamDomain) {
    const org = await client.getOrganization();
    teamDomain = org.auth_domain;

    if (!teamDomain) {
      throw new Error(
        'Could not fetch team domain. You may need to set up Cloudflare Access first.'
      );
    }
  }

  // 2. Check if Application already exists
  const existingApps = await client.listApplications();
  const normalizedWorkerUrl = normalizeUrl(config.workerUrl);

  // Debug logging to help diagnose matching issues
  if (existingApps.length > 0) {
    console.log(`[Access] Checking for existing apps matching: ${normalizedWorkerUrl}`);
    console.log(`[Access] Found ${existingApps.length} existing apps:`,
      existingApps.map(app => normalizeUrl(app.domain)).join(', '));
  }

  const existingApp = existingApps.find(app =>
    normalizeUrl(app.domain) === normalizedWorkerUrl
  );

  if (existingApp) {
    // Application already exists, return existing configuration
    return {
      teamDomain,
      applicationId: existingApp.id,
      aud: existingApp.aud,
      policyId: '', // Don't return policy ID for existing apps (may have multiple policies)
      existed: true,
    };
  }

  // 3. Create Access Application
  let app: AccessApplication;
  try {
    app = await client.createApplication({
      name: `${config.workerName} Access`,
      domain: config.workerUrl,
      type: 'self_hosted',
      sessionDuration: '24h',
      autoRedirectToIdentity: false,
      allowedIdps: [],
    });
  } catch (error) {
    // If we get a conflict error, try to find the existing app more aggressively
    if (error instanceof Error && error.message.includes('conflict')) {
      // Search for any app that might match this domain
      const possibleMatch = existingApps.find(app => {
        const appDomain = normalizeUrl(app.domain);
        const workerDomain = normalizedWorkerUrl;
        // Check if domains match or if one contains the other
        return appDomain === workerDomain ||
               appDomain.includes(workerDomain) ||
               workerDomain.includes(appDomain);
      });

      if (possibleMatch) {
        // Found a conflicting app, return it instead
        return {
          teamDomain,
          applicationId: possibleMatch.id,
          aud: possibleMatch.aud,
          policyId: '',
          existed: true,
        };
      }
    }

    // Re-throw if we couldn't handle it
    throw error;
  }

  // 4. Create Access Policy (allow specified email)
  const policy = await client.createPolicy(app.id, {
    name: `Allow ${config.allowedEmail}`,
    decision: 'allow',
    include: [
      {
        email: {
          email: config.allowedEmail,
        },
      },
    ],
    precedence: 1,
    sessionDuration: '24h',
  });

  return {
    teamDomain,
    applicationId: app.id,
    aud: app.aud,
    policyId: policy.id,
    existed: false,
  };
}
