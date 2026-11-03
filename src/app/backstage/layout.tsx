import ExpandingNav from "@/v2/components/nav/ExpandingNav";

// The site's corner nav over every tool; the tools' headers leave its corner
// free. Mounted after the content so it paints over the tools' own sticky bars.
export default function BackstageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ExpandingNav />
    </>
  );
}
