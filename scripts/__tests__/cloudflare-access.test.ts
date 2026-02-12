import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCloudflareAccess, getAccountIdFromWrangler, normalizeUrl } from '../cloudflare-access';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('normalizeUrl', () => {
  it('should remove https:// protocol', () => {
    expect(normalizeUrl('https://example.com')).toBe('example.com');
  });

  it('should remove http:// protocol', () => {
    expect(normalizeUrl('http://example.com')).toBe('example.com');
  });

  it('should remove trailing slash', () => {
    expect(normalizeUrl('example.com/')).toBe('example.com');
  });

  it('should convert to lowercase', () => {
    expect(normalizeUrl('Example.COM')).toBe('example.com');
  });

  it('should handle multiple transformations', () => {
    expect(normalizeUrl('HTTPS://Example.COM/')).toBe('example.com');
  });

  it('should handle already normalized URLs', () => {
    expect(normalizeUrl('example.com')).toBe('example.com');
  });

  it('should handle URLs with paths', () => {
    expect(normalizeUrl('https://example.com/path')).toBe('example.com/path');
  });

  it('should remove only trailing slash, not path slashes', () => {
    expect(normalizeUrl('example.com/path/')).toBe('example.com/path');
  });
});

describe('CloudflareAccessClient', () => {
  const mockAccountId = 'a'.repeat(32);
  const mockApiToken = 'test-token-123';
  const mockWorkerName = 'test-worker';
  const mockWorkerUrl = 'test-worker.workers.dev';
  const mockEmail = 'test@example.com';
  const mockTeamDomain = 'test-team.cloudflareaccess.com';
  const mockAud = 'test-aud-123';
  const mockAppId = 'app-id-123';
  const mockPolicyId = 'policy-id-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setupCloudflareAccess', () => {
    it('should create new application and policy when none exists', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications (empty)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      // Mock createApplication
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockAppId,
            aud: mockAud,
            name: `${mockWorkerName} Access`,
            domain: mockWorkerUrl,
            type: 'self_hosted',
            session_duration: '24h',
            auto_redirect_to_identity: false,
            allowed_idps: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      // Mock createPolicy
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockPolicyId,
            name: `Allow ${mockEmail}`,
            decision: 'allow',
            include: [{ email: { email: mockEmail } }],
            precedence: 1,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: mockWorkerUrl,
        allowedEmail: mockEmail,
      });

      expect(result).toEqual({
        teamDomain: mockTeamDomain,
        applicationId: mockAppId,
        aud: mockAud,
        policyId: mockPolicyId,
        existed: false,
      });

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should return existing application when it already exists', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications (with existing app)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: mockWorkerUrl,
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: mockWorkerUrl,
        allowedEmail: mockEmail,
      });

      expect(result).toEqual({
        teamDomain: mockTeamDomain,
        applicationId: mockAppId,
        aud: mockAud,
        policyId: '',
        existed: true,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should find existing app with protocol prefix', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications with app that has no protocol
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: mockWorkerUrl, // No protocol
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: `https://${mockWorkerUrl}`, // With protocol
        allowedEmail: mockEmail,
      });

      expect(result.existed).toBe(true);
      expect(result.applicationId).toBe(mockAppId);
      expect(mockFetch).toHaveBeenCalledTimes(2); // No createApplication call
    });

    it('should find existing app with trailing slash', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications with app that has no trailing slash
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: mockWorkerUrl, // No trailing slash
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: `${mockWorkerUrl}/`, // With trailing slash
        allowedEmail: mockEmail,
      });

      expect(result.existed).toBe(true);
      expect(result.applicationId).toBe(mockAppId);
    });

    it('should find existing app with different casing', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications with mixed case domain
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: 'Test-Worker.workers.dev', // Mixed case
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: 'test-worker.workers.dev', // Lowercase
        allowedEmail: mockEmail,
      });

      expect(result.existed).toBe(true);
      expect(result.applicationId).toBe(mockAppId);
    });

    it('should use provided team domain instead of fetching', async () => {
      // Mock listApplications (empty)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      // Mock createApplication
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockAppId,
            aud: mockAud,
            name: `${mockWorkerName} Access`,
            domain: mockWorkerUrl,
            type: 'self_hosted',
            session_duration: '24h',
            auto_redirect_to_identity: false,
            allowed_idps: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      // Mock createPolicy
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockPolicyId,
            name: `Allow ${mockEmail}`,
            decision: 'allow',
            include: [{ email: { email: mockEmail } }],
            precedence: 1,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: mockWorkerUrl,
        allowedEmail: mockEmail,
        teamDomain: mockTeamDomain,
      });

      expect(result.teamDomain).toBe(mockTeamDomain);
      expect(mockFetch).toHaveBeenCalledTimes(3); // No getOrganization call
    });

    it('should throw error when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 1000, message: 'Authentication error' }],
          messages: [],
          result: null,
        }),
      });

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('Cloudflare API error: Authentication error');
    });

    it('should throw error when team domain cannot be fetched', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: '', // Empty team domain
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('Could not fetch team domain');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('Network error');
    });

    it('should handle multiple API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [
            { code: 1000, message: 'Error 1' },
            { code: 1001, message: 'Error 2' },
          ],
          messages: [],
          result: null,
        }),
      });

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('Cloudflare API error: Error 1, Error 2');
    });

    it('should work with custom domain instead of workers.dev', async () => {
      const customDomain = 'liujundonghero.tokenaissance.com';

      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications (empty)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      // Mock createApplication
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockAppId,
            aud: mockAud,
            name: `${mockWorkerName} Access`,
            domain: customDomain,  // Custom domain
            type: 'self_hosted',
            session_duration: '24h',
            auto_redirect_to_identity: false,
            allowed_idps: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      // Mock createPolicy
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            id: mockPolicyId,
            name: `Allow ${mockEmail}`,
            decision: 'allow',
            include: [{ email: { email: mockEmail } }],
            precedence: 1,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: customDomain,  // Use custom domain
        allowedEmail: mockEmail,
      });

      expect(result).toEqual({
        teamDomain: mockTeamDomain,
        applicationId: mockAppId,
        aud: mockAud,
        policyId: mockPolicyId,
        existed: false,
      });

      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify the API was called with custom domain
      const createAppCall = mockFetch.mock.calls[2];
      const createAppBody = JSON.parse(createAppCall[1].body);
      expect(createAppBody.domain).toBe(customDomain);
    });

    it('should handle conflict error and find existing app with exact match', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications - return empty to bypass initial check
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      // Mock createApplication to return conflict error
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 1000, message: 'access.api.error.conflict: destination belongs to another application' }],
          messages: [],
          result: null,
        }),
      });

      // Since existingApps is empty, this should re-throw the error
      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('conflict');
    });

    it('should handle conflict error with substring matching', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications with app that has a path - will match via substring
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: `${mockWorkerUrl}/api`, // Has path - won't match exactly but will match via substring
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      // Mock createApplication to return conflict error
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 1000, message: 'conflict' }],
          messages: [],
          result: null,
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: mockWorkerUrl, // Plain domain
        allowedEmail: mockEmail,
      });

      expect(result.existed).toBe(true);
      expect(result.applicationId).toBe(mockAppId);
    });

    it('should re-throw conflict error when no matching app found', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications with completely different domain that won't match via substring
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: 'other-app-id',
              aud: 'other-aud',
              name: 'Other App',
              domain: 'completely-different-domain.example.com', // No overlap with test-worker.workers.dev
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

      // Mock createApplication to return conflict error
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 1000, message: 'conflict error' }],
          messages: [],
          result: null,
        }),
      });

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('conflict error');
    });

    it('should re-throw non-conflict errors', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications (empty)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      // Mock createApplication to return non-conflict error
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: false,
          errors: [{ code: 1000, message: 'Authentication failed' }],
          messages: [],
          result: null,
        }),
      });

      await expect(
        setupCloudflareAccess({
          accountId: mockAccountId,
          apiToken: mockApiToken,
          workerName: mockWorkerName,
          workerUrl: mockWorkerUrl,
          allowedEmail: mockEmail,
        })
      ).rejects.toThrow('Cloudflare API error: Authentication failed');
    });

    it('should handle paginated application lists', async () => {
      // Mock getOrganization
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: {
            auth_domain: mockTeamDomain,
            name: 'Test Org',
            is_ui_read_only: false,
            user_seat_expiration_inactive_time: '720h',
            auto_redirect_to_identity: false,
          },
        }),
      });

      // Mock listApplications - page 1
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: 'app-1',
              aud: 'aud-1',
              name: 'App 1',
              domain: 'app1.workers.dev',
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          result_info: {
            page: 1,
            per_page: 50,
            count: 1,
            total_count: 2,
            total_pages: 2,
          },
        }),
      });

      // Mock listApplications - page 2 (contains our target app)
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: mockAppId,
              aud: mockAud,
              name: `${mockWorkerName} Access`,
              domain: mockWorkerUrl,
              type: 'self_hosted',
              session_duration: '24h',
              auto_redirect_to_identity: false,
              allowed_idps: [],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          result_info: {
            page: 2,
            per_page: 50,
            count: 1,
            total_count: 2,
            total_pages: 2,
          },
        }),
      });

      const result = await setupCloudflareAccess({
        accountId: mockAccountId,
        apiToken: mockApiToken,
        workerName: mockWorkerName,
        workerUrl: mockWorkerUrl,
        allowedEmail: mockEmail,
      });

      expect(result.existed).toBe(true);
      expect(result.applicationId).toBe(mockAppId);
      expect(mockFetch).toHaveBeenCalledTimes(3); // getOrg + 2 pages of listApps
    });
  });

  describe('getAccountIdFromWrangler', () => {
    it('should extract account ID from wrangler output', async () => {
      const { execSync } = await import('child_process');
      const mockExecSync = execSync as any;

      mockExecSync.mockReturnValueOnce(
        `Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email 'user@example.com'!
┌──────────────────────────┬──────────────────────────────────┐
│ Account Name             │ Account ID                        │
├──────────────────────────┼──────────────────────────────────┤
│ Test Account             │ ${'a'.repeat(32)}                │
└──────────────────────────┴──────────────────────────────────┘`
      );

      const accountId = await getAccountIdFromWrangler();
      expect(accountId).toBe('a'.repeat(32));
    });

    it('should throw error when account ID not found', async () => {
      const { execSync } = await import('child_process');
      const mockExecSync = execSync as any;

      mockExecSync.mockReturnValueOnce('No account ID here');

      await expect(getAccountIdFromWrangler()).rejects.toThrow(
        'Could not extract account ID'
      );
    });

    it('should throw error when wrangler command fails', async () => {
      const { execSync } = await import('child_process');
      const mockExecSync = execSync as any;

      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command failed');
      });

      await expect(getAccountIdFromWrangler()).rejects.toThrow(
        'Failed to get account ID from wrangler'
      );
    });

    it('should extract first account ID when multiple exist', async () => {
      const { execSync } = await import('child_process');
      const mockExecSync = execSync as any;

      const firstId = 'a'.repeat(32);
      const secondId = 'b'.repeat(32);

      mockExecSync.mockReturnValueOnce(
        `Account 1: ${firstId}\nAccount 2: ${secondId}`
      );

      const accountId = await getAccountIdFromWrangler();
      expect(accountId).toBe(firstId);
    });
  });
});
