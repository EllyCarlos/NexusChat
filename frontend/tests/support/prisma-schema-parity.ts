import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type SchemaInput = {
  label: string;
  source: string;
};

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

const moduleRequire = createRequire(import.meta.url);

function resolvePrismaCliPath(): string {
  try {
    const packagePath = moduleRequire.resolve("prisma/package.json");
    const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
      bin?: string | Record<string, unknown>;
    };
    const binEntry =
      typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.prisma;
    if (typeof binEntry !== "string" || binEntry.trim() === "") {
      throw new Error('the package does not declare a valid "prisma" bin entry');
    }

    const cliPath = resolve(dirname(packagePath), binEntry);
    if (!statSync(cliPath).isFile()) {
      throw new Error(`the declared bin is not a file: ${cliPath}`);
    }
    return cliPath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Prisma tooling error: unable to resolve the installed package CLI from prisma/package.json (${detail}).`,
    );
  }
}

const prismaCliPath = resolvePrismaCliPath();
const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoot = join(
  frontendRoot,
  "node_modules",
  ".cache",
  "nexuschat-prisma-parity",
);
const placeholderEnvironment = {
  ...process.env,
  DATABASE_URL: "postgresql://prisma:prisma@127.0.0.1:5432/nexuschat_parity",
  DIRECT_URL: "postgresql://prisma:prisma@127.0.0.1:5432/nexuschat_parity",
  SHADOW_DATABASE_URL:
    "postgresql://prisma:prisma@127.0.0.1:5432/nexuschat_parity_shadow",
};
const datamodelCache = new Map<string, Promise<JsonValue>>();

function runPrisma(args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCliPath, ...args], {
      cwd,
      env: placeholderEnvironment,
      shell: false,
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}

function sortByJson<T extends JsonValue>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

function normalizeDatamodel(datamodel: JsonValue): JsonValue {
  const value = datamodel as {
    enums: Array<Record<string, JsonValue>>;
    models: Array<Record<string, JsonValue>>;
    types: Array<Record<string, JsonValue>>;
  };

  const normalizeModel = (
    model: Record<string, JsonValue>,
  ): Record<string, JsonValue> => ({
    ...model,
    fields: [...(model.fields as Array<Record<string, JsonValue>>)].sort(
      (left, right) => String(left.name).localeCompare(String(right.name)),
    ),
    uniqueFields: sortByJson(model.uniqueFields as JsonValue[]),
    uniqueIndexes: sortByJson(model.uniqueIndexes as JsonValue[]),
  });

  return {
    ...value,
    enums: [...value.enums].sort((left, right) =>
      String(left.name).localeCompare(String(right.name)),
    ),
    models: value.models
      .map(normalizeModel)
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    types: value.types
      .map(normalizeModel)
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
  };
}

async function generateDatamodel(schema: SchemaInput): Promise<JsonValue> {
  const cacheKey = createHash("sha256").update(schema.source).digest("hex");
  const cached = datamodelCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const generated = (async () => {
    await mkdir(temporaryRoot, { recursive: true });
    const directory = await mkdtemp(join(temporaryRoot, "prisma-parity-dmmf-"));
    const schemaPath = join(directory, "schema.prisma");
    const outputPath = join(directory, "generated");
    const parityGenerator = `generator parityClient {
  provider = "prisma-client-js"
  output   = "./generated"
}

`;

    try {
      await writeFile(schemaPath, parityGenerator + schema.source, "utf8");
      const result = await runPrisma(
        ["generate", "--schema", schemaPath, "--generator", "parityClient"],
        frontendRoot,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Prisma could not build the semantic model for ${schema.label}.\n${result.stderr || result.stdout}`,
        );
      }

      const generatedClient = moduleRequire(join(outputPath, "index.js")) as {
        Prisma: { dmmf: { datamodel: JsonValue } };
      };
      return normalizeDatamodel(
        structuredClone(generatedClient.Prisma.dmmf.datamodel),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  })();

  datamodelCache.set(cacheKey, generated);
  return generated;
}

