"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Component,
  createContext,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { sessionDetails } from "@/app/(v2)/schedule/details";
import { sessionHref } from "@/lib/schedule";
import {
  closeSessionHref,
  openSessionHref,
  samePage,
  SESSION_PARAM,
  SESSION_TITLE_ID,
  sessionPageSlug,
} from "@/lib/session-link";
import SessionModal from "./SessionModal";

const HostContext = createContext(false);
const ReloadContext = createContext<(() => void) | null>(null);

/**
 * Where a session link should point from the current page: over it as
 * ?session=<slug> under a host, or to the session's own page without one
 * (the backstage tools).
 */
export function useSessionHref(): (slug: string) => string {
  const pathname = usePathname();
  const hosted = useContext(HostContext);
  return (slug) =>
    hosted ? openSessionHref(pathname, slug) : sessionHref({ slug });
}

/** Opens the session: over this page by rewriting the URL (a router
 *  navigation would refetch the page and scroll to its top), else routed. */
export function useOpenSession(): (slug: string) => void {
  const href = useSessionHref();
  const router = useRouter();
  return (slug) => {
    const to = href(slug);
    if (samePage(to, window.location.href)) {
      window.history.pushState(null, "", to);
    } else {
      router.push(to, { scroll: false });
    }
  };
}

function plainClick(e: MouseEvent) {
  return (
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.defaultPrevented
  );
}

/** A session link that opens the modal in place when it's over this page;
 *  modified clicks and other pages navigate. */
export function SessionLink({
  href,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  return (
    <Link
      {...rest}
      href={href}
      // Opening in place never uses a prefetch, and a grid holds dozens of these.
      prefetch={false}
      scroll={false}
      onClick={(e) => {
        onClick?.(e);
        if (!plainClick(e) || !samePage(href, window.location.href)) return;
        e.preventDefault();
        window.history.pushState(null, "", href);
      }}
    />
  );
}

/**
 * Re-reads the modal body from the server, when it's one loaded over another
 * page; null on the session's own page, where a router refresh does that.
 */
export function useReloadSession() {
  return useContext(ReloadContext);
}

/**
 * Opens the session named by the page's ?session= param over it. Under a
 * Suspense boundary so the prerendered pages (the home page) stay static.
 */
export default function SessionModalHost({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <HostContext value>
      {children}
      <Suspense fallback={null}>
        <ParamModal />
      </Suspense>
    </HostContext>
  );
}

function ParamModal() {
  const pathname = usePathname();
  const params = useSearchParams();
  const slug = params.get(SESSION_PARAM);
  // A session's own page renders its modal itself.
  if (!slug || sessionPageSlug(pathname)) return null;
  return (
    <SessionModal
      key={slug}
      closeHref={closeSessionHref(pathname, params.toString())}
      labelledBy={SESSION_TITLE_ID}
    >
      <LoadedSession slug={slug} />
    </SessionModal>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p id={SESSION_TITLE_ID} className="text-sm text-[#1b1530]/60">
      {children}
    </p>
  );
}

const LOADING = <Note>Loading&hellip;</Note>;

/** The session's details, rendered on the server once the modal opens. */
function LoadedSession({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0);
  const [body, setBody] = useState<ReactNode>(LOADING);
  const reload = () => {
    setBody(LOADING);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    sessionDetails(slug)
      .then((node) => {
        if (live)
          setBody(
            node ?? <Note>This session isn&rsquo;t on the schedule.</Note>,
          );
      })
      .catch(() => {
        if (live) setBody(<LoadFailed />);
      });
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  // The body streams in from the action: parts of it can still be pending or
  // throw while rendering, and both should stay inside the modal.
  return (
    <ReloadContext value={reload}>
      <BodyBoundary key={attempt} fallback={<LoadFailed />}>
        <Suspense fallback={LOADING}>{body}</Suspense>
      </BodyBoundary>
    </ReloadContext>
  );
}

function LoadFailed() {
  const reload = useReloadSession();
  return (
    <Note>
      Couldn&rsquo;t load this session.{" "}
      <button type="button" onClick={() => reload?.()} className="underline">
        Try again
      </button>
    </Note>
  );
}

class BodyBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
