export class AlreadyCommitted {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Data request already committed";
	}
}

export class RevealMismatch {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Reveal mismatch";
	}
}

export class AlreadyRevealed {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Data request already revealed";
	}
}

export class IncorrectAccountSquence {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Account sequence mismatch";
	}
}

export class DataRequestNotFound {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Data request not found";
	}
}

export class DataRequestExpired {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Data request expired";
	}
}

export class RevealStarted {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Reveal started";
	}
}

export class UnknownError {
	message: string;

	constructor(message?: string) {
		this.message = message ?? "Unknown error";
	}
}