function describeFirstDifference(
  canonical: JsonValue,
  mirror: JsonValue,
  path = "datamodel",
): string | undefined {
  if (Object.is(canonical, mirror)) {
    return undefined;
  }
  if (
    canonical === null ||
    mirror === null ||
    typeof canonical !== "object" ||
    typeof mirror !== "object"
  ) {
    return `${path}: expected ${JSON.stringify(canonical)}, received ${JSON.stringify(mirror)}`;
  }
  if (Array.isArray(canonical) || Array.isArray(mirror)) {
    if (!Array.isArray(canonical) || !Array.isArray(mirror)) {
      return `${path}: one side is an array and the other is not`;
    }
    if (canonical.length !== mirror.length) {
      return `${path}: expected ${canonical.length} entries, received ${mirror.length}`;
    }
    for (let index = 0; index < canonical.length; index += 1) {
      const difference = describeFirstDifference(
        canonical[index],
        mirror[index],
        `${path}[${index}]`,
      );
      if (difference) {
        return difference;
      }
    }
    return undefined;
  }

  const canonicalRecord = canonical as Record<string, JsonValue>;
  const mirrorRecord = mirror as Record<string, JsonValue>;
  const keys = [
    ...new Set([...Object.keys(canonicalRecord), ...Object.keys(mirrorRecord)]),
  ].sort();
  for (const key of keys) {
    if (!(key in canonicalRecord) || !(key in mirrorRecord)) {
      return `${path}.${key}: present only in ${key in canonicalRecord ? "canonical" : "mirror"} schema`;
    }
    const difference = describeFirstDifference(
      canonicalRecord[key],
      mirrorRecord[key],
      `${path}.${key}`,
    );
    if (difference) {
      return difference;
    }
  }
  return undefined;
}

function removeAllowedExtensionDiff(sql: string): string {
  return sql
    .replace(/\r\n/g, "\n")
    .replace(/^--[^\n]*(?:\n|$)/gm, "")
    .replace(
      /CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";\s*/g,
      "",
    )
    .trim();
}

async function compareDatabaseSemantics(
  canonical: SchemaInput,
  mirror: SchemaInput,
): Promise<string | undefined> {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "prisma-parity-diff-"));
  const canonicalPath = join(directory, "canonical.prisma");
  const mirrorPath = join(directory, "mirror.prisma");

  try {
    await Promise.all([
      writeFile(canonicalPath, canonical.source, "utf8"),
      writeFile(mirrorPath, mirror.source, "utf8"),
    ]);
    const result = await runPrisma(
      [
        "migrate",
        "diff",
        "--from-schema-datamodel",
        mirrorPath,
        "--to-schema-datamodel",
        canonicalPath,
        "--script",
      ],
      frontendRoot,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Prisma could not compare ${canonical.label} with ${mirror.label}.\n${result.stderr || result.stdout}`,
      );
    }

    return removeAllowedExtensionDiff(result.stdout) || undefined;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function assertPrismaSchemaParity(
  canonical: SchemaInput,
  mirror: SchemaInput,
): Promise<void> {
  const databaseDifference = await compareDatabaseSemantics(canonical, mirror);
  if (databaseDifference) {
    throw new Error(
      `Prisma schema drift detected. ${canonical.label} is canonical and ${mirror.label} must mirror its application datamodel.\nDatabase datamodel:\n${databaseDifference}`,
    );
  }

  const [canonicalDatamodel, mirrorDatamodel] = await Promise.all([
    generateDatamodel(canonical),
    generateDatamodel(mirror),
  ]);

  const datamodelDifference = describeFirstDifference(
    canonicalDatamodel,
    mirrorDatamodel,
  );
  if (!datamodelDifference) {
    return;
  }
  throw new Error(
    `Prisma schema drift detected. ${canonical.label} is canonical and ${mirror.label} must mirror its application datamodel.\nClient datamodel: ${datamodelDifference}`,
  );
}

export async function readSchema(path: string, label: string): Promise<SchemaInput> {
  return { label, source: await readFile(path, "utf8") };
}
