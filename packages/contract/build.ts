import { basename, resolve } from "node:path";
import { compileFromFile } from "json-schema-to-typescript";

const targetDir = resolve(import.meta.dir, "./src/result-schema/");

const rawSchemasGlob = new Bun.Glob(resolve(import.meta.dir, "./src/contract-schema/raw/*.json"));

for await (const schemaPath of rawSchemasGlob.scan()) {
	const result = await compileFromFile(schemaPath);
	const typeScriptFileName = `${basename(schemaPath, ".json")}.d.ts`;

	await Bun.write(`${targetDir}/${typeScriptFileName}`, result);
}
