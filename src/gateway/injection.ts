/**
 * Generic parameter injection system for URL query parameters
 *
 * This module provides a flexible, configuration-driven approach to injecting
 * environment variables as URL query parameters before proxying requests.
 */

import type { MoltbotEnv } from '../types';

/**
 * Configuration for a single parameter injection
 */
export interface ParamInjectionConfig {
  /**
   * Environment variable key from MoltbotEnv
   */
  envKey: keyof MoltbotEnv;

  /**
   * URL parameter name (defaults to envKey if not specified)
   */
  paramName?: string;

  /**
   * Whether this parameter is required (validation will fail if missing)
   */
  required?: boolean;

  /**
   * Optional transformation function for the value before injection
   */
  transform?: (value: string) => string;
}

/**
 * Configuration for a set of parameters to inject
 */
export interface UrlInjectionConfig {
  /**
   * Array of parameter configurations
   */
  params: ParamInjectionConfig[];
}

/**
 * Result of parameter injection operation
 */
export interface InjectionResult {
  /**
   * The modified URL with injected parameters
   */
  url: URL;

  /**
   * Parameters that were successfully injected
   */
  injected: string[];

  /**
   * Parameters that were skipped (optional params with missing values)
   */
  skipped: string[];
}

/**
 * Configuration for proxy request preparation
 */
export interface ProxyRequestConfig {
  /**
   * Original request to proxy
   */
  request: Request;

  /**
   * Environment variables
   */
  env: MoltbotEnv;

  /**
   * Parameter injection configuration (defaults to gateway token only)
   */
  injectionConfig?: UrlInjectionConfig;

  /**
   * Whether to log injection details
   */
  debug?: boolean;

  /**
   * Log prefix for debugging (e.g., '[WS]', '[HTTP]')
   */
  logPrefix?: string;
}

/**
 * Result of proxy request preparation
 */
export interface ProxyRequestResult {
  /**
   * Modified request ready for proxying
   */
  request: Request;

  /**
   * The modified URL (convenience accessor)
   */
  url: URL;

  /**
   * Parameters that were injected
   */
  injectedParams: string[];

  /**
   * Parameters that were skipped
   */
  skippedParams: string[];
}

/**
 * Error thrown when required parameters are missing
 */
export class MissingParameterError extends Error {
  constructor(
    public readonly missingParams: string[],
    message?: string
  ) {
    super(message || `Missing required parameters: ${missingParams.join(', ')}`);
    this.name = 'MissingParameterError';
  }
}

/**
 * Default configuration for gateway token injection
 * This maintains backward compatibility with the current behavior
 */
export const DEFAULT_GATEWAY_CONFIG: UrlInjectionConfig = {
  params: [
    {
      envKey: 'CLAWDBOT_GATEWAY_TOKEN',
      paramName: 'token',
      required: true,
    }
  ]
};

/**
 * Injects environment variables as URL parameters based on configuration.
 * Returns a new URL with parameters added.
 *
 * @param url - The URL to inject parameters into
 * @param env - The environment containing variables to inject
 * @param config - Configuration specifying which parameters to inject
 * @returns Result containing the modified URL and injection metadata
 * @throws {MissingParameterError} If required parameters are missing from env
 *
 * @example
 * // Basic usage with default config
 * const result = injectUrlParameters(url, env, DEFAULT_GATEWAY_CONFIG);
 * console.log(`Injected: ${result.injected.join(', ')}`);
 *
 * @example
 * // Custom configuration
 * const config = {
 *   params: [
 *     { envKey: 'CLAWDBOT_GATEWAY_TOKEN', paramName: 'token', required: true },
 *     { envKey: 'DEBUG_ROUTES', paramName: 'debug', required: false }
 *   ]
 * };
 * const result = injectUrlParameters(url, env, config);
 */
