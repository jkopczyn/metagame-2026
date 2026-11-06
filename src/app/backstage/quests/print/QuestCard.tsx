import QRCode from "qrcode";
import { UsersIcon } from "lucide-react";
import styles from "./card.module.css";
import { CLASS_LABELS, isMegagameClass } from "@/lib/megagame-levels";
import { cardBackground, stampList, stampsOf } from "@/lib/megagame-quests";
import type { Quest } from "@/lib/megagame-store";
import { POSTER_ORIGIN } from "@/lib/poster-options";
import { formatTicketCode } from "@/lib/ticket-code-format";
import { EmblemContent } from "@/v2/components/megagame/FactionEmblem";

const ART = "/megagame/quest-art";

/** The label's QR: the /q/<code> link the board opens from. Plain modules, M correction. */
function QuestQr({ code }: { code: string }) {
  const { modules } = QRCode.create(`${POSTER_ORIGIN}/q/${code}`, {
    errorCorrectionLevel: "M",
  });
  const size = modules.size;
  let d = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
  return (
    <svg
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      className={styles.qr}
      shapeRendering="crispEdges"
      aria-label={`QR code for /q/${code}`}
    >
      <rect x={-1} y={-1} width={size + 2} height={size + 2} fill="#fff" />
      <path d={d} fill="#231f20" />
    </svg>
  );
}

function ClassIcon({ cls }: { cls: "wizard" | "pirate" | "alien" }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden>
      <EmblemContent faction={cls} />
    </svg>
  );
}

/** One US Letter page. CardFit shrinks the title and text to fit after load. */
export default function QuestCard({ quest }: { quest: Quest }) {
  const background = cardBackground(quest);
  const cls = quest.class && isMegagameClass(quest.class) ? quest.class : null;
  const stamps = stampList(stampsOf(quest));
  const level =
    cls === null
      ? null
      : quest.minLevel !== null && quest.maxLevel !== null
        ? `Lv.${quest.minLevel}–${quest.maxLevel}`
        : quest.minLevel !== null
          ? `Lv.${quest.minLevel}+`
          : quest.maxLevel !== null
            ? `Lv.≤${quest.maxLevel}`
            : null;
  return (
    <section className={styles.card} data-card={formatTicketCode(quest.code)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- print art at page size */}
      <img className={styles.bg} src={`${ART}/paper.jpg`} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element -- print art at page size */}
      <img
        className={styles.emblem}
        src={`${ART}/emblem-${background}.png`}
        alt=""
      />
      <div className={styles.frame}>
        <h1 className={styles.title} data-title>
          <span>{quest.title}</span>
        </h1>

        <div className={styles.reqs}>
          <div className={styles.req}>
            <UsersIcon aria-label="Players" strokeWidth={2.5} />
            <span>{quest.minPlayers}+</span>
          </div>
          {cls && (
            <>
              <div className={styles.join}>&amp;</div>
              <div className={styles.req}>
                <ClassIcon cls={cls} />
                <span>{level ?? CLASS_LABELS[cls]}</span>
              </div>
            </>
          )}
        </div>

        <div className={styles.body} data-body>
          <div className={styles.bodyText} data-body-text>
            {quest.bodyText}
          </div>
        </div>

        {quest.bodyImages.length > 0 ? (
          <div
            className={`${styles.images} ${styles[`n${quest.bodyImages.length}`] ?? ""}`}
            data-images
          >
            {quest.bodyImages.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element -- Blob URL, print size
              <img key={src} src={src} alt="" />
            ))}
          </div>
        ) : (
          <div className={styles.spacer} />
        )}

        <footer className={styles.footer}>
          <div className={styles.rewards}>
            {stamps.map((s) => (
              <div key={s.class} className={styles.reward}>
                {s.class === "any" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- print art
                  <img src={`${ART}/emblem-star.png`} alt="Any class" />
                ) : (
                  <ClassIcon cls={s.class} />
                )}
                <span>×{s.n}</span>
              </div>
            ))}
            {stamps.length > 0 && (
              <div className={styles.rewardLabel}>stamps</div>
            )}
          </div>
          {quest.author && (
            <div className={styles.author}>Quest by {quest.author}</div>
          )}
          <div className={styles.code}>
            <span className={styles.codeText}>
              {formatTicketCode(quest.code)}
            </span>
            <QuestQr code={quest.code} />
          </div>
        </footer>
      </div>
    </section>
  );
}
