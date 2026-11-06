import { Card } from "./ui";

// Shown in place of a tool that reads an Airtable table when no key is set,
// so a checkout without credentials looks unconfigured rather than broken.
export default function AirtableUnavailable({
  title,
  table,
}: {
  title: string;
  /** Airtable table the tool reads, by its title in the base. */
  table: string;
}) {
  return (
    <Card title={title}>
      <p className="text-sm text-ink/70">
        This tool reads the <strong>{table}</strong> table in Airtable, and this
        deploy has no <code>AIRTABLE_API_KEY</code>, so there is nothing to
        show. See <code>.env.example</code>.
      </p>
    </Card>
  );
}