export function injectUrlParameters(
  url: URL,
  env: MoltbotEnv,
  config: UrlInjectionConfig
): InjectionResult {
  const newUrl = new URL(url.toString());
  const injected: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const paramConfig of config.params) {
    const { envKey, paramName, required = false, transform } = paramConfig;
    const targetParamName = paramName || envKey;

    // Get value from environment
    let value = env[envKey];

    // Handle missing values
    if (value === undefined || value === null || value === '') {
      if (required) {
        missing.push(envKey);
      } else {
        skipped.push(targetParamName);
      }
      continue;
    }

    // Convert to string (handles non-string env values)
    let stringValue = String(value);

    // Apply transformation if provided
    if (transform) {
      stringValue = transform(stringValue);
    }

    // Inject into URL
    newUrl.searchParams.set(targetParamName, stringValue);
    injected.push(targetParamName);
  }

  // Throw error if any required parameters are missing
  if (missing.length > 0) {
    throw new MissingParameterError(missing);
  }

  return {
    url: newUrl,
    injected,
    skipped,
  };
}

/**
 * Convenience function for simple parameter injection without metadata.
 * Maintains backward compatibility with the previous injectGatewayToken pattern.
 *
 * @param url - The URL to inject parameters into
 * @param env - The environment containing variables to inject
 * @param config - Configuration (defaults to DEFAULT_GATEWAY_CONFIG)
 * @returns The modified URL with parameters injected
 * @throws {MissingParameterError} If required parameters are missing
 *
 * @example
 * const modifiedUrl = injectParameters(url, env); // Uses default config
 */
export function injectParameters(
  url: URL,
  env: MoltbotEnv,
  config: UrlInjectionConfig = DEFAULT_GATEWAY_CONFIG
): URL {
  const result = injectUrlParameters(url, env, config);
  return result.url;
}

/**
 * Prepares a request for proxying with automatic parameter injection.
 * This eliminates code duplication between WebSocket and HTTP proxy handlers.
 *
 * @param config - Configuration for request preparation
 * @returns Prepared request with injected parameters
 * @throws {MissingParameterError} If required parameters are missing
 *
 * @example
 * // In WebSocket handler
 * const { request: modifiedRequest, url } = prepareProxyRequest({
 *   request,
 *   env: c.env,
 *   logPrefix: '[WS]',
 *   debug: true
 * });
 * const containerResponse = await sandbox.wsConnect(modifiedRequest, MOLTBOT_PORT);
 *
 * @example
 * // In HTTP handler
 * const { request: modifiedRequest } = prepareProxyRequest({
 *   request,
 *   env: c.env,
 *   logPrefix: '[HTTP]',
 * });
 * const httpResponse = await sandbox.containerFetch(modifiedRequest, MOLTBOT_PORT);
 */
export function prepareProxyRequest(
  config: ProxyRequestConfig
): ProxyRequestResult {
  const {
    request,
    env,
    injectionConfig = DEFAULT_GATEWAY_CONFIG,
    debug = false,
    logPrefix = '[PROXY]'
  } = config;

  const url = new URL(request.url);

  // Inject parameters
  const injectionResult = injectUrlParameters(url, env, injectionConfig);

  // Log if debug enabled
  if (debug) {
    console.log(`${logPrefix} Original URL:`, url.pathname + url.search);
    console.log(`${logPrefix} Injected params:`, injectionResult.injected.join(', '));
    if (injectionResult.skipped.length > 0) {
      console.log(`${logPrefix} Skipped params:`, injectionResult.skipped.join(', '));
    }
    console.log(`${logPrefix} Modified URL:`, injectionResult.url.pathname + injectionResult.url.search);
  }

  // Create modified request by inheriting all properties from original request
  // This ensures WebSocket upgrade headers and other internal properties are preserved
  const modifiedRequest = new Request(injectionResult.url.toString(), request);

  return {
    request: modifiedRequest,
    url: injectionResult.url,
    injectedParams: injectionResult.injected,
    skippedParams: injectionResult.skipped,
  };
}
