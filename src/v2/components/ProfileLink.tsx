import Link from "next/link";

/** A person's name, linking to their /u profile. */
export default function ProfileLink({
  userId,
  name,
  className = "underline underline-offset-2 hover:text-meeple",
}: {
  userId: string;
  name: string;
  className?: string;
}) {
  return (
    <Link href={`/u/${encodeURIComponent(userId)}`} className={className}>
      {name}
    </Link>
  );
}
