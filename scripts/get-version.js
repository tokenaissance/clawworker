/**
 * Get version information for config isolation
 * Returns: {git_tag}_{unix_timestamp}
 *
 * Examples:
 *   v1.0.0_1738425600    (tagged release)
 *   v1.0.0-3-gc43689c_1738425600  (commits after tag)
 *   c43689c_1738425600   (no tags)
 */

import { execSync } from 'child_process';

function getGitVersion() {
  try {
    // Try to get version from git describe (includes tag + commits + hash)
    const version = execSync('git describe --tags --always --dirty', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    return version;
  } catch (error) {
    // Fallback if git command fails
    console.error('Warning: Failed to get git version, using fallback');
    return 'unknown';
  }
}

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function getConfigVersion() {
  const gitVersion = getGitVersion();
  const timestamp = getTimestamp();

  // Fail-fast: if git version is unknown and we're in production, error
  if (gitVersion === 'unknown' && process.env.NODE_ENV === 'production') {
    console.error('ERROR: Cannot determine version in production build');
    console.error('Make sure git is available and repository has commits/tags');
    process.exit(1);
  }

  return `${gitVersion}_${timestamp}`;
}

export { getConfigVersion, getGitVersion, getTimestamp };
