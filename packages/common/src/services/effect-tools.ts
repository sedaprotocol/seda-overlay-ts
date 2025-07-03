import { Cause, Effect, Exit, Option } from "effect";
import { Result } from "true-myth";

export function resultToEffect<T, E = Error>(result: Result<T, E>): Effect.Effect<T, E> {
	return result.match({
		Ok: (value) => Effect.succeed(value) as Effect.Effect<T, E>,
		Err: (error) => Effect.fail(error),
	});
}

export function promiseResultToEffect<T, E = Error>(promise: Promise<Result<T, E>>): Effect.Effect<T, E> {
	return Effect.flatMap(
		Effect.tryPromise({
			try: () => promise,
			catch: (error: unknown) => {
				if (error instanceof Error) {
					return error as E;
				}
				return error as E;
			},
		}),
		resultToEffect,
	);
}

export function tryAsyncEffect<T, E = Error>(callback: Promise<T>): Effect.Effect<T, E> {
	return Effect.tryPromise({
		try: () => callback,
		catch: (error: unknown) => {
			return error as E;
		},
	});
}

export function exitToResult<T, E>(exit: Exit.Exit<T, E>): Result<T, E> {
    return Exit.match(exit, {
        onSuccess: (value) => Result.ok(value),
        onFailure: (cause) => {
            const error = Cause.failureOption(cause);

            // Option.

            if (Option.isSome(error)) {
                return Result.err(error.value);
            }

            return Result.err();
        },
    });
}