import { connection } from "next/server";
import SignIn from "../../SignIn";
import { toolAccess } from "@/lib/admin-auth";
import { describeSchema, type TableInfo } from "@/db/describe";

export default async function AdminSchemaListPage() {
  await connection();

  if (!(await toolAccess("schema.view"))) {
    return (
      <div className="px-4 py-8">
        <SignIn next="/backstage/schema/list" />
      </div>
    );
  }

  const { groups, tables, enums } = describeSchema();
  const relationships = tables.flatMap((t) =>
    t.columns.flatMap((c) =>
      c.references ? [{ from: `${t.name}.${c.name}`, ...c.references }] : [],
    ),
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
      <section className="space-y-3">
        <p className="text-sm text-ink/70">
          Read straight from the Drizzle schema in <code>src/db/schema</code>,
          so this page always matches the code on this deploy. Every section and
          table folds; click a name below to jump to it.
        </p>
        <nav className="flex flex-wrap gap-2 text-sm">
          {tables.map((t) => (
            <a
              key={t.name}
              href={`#table-${t.name}`}
              className="rounded-md border border-line bg-white px-2.5 py-1 font-mono text-navy hover:border-navy"
            >
              {t.name}
              <span className="ml-1.5 text-ink/50">{t.columns.length}</span>
            </a>
          ))}
        </nav>
      </section>

      <Section title="Relationships" count={relationships.length}>
        <ul className="space-y-1 font-mono text-sm">
          {relationships.map((r) => (
            <li key={r.from}>
              <span className="text-ink">{r.from}</span>
              <span className="text-ink/50"> → </span>
              <a href={`#table-${r.table}`} className="text-navy underline">
                {r.table}.{r.column}
              </a>
              <span className="ml-2 text-xs text-ink/50">
                on delete {r.onDelete}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {groups.map((g) => (
        <Section key={g.name} title={g.name} count={g.tables.length}>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
            {g.tables.map((t) => (
              <TableCard key={t.name} table={t} />
            ))}
          </div>
        </Section>
      ))}

      <Section title="Enums" count={enums.length}>
        {enums.map((e) => (
          <p key={e.name} className="flex flex-wrap gap-1.5 font-mono text-sm">
            <span className="text-ink">{e.name}</span>
            <span className="text-ink/50">=</span>
            {e.values.map((v) => (
              <span
                key={v}
                className="rounded bg-white px-1.5 py-0.5 text-navy ring-1 ring-line"
              >
                {v}
              </span>
            ))}
          </p>
        ))}
      </Section>
    </div>
  );
}

/** A collapsible top-level section. Open by default; state is per page load. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details open className="group/section">
      <summary className="flex cursor-pointer items-center gap-2 select-none">
        <Chevron />
        <h2 className="font-bebas text-2xl tracking-wide text-navy">{title}</h2>
        <span className="text-sm text-ink/50">{count}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function TableCard({ table }: { table: TableInfo }) {
  return (
    <details
      open
      id={`table-${table.name}`}
      className="group/table scroll-mt-20 rounded-xl border border-line bg-white shadow-sm"
    >
      <summary className="flex cursor-pointer items-start gap-2 px-4 py-3 select-none">
        <Chevron className="mt-1.5" />
        <span>
          <span className="block font-mono text-lg text-navy">
            {table.name}
            <span className="ml-2 font-sans text-sm text-ink/50">
              {table.columns.length} columns
            </span>
          </span>
          {table.note && (
            <span className="mt-1 block text-sm text-ink/70">{table.note}</span>
          )}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wide text-ink/50 uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Column</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Constraints</th>
              <th className="px-4 py-2 font-medium">Default</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {table.columns.map((c) => (
              <tr key={c.name}>
                <td className="px-4 py-2 whitespace-nowrap text-ink">
                  {c.name}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-ink/80">
                  {c.type}
                  {c.enumValues && (
                    <span className="ml-1 text-xs text-ink/50">
                      ({c.enumValues.join(" | ")})
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span className="flex flex-wrap gap-1">
                    {c.primary && <Tag tone="navy">primary key</Tag>}
                    {c.unique && !c.primary && <Tag tone="navy">unique</Tag>}
                    {!c.nullable && !c.primary && <Tag>not null</Tag>}
                    {c.references && (
                      <a href={`#table-${c.references.table}`}>
                        <Tag tone="meeple">
                          → {c.references.table}.{c.references.column}
                        </Tag>
                      </a>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-ink/60">
                  {c.default ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(table.indexes.length > 0 || table.referencedBy.length > 0) && (
        <div className="space-y-1 border-t border-line px-4 py-3 font-mono text-xs wrap-anywhere text-ink/70">
          {table.indexes.map((i) => (
            <p key={i.name}>
              {i.unique ? "unique index" : "index"} {i.name} on (
              {i.columns.join(", ")})
            </p>
          ))}
          {table.referencedBy.length > 0 && (
            <p>
              referenced by{" "}
              {table.referencedBy.map((r, idx) => (
                <span key={`${r.table}.${r.column}`}>
                  {idx > 0 && ", "}
                  <a href={`#table-${r.table}`} className="text-navy underline">
                    {r.table}.{r.column}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

/** Rotates when the enclosing <details> is open (via the group-open variant). */
function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-ink/50 transition-transform group-open/section:rotate-90 group-open/table:rotate-90 ${className}`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tag({
  tone = "ink",
  children,
}: {
  tone?: "ink" | "navy" | "meeple";
  children: React.ReactNode;
}) {
  const color = {
    ink: "text-ink/70 ring-line",
    navy: "text-navy ring-navy/30",
    meeple: "text-meeple ring-meeple/30",
  }[tone];
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-sans whitespace-nowrap ring-1 ${color}`}
    >
      {children}
    </span>
  );
}
