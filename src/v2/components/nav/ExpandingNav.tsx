"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ACCOUNT_LINK,
  ADMIN_LINK,
  HOME_SECTIONS,
  LOGIN_LINK,
  NAV_LINKS,
  type NavLink,
} from "./links";
import { NavLogo, Pips, TopIcon } from "./LogoDice";
import AccountMenu from "./AccountMenu";
import { useHomeSection } from "./useHomeSection";
import { useAccountStatus } from "./useAccountStatus";
import { useMediaQuery } from "./useMediaQuery";

// Collapsed, this is just the single MG die in the corner. Desktop: clicking it
// unfolds the die into the full METAGAME wordmark while the section links slide
// out horizontally from behind it, sharing the wordmark's easing so the two
// read as one motion. Mobile: same unfold, but the links stack down a
// full-height column instead.
const EASE = "cubic-bezier(0.65,0,0.35,1)";
const UNFOLD_MS = 800;
// Mobile's sideways phase is quicker and eases out; the drop-down phase that
// follows keeps the desktop timing.
const MOBILE_SIDEWAYS_MS = 450;
// The drop-down phase: no ease-out so it doesn't drag at the bottom; the
// words are revealed as it passes them. Collapses quicker still.
const MOBILE_DROP_MS = 650;
const MOBILE_DROP_EASE = "cubic-bezier(0.4,0,0.8,0.9)";
const MOBILE_COLLAPSE_MS = 500;
const MOBILE_SIDEWAYS_EASE = "cubic-bezier(0.22,1,0.36,1)";
const LINK_STAGGER_MS = 50;
const AUTO_OPEN_DELAY_MS = 2000;

// Per-item delays folded into the shorthand (React warns when `transition`
// and `transitionDelay` are set together).
const withDelay = (parts: string[], delayMs: number) =>
  parts.map((t) => `${t} ${Math.round(delayMs)}ms`).join(", ");

// Which nav entry the current route belongs to: null for pages not in the
// nav (/credits, /thanks, …), which get the Home link but no "current" mark.
// On "/" the hash sections (tickets, get-involved) take over from Home as
// scroll-spy reaches them.
function useActiveLink(
  links: readonly NavLink[],
  section: string | null,
): string | null {
  const pathname = usePathname();
  if (pathname === "/") {
    return links.some((l) => l.id === section) ? section : "home";
  }
  return (
    links.find((l) => l.id !== "home" && pathname.startsWith(l.href))?.id ??
    null
  );
}

// Everything the die's top face can show: nav pages plus the one-pager's
// sections, deduped where a section is also a nav link.
const TOP_FACES = [
  ...NAV_LINKS,
  ADMIN_LINK,
  LOGIN_LINK,
  ACCOUNT_LINK,
  ...HOME_SECTIONS.filter((s) => !NAV_LINKS.some((l) => l.id === s.id)),
].map(({ id, icon }) => ({ id, icon }));

// Backdrop outline: the die's isometric hexagon (pointy top/bottom, cos 30°
// half-width, sized from the die row height `hex`) whose vertices stretch into
// edges as the box grows — sideways into the desktop bar, downward into the
// mobile menu — an octagon with hex-angled corners that collapses back to the
// hexagon.
const CORNER = 3;
function backdropPath(w: number, h: number, hexH: number) {
  const hx = hexH * 0.433;
  const q = hexH / 4;
  const raw: [number, number][] = [
    [hx, 0],
    [w - hx, 0],
    [w, q],
    [w, h - q],
    [w - hx, h],
    [hx, h],
    [0, h - q],
    [0, q],
  ];
  // Collapsed, the two top (and two bottom) points coincide — drop the dupes
  // so the corner rounding has real edges to work with.
  const pts = raw.filter(
    ([x, y], i) =>
      i === 0 || Math.hypot(x - raw[i - 1][0], y - raw[i - 1][1]) > 0.5,
  );
  const unit = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    return [dx / len, dy / len];
  };
  const f = (v: number) => +v.toFixed(2);
  return (
    pts
      .map(([vx, vy], i) => {
        const [px, py] = pts[(i + pts.length - 1) % pts.length];
        const [nx, ny] = pts[(i + 1) % pts.length];
        const [ux, uy] = unit(vx - px, vy - py);
        const [wx, wy] = unit(nx - vx, ny - vy);
        // Mid-transition an edge can be shorter than the rounding; cap so the
        // curve never overshoots the vertex.
        const r = Math.min(
          CORNER,
          Math.hypot(vx - px, vy - py) / 2,
          Math.hypot(nx - vx, ny - vy) / 2,
        );
        return `${i === 0 ? "M" : "L"}${f(vx - ux * r)} ${f(vy - uy * r)} Q${f(vx)} ${f(vy)} ${f(vx + wx * r)} ${f(vy + wy * r)}`;
      })
      .join(" ") + " Z"
  );
}

