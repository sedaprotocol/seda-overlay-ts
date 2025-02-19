import Big from "big.js";

Big.DP = 1_000_000;
Big.PE = 1_000_000;
Big.NE = -1_000_000;

/**
 * Formats an integer token value to a human readable string representation.
 *
 * For example, if you have 1000000000000000000 (18 decimals), it will return "1.00"
 *
 * @example
 * ```ts
 * formatTokenUnits("1000000000000000000") // "1.00"
 * formatTokenUnits("1234560000000000000", 18, 4) // "1.2346"
 * formatTokenUnits("1000000", 6) // "1.00"
 * ```
 *
 * @export
 * @param amount The integer token amount as a string
 * @param decimals Number of decimal places in the integer representation
 * @param dp Number of decimal places to show in the formatted output
 * @returns The formatted token amount
 */
export function formatTokenUnits(amount: string | bigint | number, decimals = 18, dp = 2): string {
	const denominator = new Big(10).pow(decimals);
	return new Big(amount.toString()).div(denominator).toFixed(dp);
}

/**
 * Formats a fractional token value (human readable) to an integer string representation.
 *
 * For example, if you have "1.0" (18 decimals), it will return "1000000000000000000"
 *
 * @example
 * ```ts
 * parseTokenUnits("1.0") // "1000000000000000000"
 * parseTokenUnits("1.23", 18) // "1230000000000000000"
 * parseTokenUnits("1.0", 6) // "1000000"
 * ```
 *
 * @export
 * @param amount The decimal token amount as a string
 * @param decimals Number of decimal places to use in the integer representation
 * @return The parsed token amount as an integer string
 */
export function parseTokenUnits(amount: string, decimals = 18): string {
	const denominator = new Big(10).pow(decimals);
	return new Big(amount).mul(denominator).toFixed(0);
}
