export class AlreadyCommitted extends Error {
	constructor(message?: string) {
		super(`AlreadyCommitted: ${message ?? "Data request already committed"}`);
	}

	static isError(error: unknown): error is AlreadyCommitted {
		return error instanceof Error && error.message.includes("AlreadyCommitted");
	}
}

export class RevealMismatch extends Error {
	constructor(message?: string) {
		super(`RevealMismatch: ${message ?? "Reveal mismatch"}`);
	}

	static isError(error: unknown): error is RevealMismatch {
		return error instanceof Error && error.message.includes("RevealMismatch");
	}
}

export class AlreadyRevealed extends Error {
	constructor(message?: string) {
		super(`AlreadyRevealed: ${message ?? "Data request already revealed"}`);
	}

	static isError(error: unknown): error is AlreadyRevealed {
		return error instanceof Error && error.message.includes("AlreadyRevealed");
	}
}

export class IncorrectAccountSquence extends Error {
	constructor(message?: string) {
		super(`IncorrectAccountSquence: ${message ?? "Account sequence mismatch"}`);
	}

	static isError(error: unknown): error is IncorrectAccountSquence {
		return error instanceof Error && error.message.includes("account sequence mismatch");
	}
}

export class DataRequestNotFound extends Error {
	constructor(message?: string) {
		super(`DataRequestNotFound: ${message ?? "Data request not found"}`);
	}

	static isError(error: unknown): error is DataRequestNotFound {
		return error instanceof Error && error.message.includes("not found: execute wasm contract failed");
	}
}

export class DataRequestExpired extends Error {
	constructor(message?: string) {
		super(`DataRequestExpired: ${message ?? "Data request expired"}`);
	}

	static isError(error: unknown): error is DataRequestExpired {
		return error instanceof Error && error.message.includes("DataRequestExpired");
	}
}

export class RevealStarted extends Error {
	constructor(message?: string) {
		super(`RevealStarted: ${message ?? "Reveal started"}`);
	}

	static isError(error: unknown): error is RevealStarted {
		return error instanceof Error && error.message.includes("RevealStarted");
	}
}
