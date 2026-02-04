import { describe, it, expect } from 'vitest';
import {
  injectUrlParameters,
  injectParameters,
  prepareProxyRequest,
  MissingParameterError,
  DEFAULT_GATEWAY_CONFIG,
  type UrlInjectionConfig,
} from './injection';
import { createMockEnv } from '../test-utils';

describe('injectUrlParameters', () => {
  describe('single parameter injection', () => {
    it('should inject required parameter when present', () => {
      const url = new URL('https://example.com/path');
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'test-token' });

      const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(result.url.searchParams.get('token')).toBe('test-token');
      expect(result.injected).toEqual(['token']);
      expect(result.skipped).toEqual([]);
    });

    it('should throw MissingParameterError for missing required parameter', () => {
      const url = new URL('https://example.com/');
      const env = createMockEnv(); // No token

      expect(() => {
        injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);
      }).toThrow(MissingParameterError);
    });

    it('should preserve existing query parameters', () => {
      const url = new URL('https://example.com/?existing=value');
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'test-token' });

      const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(result.url.searchParams.get('existing')).toBe('value');
      expect(result.url.searchParams.get('token')).toBe('test-token');
    });

    it('should not modify original URL', () => {
      const url = new URL('https://example.com/');
      const originalSearch = url.search;
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'test-token' });

      injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(url.search).toBe(originalSearch);
    });

    it('should preserve URL fragments', () => {
      const url = new URL('https://example.com/path#fragment');
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'test-token' });

      const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(result.url.hash).toBe('#fragment');
      expect(result.url.searchParams.get('token')).toBe('test-token');
    });

    it('should preserve pathname', () => {
      const url = new URL('https://example.com/path/to/resource');
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'test-token' });

      const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(result.url.pathname).toBe('/path/to/resource');
      expect(result.url.searchParams.get('token')).toBe('test-token');
    });
  });

  describe('multiple parameter injection', () => {
    it('should inject multiple parameters', () => {
      const config: UrlInjectionConfig = {
        params: [
          { envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true },
          { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false },
          { envKey: 'DEV_MODE', paramName: 'dev', required: false },
        ]
      };
      const env = createMockEnv({
        CLAWDBOT_GATEWAY_TOKEN: 'token123',
        DEBUG_ROUTES: 'true',
        DEV_MODE: 'false',
      });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('token')).toBe('token123');
      expect(result.url.searchParams.get('debug')).toBe('true');
      expect(result.url.searchParams.get('dev')).toBe('false');
      expect(result.injected).toEqual(['token', 'debug', 'dev']);
      expect(result.skipped).toEqual([]);
    });

    it('should skip optional parameters when missing', () => {
      const config: UrlInjectionConfig = {
        params: [
          { envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true },
          { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false },
        ]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('token')).toBe('token123');
      expect(result.url.searchParams.get('debug')).toBeNull();
      expect(result.injected).toEqual(['token']);
      expect(result.skipped).toEqual(['debug']);
    });

    it('should throw for missing required parameter in multi-param config', () => {
      const config: UrlInjectionConfig = {
        params: [
          { envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true },
          { envKey: 'ANTHROPIC_API_KEY', paramName: 'api_key', required: true },
        ]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

      const url = new URL('https://example.com/');

      expect(() => {
        injectUrlParameters(url, env, config);
      }).toThrow(MissingParameterError);

      try {
        injectUrlParameters(url, env, config);
      } catch (error) {
        expect(error).toBeInstanceOf(MissingParameterError);
        expect((error as MissingParameterError).missingParams).toEqual(['ANTHROPIC_API_KEY']);
      }
    });

    it('should handle multiple missing required parameters', () => {
      const config: UrlInjectionConfig = {
        params: [
          { envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true },
          { envKey: 'ANTHROPIC_API_KEY', paramName: 'api_key', required: true },
          { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false },
        ]
      };
      const env = createMockEnv({ DEBUG_ROUTES: 'true' });

      const url = new URL('https://example.com/');

      try {
        injectUrlParameters(url, env, config);
      } catch (error) {
        expect(error).toBeInstanceOf(MissingParameterError);
        expect((error as MissingParameterError).missingParams).toContain('CLAWDBOT_GATEWAY_TOKEN');
        expect((error as MissingParameterError).missingParams).toContain('ANTHROPIC_API_KEY');
      }
    });
  });

  describe('parameter name mapping', () => {
    it('should use envKey as parameter name when paramName not specified', () => {
      const config: UrlInjectionConfig = {
        params: [{ envKey: 'CLAWDBOT_GATEWAY_TOKEN', required: true }]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('CLAWDBOT_GATEWAY_TOKEN')).toBe('token123');
    });

    it('should use custom parameter name when specified', () => {
      const config: UrlInjectionConfig = {
        params: [{ envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'auth_token', required: true }]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('auth_token')).toBe('token123');
      expect(result.url.searchParams.get('CLAWDBOT_GATEWAY_TOKEN')).toBeNull();
    });
  });

  describe('value transformation', () => {
    it('should apply transform function when provided', () => {
      const config: UrlInjectionConfig = {
        params: [
          {
            envKey: 'DEBUG_ROUTES',
            paramName: 'debug',
            required: false,
            transform: (val) => val.toLowerCase(),
          }
        ]
      };
      const env = createMockEnv({ DEBUG_ROUTES: 'TRUE' });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('debug')).toBe('true');
    });

    it('should chain transformation correctly', () => {
      const config: UrlInjectionConfig = {
        params: [
          {
            envKey: 'CLAWDBOT_GATEWAY_TOKEN',
            paramName: 'token',
            required: true,
            transform: (val) => val.substring(0, 10), // Truncate
          }
        ]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'very-long-token-value-here' });

      const url = new URL('https://example.com/');
      const result = injectUrlParameters(url, env, config);

      expect(result.url.searchParams.get('token')).toBe('very-long-');
    });
  });

  describe('edge cases', () => {
    it('should treat empty string as missing', () => {
      const config: UrlInjectionConfig = {
        params: [{ envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true }]
      };
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: '' });

      const url = new URL('https://example.com/');

      expect(() => {
        injectUrlParameters(url, env, config);
      }).toThrow(MissingParameterError);
    });

    it('should overwrite existing parameter with same name', () => {
      const url = new URL('https://example.com/?token=old');
      const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'new' });

      const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);

      expect(result.url.searchParams.get('token')).toBe('new');
    });
  });
});

