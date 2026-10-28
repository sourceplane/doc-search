// The migration manifest's shape. A "context" names the slice of the schema
// a migration belongs to: `control` is the runner's own tracking schema,
// `app` is the template's. Add contexts here when a port grows bounded
// contexts of its own.
export const BOUNDED_CONTEXTS = ["control", "app"] as const;

export type BoundedContext = (typeof BOUNDED_CONTEXTS)[number];

export interface MigrationEntry {
  id: string;
  context: BoundedContext;
  path: string;
  checksum: string;
  description: string;
}

export interface MigrationManifest {
  version: 1;
  migrations: MigrationEntry[];
}
