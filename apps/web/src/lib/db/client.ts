import { MongoClient, type Db } from "mongodb";
import { readRuntimeConfig } from "@/lib/config";

type GlobalMongoCache = {
  __secondMongoClientPromise?: Promise<MongoClient>;
  __secondMongoDatabaseName?: string;
};

const globalMongoCache = globalThis as typeof globalThis & GlobalMongoCache;

function extractDatabaseNameFromUri(mongodbUri: string): string {
  const url = new URL(mongodbUri);
  const pathname = url.pathname.replace(/^\//, "").trim();

  if (!pathname) {
    throw new Error(
      "[runtime-config] MONGODB_URI must include a database name in the path, for example mongodb://host:27017/second.",
    );
  }

  return decodeURIComponent(pathname.split("/")[0]);
}

function getMongoDatabaseName(): string {
  if (!globalMongoCache.__secondMongoDatabaseName) {
    const config = readRuntimeConfig();
    globalMongoCache.__secondMongoDatabaseName = extractDatabaseNameFromUri(
      config.mongodbUri,
    );
  }

  return globalMongoCache.__secondMongoDatabaseName;
}

export function getMongoClient(): Promise<MongoClient> {
  if (!globalMongoCache.__secondMongoClientPromise) {
    const config = readRuntimeConfig();
    const client = new MongoClient(config.mongodbUri);

    globalMongoCache.__secondMongoClientPromise = client.connect().catch((error) => {
      globalMongoCache.__secondMongoClientPromise = undefined;
      throw error;
    });
  }

  return globalMongoCache.__secondMongoClientPromise;
}

export async function getMongoDatabase(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName());
}
