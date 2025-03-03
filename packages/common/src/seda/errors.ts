export class AlreadyCommitted extends Error {
	static isError(error: Error): boolean {
		return error.message.includes("AlreadyCommitted");
	}
}

export class RevealMismatch extends Error {
	static isError(error: Error): boolean {
		return error.message.includes("RevealMismatch");
	}
}

export class AlreadyRevealed extends Error {
	static isError(error: Error): boolean {
		return error.message.includes("AlreadyRevealed");
	}
}

export class IncorrectAccountSquence extends Error {
	static isError(error: Error): boolean {
		return error.message.includes("account sequence mismatch");
	}
}

export class DataRequestExpired extends Error {
	static isError(error: Error): boolean {
		return error.message.includes("DataRequestExpired");
	}
}

