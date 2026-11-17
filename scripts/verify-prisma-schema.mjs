import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const db = new DatabaseSync(":memory:");
try {
  for (const file of (await readdir(new URL("backend/migrations/", root)))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(
      await readFile(new URL(`backend/migrations/${file}`, root), "utf8"),
    );
  }
  const schema = await readFile(
    new URL("backend/prisma/schema.prisma", root),
    "utf8",
  );
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((row) => row.name)
    .sort();
  const models = [...schema.matchAll(/^model (\w+) \{([^}]+)\}/gm)];
  const mappedTables = [];
  for (const [, name, body] of models) {
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name;
    mappedTables.push(table);
    assert.ok(tables.includes(table), `Unknown model table ${table}`);
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
    const scalars = [
      ...body.matchAll(
        /^[ \t]*(\w+)[ \t]+(String|Int|BigInt|Float|Boolean|Bytes|Json|DateTime|Decimal)(\??)([ \t]+[^\n]*)?$/gm,
      ),
    ].map(([, field, type, optional, attributes = ""]) => ({
      column: attributes.match(/@map\("([^"]+)"\)/)?.[1] ?? field,
      type,
      optional: optional === "?",
    }));
    assert.deepEqual(
      scalars.map((f) => f.column).sort(),
      columns.map((c) => c.name).sort(),
      `${name}: complete column mapping`,
    );
    for (const field of scalars) {
      const column = columns.find((c) => c.name === field.column);
      if (!column.pk)
        assert.equal(
          field.optional,
          column.notnull === 0,
          `${table}.${field.column}: nullability`,
        );
      if (field.column.endsWith("_minor"))
        assert.equal(
          field.type,
          "BigInt",
          `${table}.${field.column}: exact money type`,
        );
      if (column.type === "TEXT")
        assert.equal(
          field.type,
          "String",
          `${table}.${field.column}: preserve stored text`,
        );
    }
  }
  assert.deepEqual(
    mappedTables.sort(),
    tables,
    "Every existing application table has a model",
  );
  console.log(
    `Prisma mapping verification passed (${models.length} models; columns, nullability, text and monetary types match all existing migrations).`,
  );
} finally {
  db.close();
}