describe('injectParameters', () => {
  it('should return URL directly without metadata', () => {
    const url = new URL('https://example.com/');
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = injectParameters(url, env);

    expect(result).toBeInstanceOf(URL);
    expect(result.searchParams.get('token')).toBe('token123');
  });

  it('should use default config when not specified', () => {
    const url = new URL('https://example.com/');
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = injectParameters(url, env);

    expect(result.searchParams.get('token')).toBe('token123');
  });

  it('should accept custom config', () => {
    const config: UrlInjectionConfig = {
      params: [
        { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false }
      ]
    };
    const url = new URL('https://example.com/');
    const env = createMockEnv({ DEBUG_ROUTES: 'true' });

    const result = injectParameters(url, env, config);

    expect(result.searchParams.get('debug')).toBe('true');
  });

  it('should throw MissingParameterError for required params', () => {
    const url = new URL('https://example.com/');
    const env = createMockEnv();

    expect(() => {
      injectParameters(url, env);
    }).toThrow(MissingParameterError);
  });
});

describe('prepareProxyRequest', () => {
  it('should prepare request with injected parameters', () => {
    const request = new Request('https://example.com/path');
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = prepareProxyRequest({ request, env });

    const url = new URL(result.request.url);
    expect(url.searchParams.get('token')).toBe('token123');
    expect(result.injectedParams).toEqual(['token']);
    expect(result.skippedParams).toEqual([]);
  });

  it('should preserve request method and headers', () => {
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = prepareProxyRequest({ request, env });

    expect(result.request.method).toBe('POST');
    expect(result.request.headers.get('Content-Type')).toBe('application/json');
  });

  it('should accept custom injection config', () => {
    const config: UrlInjectionConfig = {
      params: [
        { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false }
      ]
    };
    const request = new Request('https://example.com/');
    const env = createMockEnv({ DEBUG_ROUTES: 'true' });

    const result = prepareProxyRequest({
      request,
      env,
      injectionConfig: config
    });

    const url = new URL(result.request.url);
    expect(url.searchParams.get('debug')).toBe('true');
  });

  it('should throw MissingParameterError for missing required params', () => {
    const request = new Request('https://example.com/');
    const env = createMockEnv(); // No token

    expect(() => {
      prepareProxyRequest({ request, env });
    }).toThrow(MissingParameterError);
  });

  it('should return URL in result', () => {
    const request = new Request('https://example.com/path');
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = prepareProxyRequest({ request, env });

    expect(result.url).toBeInstanceOf(URL);
    expect(result.url.searchParams.get('token')).toBe('token123');
  });

  it('should handle requests with existing query parameters', () => {
    const request = new Request('https://example.com/?foo=bar');
    const env = createMockEnv({ CLAWDBOT_GATEWAY_TOKEN: 'token123' });

    const result = prepareProxyRequest({ request, env });

    const url = new URL(result.request.url);
    expect(url.searchParams.get('foo')).toBe('bar');
    expect(url.searchParams.get('token')).toBe('token123');
  });
});
