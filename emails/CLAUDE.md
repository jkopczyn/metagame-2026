# Emails

Hand-pasted EmailOctopus templates. The app only reads them to list them on
`/backstage/emails` (`src/lib/sent-emails.ts`; the `.min.html` and `.txt`
variants hang off their `.html`); sending is still manual. Unsent emails live
in `emails/drafts/`; `git mv` one (with its variants) to the top level once
it's been sent, which is what marks it sent in the tool. After editing one,
paste it into EmailOctopus again (the `.min.html` variant for the
announcements, which sit near Gmail's ~102 KB clipping limit).

## EmailOctopus facts

- Subject and preview text come from the campaign/automation, not `<title>`.
- Required footer tags: `{{UnsubscribeURL}}`, `{{SenderInfoLine}}` in its own
  `<p>`, and `<a href="{{RewardsURL}}">Powered by EmailOctopus</a>`. Never
  hand-write the return address.
- The text/plain part is auto-generated from the HTML. Close anchors tight
  (`</a>` on the same line) or the converter drops the URL.
- Images are hotlinked from metagame.games (`public/images/email/`), JPEG/PNG
  only. Every content `<img>` needs its own font/size/color so alt text renders
  with images off.
- Not verified: whether the unsubscribe link is one click or shows a confirm
  page first.

## Style

- Plain white background, no card/frame around the email.
- Gutters as in `early-bird-reminder.html`: 36px, 18px on phones via `.gutter`.
- Body stays edge to edge; tinted boxes are for one call-out at most.

