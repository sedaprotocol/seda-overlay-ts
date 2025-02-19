/**
 * Type representing a hexadecimal string prefixed with "0x"
 */
export type Hex = `0x${string}`;

/**
 * Ensures a string has a "0x" prefix by adding it if not present
 * @param input The string to add prefix to
 * @returns The input string with "0x" prefix
 */
export function add0x(input: string): Hex {
	if (input.startsWith("0x")) return input as Hex;
	return `0x${input}`;
}

/**
 * Removes the "0x" prefix from a string if present
 * @param input The string to remove prefix from
 * @returns The input string without "0x" prefix
 */
export function strip0x(input: string): string {
	if (input.startsWith("0x")) return input.slice(2);
	return input;
}
