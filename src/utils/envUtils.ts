/**
 * Utility functions for environment variable parsing
 */

/**
 * Parse a boolean environment variable that accepts multiple truthy/falsy values:
 * - Truthy: "1", "true", "yes", "on" (case insensitive)
 * - Falsy: "0", "false", "no", "off" (case insensitive) or undefined/empty
 * 
 * @param envVar - The environment variable value
 * @param defaultValue - Default value if envVar is undefined/empty (default: false)
 * @returns boolean value
 */
export function parseBooleanEnv(envVar: string | undefined, defaultValue = false): boolean {
  if (!envVar) return defaultValue;
  
  const normalized = envVar.toLowerCase().trim();
  
  // Truthy values
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  
  // Falsy values
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  
  // Unknown values default to false
  return defaultValue;
}

/**
 * Get a boolean environment variable with consistent parsing
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set (default: false)
 * @returns boolean value
 */
export function getBooleanEnv(name: string, defaultValue = false): boolean {
  return parseBooleanEnv(process.env[name], defaultValue);
}
