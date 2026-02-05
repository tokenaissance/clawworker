/**
 * Configuration constants for Moltbot Sandbox
 */

/** Port that the Moltbot gateway listens on inside the container */
export const MOLTBOT_PORT = 18789;

/** Maximum time to wait for Moltbot to start (3 minutes) */
export const STARTUP_TIMEOUT_MS = 180_000;

/**
 * Get R2 bucket name based on environment
 * @param environment - Environment name from ENVIRONMENT variable
 * @returns Bucket name (e.g., "moltbot-data-production", "moltbot-data-development")
 */
export function getR2BucketName(environment?: string): string {
  if (!environment) {
    // Fallback for legacy/base configuration
    return 'moltbot-data';
  }
  return `moltbot-data-${environment}`;
}

/**
 * Get R2 mount path based on environment
 * @param environment - Environment name from ENVIRONMENT variable
 * @returns Mount path (e.g., "/data/moltbot-production", "/data/moltbot-development")
 */
export function getR2MountPath(environment?: string): string {
  if (!environment) {
    return '/data/moltbot';
  }
  return `/data/moltbot-${environment}`;
}

/**
 * Get Sandbox Durable Object instance identifier based on environment
 * This ensures development and production use completely separate container instances
 *
 * @param environment - Environment name from ENVIRONMENT variable
 * @returns Instance identifier (e.g., "moltbot-production", "moltbot-development")
 *
 * @example
 * getSandboxInstanceId('production')  // → "moltbot-production"
 * getSandboxInstanceId('development') // → "moltbot-development"
 * getSandboxInstanceId(undefined)     // → "moltbot" (legacy/default)
 */
export function getSandboxInstanceId(environment?: string): string {
  if (!environment) {
    return 'moltbot';  // Backward compatibility: use default when no environment variable
  }
  return `moltbot-${environment}`;
}
