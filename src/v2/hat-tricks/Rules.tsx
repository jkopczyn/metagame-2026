import { HEADING } from "@/v2/components/styles";

// The rule text is the user's wording, copied as written. Do not edit it.
const RULES: { title: string; body: string }[] = [
  {
    title: "Honor Among Thieves",
    body: "This game is opt-in and more dangerous than other games. It is not possible to police these rules perfectly without constant surveillance, so the honor system for self-reports and ruler violation is necessary. If you won’t, can’t, or don’t want to adhere to this, do not accept or steal a hat, and hand off any hats you stumble on to another team member or volunteer ASAP. Do not involve players without making sure they understand this and opt in, and definitely don't involve any young children.",
  },
  {
    title: "Wear Your Hats",
    body: "While in public areas, all hats in your custody must be worn, whether or not they may be stolen currently. If one of your hats can be stolen but there are others on top of it, those can be stolen at the same time. Bedrooms and bathrooms are not public. If you invite someone into a private area with you, it’s public for them until they leave. If you’re observed breaking this rule, you forfeit the hat(s) and the observer gets it.",
  },
  {
    title: "Guile, Not Might",
    body: "No punching, kicking, grappling, wrestling, etc. allowed. Parrying incoming grabby hands is allowed; immobilizing one hand to prevent a second from grabbing is borderline. If you break this rule, you’ll lose credit for the steal, have to give it back, and, if it was egregious or you’ve been warned, be banned from the game. If not from the conference.",
  },
  {
    title: "Watch the Clocks",
    body: "Not all hats may be stolen at all times. The webpage shows the schedule and the currently-stealable hats. Stealing a hat outside this window except by ‘salvage’ of an abandoned hat will be punished by reversal and a penalty. That includes bribery/extortion; if you want that, make the trade during a stealing window.",
  },
];

export default function Rules() {
  return (
    <div className="space-y-3">
      {RULES.map((rule) => (
        <details
          key={rule.title}
          className="rounded-lg border border-line bg-white px-5 py-4"
        >
          <summary
            className={`${HEADING} cursor-pointer text-[20px] text-navy`}
          >
            {rule.title}
          </summary>
          <p className="mt-3 text-base text-ink/70">{rule.body}</p>
        </details>
      ))}
    </div>
  );
}
