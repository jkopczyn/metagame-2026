// The home page with a slot for the session modal: a session link opens its
// details over the page instead of leaving for /schedule (see @modal).
export default function HomeLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