// --grow is registered as a real <length> so the hover swell can transition
// the variable itself and every size derived from it moves in lockstep.
// Done from JS: the CSS build minifies an @property's `0px` to `0`, which is
// invalid for <length> and silently drops the whole rule.
function registerGrow() {
  try {
    CSS.registerProperty({
      name: "--grow",
      syntax: "<length>",
      inherits: true,
      initialValue: "0px",
    });
  } catch {
    // Already registered (HMR / second mount).
  }
}

export default function ExpandingNav() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const section = useHomeSection();
  const onHome = usePathname() === "/";
  const account = useAccountStatus();
  // Backstage lives in the account menu rather than the bar.
  const links: readonly NavLink[] = [
    ...NAV_LINKS,
    ...(account ? [account.signedIn ? ACCOUNT_LINK : LOGIN_LINK] : []),
  ];

  // Backstage isn't in the bar, but on it the die still shows its icon and
  // the Account menu (where it lives) reads as current.
  const active = useActiveLink([...links, ADMIN_LINK], section);
  const accountCurrent = active === "account" || active === "admin";
  // The die's top face: on "/" the section under the viewport centre, else
  // the current page's icon, or home's pips off-nav.
  const topIcon = section ?? active ?? "home";
  // Home while already on "/" (or "/#tickets"): Next would treat it as a
  // no-op, so scroll to the top ourselves.
  const onLinkClick = (id: string) => (e: React.MouseEvent) => {
    if (id === "home" && onHome) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (window.location.hash) history.replaceState(null, "", "/");
    }
  };
  useEffect(registerGrow, []);
  const [expanded, setExpanded] = useState(false);
  // Mobile opens sideways then down, and closes down then sideways — so the
  // die's own unfold state lags `expanded` on close by one phase.
  const [dieOpen, setDieOpen] = useState(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  // Until the die is first clicked (or the bar opens itself), a ring pulses
  // out from it as a hint.
  const [nudged, setNudged] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dieRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  // Natural sizes of the two link lists, measured so `width`/`height` can
  // transition to them — `auto` doesn't animate.
  const [rowWidth, setRowWidth] = useState(0);
  // Mobile column is exactly as wide as the die button (wordmark + its rim),
  // so the box stays symmetric about the logo; labels are narrower anyway.
  const [dieWidth, setDieWidth] = useState(0);
  // Moving right along the list, underlines sweep left→right (in and out);
  // moving left, right→left.
  const [prevActive, setPrevActive] = useState(topIcon);
  const [fromLeft, setFromLeft] = useState(true);
  if (topIcon !== prevActive) {
    const idx = (id: string) => links.findIndex((s) => s.id === id);
    setFromLeft(idx(topIcon) > idx(prevActive));
    setPrevActive(topIcon);
  }

  useLayoutEffect(() => {
    const row = rowRef.current;
    const boxEl = boxRef.current;
    const die = dieRef.current;
    if (!row || !boxEl || !die) return;
    const measure = () => {
      setRowWidth(row.scrollWidth);
      setDieWidth(die.offsetWidth);
      // The clip-path must match the box on the very frame it's painted —
      // a React state round-trip lags a frame, and while the box shrinks a
      // stale (larger) clip lets its square bottom edge show. So write it
      // straight to the element from the observer callback, which runs
      // after layout and before paint.
      const clip = `path("${backdropPath(
        boxEl.offsetWidth,
        boxEl.offsetHeight,
        die.offsetHeight,
      )}")`;
      boxEl.style.clipPath = clip;
      if (pulseRef.current) pulseRef.current.style.clipPath = clip;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(die);
    ro.observe(boxEl);
    return () => ro.disconnect();
  }, []);

  const setOpen = useCallback(
    (open: boolean) => {
      setExpanded(open);
      if (foldTimer.current) clearTimeout(foldTimer.current);
      if (open || desktop) setDieOpen(open);
      else
        foldTimer.current = setTimeout(
          () => setDieOpen(false),
          MOBILE_COLLAPSE_MS,
        );
    },
    [desktop],
  );
  useEffect(
    () => () => {
      if (foldTimer.current) clearTimeout(foldTimer.current);
    },
    [],
  );

  // Home, desktop: once the hero has scrolled off the top, unfold the bar
  // unprompted (once per load, and only if the die hasn't been touched yet)
  // so first-time visitors see there's a nav. Mobile's menu covers the page,
  // so it never opens itself.
  useEffect(() => {
    if (!desktop || !onHome || nudged) return;
    const hero = document.getElementById("home");
    if (!hero) return;
    // A beat after the hero leaves, so it reads as a reaction, not a jolt.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting || entry.boundingClientRect.top > 0) return;
      io.disconnect();
      timer = setTimeout(() => {
        setNudged(true);
        setOpen(true);
      }, AUTO_OPEN_DELAY_MS);
    });
    io.observe(hero);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [desktop, onHome, nudged, setOpen]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The account menu portals out of the nav; it still counts as inside.
      const inMenu = (target as Element).closest?.("[data-nav-menu]");
      if (!rootRef.current?.contains(target) && !inMenu) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // An Escape the menu already used closes just the menu.
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, setOpen]);

  // Mobile has no hover, so no swell there.
  const unfold = desktop ? expanded : dieOpen;
  const sidewaysMs = desktop ? UNFOLD_MS : MOBILE_SIDEWAYS_MS;
  const sidewaysEase = desktop ? EASE : MOBILE_SIDEWAYS_EASE;
  const grow = desktop && (hovered || expanded);

  const linkClass = (isActive: boolean) =>
    `relative inline-block cursor-pointer rounded-md px-2 py-2 text-2xl font-medium whitespace-nowrap md:py-1.5 md:text-xl transition-colors duration-200 outline-none after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:bg-brand-blue after:transition-transform after:duration-200 hover:text-cream hover:after:scale-x-100 focus-visible:ring-2 focus-visible:ring-brand-blue ${
      isActive
        ? "text-cream after:scale-x-100"
        : "text-cream/75 after:scale-x-0"
    } ${
      // Incoming underline grows from the side you came from; the outgoing
      // one collapses toward the side you're heading to, so the pair reads
      // as one sweep in the scroll direction.
      isActive === fromLeft ? "after:origin-left" : "after:origin-right"
    }`;

  const dropDown = !desktop && expanded;

  return (
    <div
      ref={rootRef}
      // Fixed UI lives in viewport space, so the stage must not treat it as
      // a (moving) collider.
      data-solid="none"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // The backdrop's margin around the die grows a touch on hover; the open
      // bar keeps that grown size. Offsetting top/left by half keeps the die
      // fixed in place while the hexagon swells around it.
      className={`fixed z-40 flex items-start font-[family-name:var(--font-inter)] [--bar-h:calc(66px+var(--grow))] [--nav-h:54px] md:[--bar-h:calc(76px+var(--grow))] md:[--nav-h:64px]`}
      style={{
        ["--grow" as string]: grow ? "6px" : "0px",
        transition: "--grow 350ms cubic-bezier(0.45,0,0.55,1)",
        // Half-width of a hexagon this tall (cos 30°).
        ["--hex" as string]: "calc(var(--bar-h) * 0.433)",
        top: "calc(0.75rem - var(--grow) / 2)",
        left: "calc(0.75rem - var(--grow) / 2)",
      }}
    >
      {nudged || (
        <div
          ref={pulseRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-brand-blue opacity-0 motion-safe:animate-nav-pulse"
        />
      )}
      {/* Desktop: a row (die + links) whose width follows its content. Mobile:
          a column — width still content-driven (wordmark or widest link),
          height explicit so it can transition to the full screen. */}
      <div
        ref={boxRef}
        className="flex max-w-[calc(100vw-1.5rem)] flex-col items-start bg-navy md:h-(--bar-h) md:flex-row md:items-center"
        style={{
          // Pre-measure fallback (SSR/first paint) — the observer replaces it
          // with the rounded path.
          clipPath:
            "polygon(var(--hex) 0, calc(100% - var(--hex)) 0, 100% 25%, 100% 75%, calc(100% - var(--hex)) 100%, var(--hex) 100%, 0 75%, 0 25%)",
          ...(desktop
            ? undefined
            : {
                height: dropDown ? "calc(100dvh - 1.5rem)" : "var(--bar-h)",
                // Second phase on open, first on close.
                transition: `height ${dropDown ? MOBILE_DROP_MS : MOBILE_COLLAPSE_MS}ms ${dropDown ? MOBILE_DROP_EASE : EASE} ${dropDown ? sidewaysMs : 0}ms`,
                // Swiping the open menu shouldn't scroll the page under it.
                touchAction: dropDown ? "none" : undefined,
                overscrollBehavior: "contain",
              }),
        }}
      >
        <button
          ref={dieRef}
          type="button"
          aria-label={expanded ? "Close navigation" : "Open navigation"}
          aria-expanded={expanded}
          aria-controls="expanding-nav-links"
          onClick={() => {
            setNudged(true);
            setOpen(!expanded);
          }}
          // Collapsed, the button is the hexagon (2·hex wide) with the die
          // centered; expanded, it grows with the wordmark from that same left
          // inset so the first die never shifts.
          // Mobile, unfolded: a wider symmetric inset (the black dice need
          // visible navy around them), which the die slides into. Collapsed
          // (and desktop) keep the 5px that centres the die in the hexagon.
          className={`flex h-(--bar-h) min-w-[calc(2*var(--hex))] shrink-0 cursor-pointer items-center outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-inset md:pr-0 md:pl-[calc(5px+var(--grow)/2)] ${unfold ? "px-3" : "pr-0 pl-[5px]"}`}
          // Desktop transitions padding-right only: its left inset must follow
          // --grow exactly, or the die lags behind the swelling backdrop.
          style={{
            transition: `${desktop ? "padding-right" : "padding"} ${sidewaysMs}ms ${sidewaysEase}`,
          }}
        >
          <NavLogo
            expanded={unfold}
            durationMs={sidewaysMs}
            easing={sidewaysEase}
            className="h-(--nav-h)"
            // Top face shows where you are: the page's icon (or, on the
            // one-pager, the section's), crossfading as you navigate or
            // scroll. Home, and the unfolded wordmark (where the "2" is part
            // of METAGAME 2026), keep the die's own 2 pips.
            top={TOP_FACES.map(({ id, icon: Icon }) => (
              <g
                key={id}
                style={{
                  opacity: (unfold ? "home" : topIcon) === id ? 1 : 0,
                  transition: "opacity 250ms ease",
                }}
              >
                {id === "home" ? (
                  <Pips pips={2} />
                ) : (
                  <TopIcon>
                    <Icon size={24} strokeWidth={2} />
                  </TopIcon>
                )}
              </g>
            ))}
          />
        </button>
        {/* Desktop: links slide out to the right inside the stretching bar.
            Scrollable once open so the row still works where it outruns the
            viewport. */}
        <nav
          id="expanding-nav-links"
          aria-label="Site navigation"
          aria-hidden={!unfold}
          className={`hidden min-w-0 [scrollbar-width:none] md:block ${unfold ? "overflow-x-auto" : "overflow-hidden"}`}
          style={{
            width: unfold ? rowWidth : 0,
            transition: `width ${UNFOLD_MS}ms ${EASE}`,
          }}
        >
          <ul
            ref={rowRef}
            className="flex w-max items-center gap-4 pr-(--hex) pl-2"
          >
            {links.map(({ id, label, href }, i) => {
              const style = {
                opacity: unfold ? 1 : 0,
                transform: unfold ? "translateX(0)" : "translateX(-12px)",
                // Links ripple out left→right on open and fold back
                // right→left on close, trailing the wordmark's dice.
                transition: withDelay(
                  [
                    `opacity 300ms ease`,
                    `transform 450ms ${EASE}`,
                    "color 200ms ease",
                  ],
                  unfold
                    ? 200 + i * LINK_STAGGER_MS
                    : (links.length - 1 - i) * LINK_STAGGER_MS * 0.5,
                ),
              };
              return (
                <li key={id}>
                  {id === "account" ? (
                    <AccountMenu
                      admin={account?.admin ?? false}
                      userId={account?.userId ?? null}
                      current={accountCurrent}
                      className={linkClass(accountCurrent)}
                      style={style}
                      tabIndex={unfold ? 0 : -1}
                    />
                  ) : (
                    <Link
                      href={href}
                      tabIndex={unfold ? 0 : -1}
                      onClick={onLinkClick(id)}
                      aria-current={active === id ? "page" : undefined}
                      className={linkClass(active === id)}
                      style={style}
                    >
                      {label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        {/* Mobile: links stack under the die, spread down the full-height box,
            flush with the die's left edge. The list is already its final
            height while the box grows, so the words hold position and roll
            into view one by one as the box reaches them. Width 0 while closed
            so the widest label can't prop the hexagon open. Picking one closes
            the menu, since it's covering content. Bottom padding clears the
            hex cap. */}
        <nav
          aria-label="Site navigation"
          aria-hidden={!dropDown}
          className="min-h-0 flex-1 overflow-hidden md:hidden"
          style={{
            width: dropDown ? dieWidth : 0,
            // Sideways phase: with the wordmark on open, after the height
            // has collapsed on close.
            transition: `width ${sidewaysMs}ms ${sidewaysEase} ${dropDown ? 0 : MOBILE_COLLAPSE_MS}ms`,
          }}
        >
          <ul className="flex h-[calc(100dvh-1.5rem-var(--bar-h))] w-max flex-col items-start justify-around pb-[calc(var(--bar-h)/4)] pl-2">
            {links.map(({ id, label, href }, i) => {
              const style = {
                opacity: dropDown ? 1 : 0,
                // Fade each word in around when the growing box uncovers
                // it; on close the shrinking box hides them, so they only
                // fade once it's down.
                transition: withDelay(
                  ["opacity 1000ms ease", "color 200ms ease"],
                  dropDown
                    ? sidewaysMs +
                        ((i + 0.5) / links.length) * MOBILE_DROP_MS * 0.8
                    : MOBILE_COLLAPSE_MS,
                ),
              };
              return (
                <li key={id}>
                  {id === "account" ? (
                    <AccountMenu
                      admin={account?.admin ?? false}
                      userId={account?.userId ?? null}
                      current={accountCurrent}
                      className={linkClass(accountCurrent)}
                      style={style}
                      tabIndex={dropDown ? 0 : -1}
                      onPick={() => setOpen(false)}
                    />
                  ) : (
                    <Link
                      href={href}
                      tabIndex={dropDown ? 0 : -1}
                      onClick={(e) => {
                        onLinkClick(id)(e);
                        setOpen(false);
                      }}
                      aria-current={active === id ? "page" : undefined}
                      className={linkClass(active === id)}
                      style={style}
                    >
                      {label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
