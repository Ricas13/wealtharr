import "server-only";
import postgres from "postgres";
import {
  configureTypeHandlers,
  DB_CONNECT_TIMEOUT_SECONDS,
  DB_CONNECTION_PARAMETERS,
  DB_IDLE_TIMEOUT_SECONDS,
  DB_POOL_MAX,
  type TypeHandlerTables
} from "@/lib/db-config";

const url = process.env.DATABASE_URL ?? "postgres://invalid:invalid@127.0.0.1:1/invalid";
const client = postgres(url, {
  max: DB_POOL_MAX,
  prepare: false,
  idle_timeout: DB_IDLE_TIMEOUT_SECONDS,
  connect_timeout: DB_CONNECT_TIMEOUT_SECONDS,
  connection: { ...DB_CONNECTION_PARAMETERS }
});

// Date/JSON parsing and serialisation is configured explicitly here (see db-config.ts) rather than
// as a side effect of constructing an ORM client.
configureTypeHandlers(client.options as unknown as TypeHandlerTables);

export { client as sql };
