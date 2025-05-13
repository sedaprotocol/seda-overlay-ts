export type GasOptions = {
	/** Integer or the string 'auto'. Default 'auto' */
	gas?: number | "auto";
	/** Default: 1.3 */
	adjustmentFactor?: number;
	/** Default 10000000000 */
	gasPrice?: string;
};
