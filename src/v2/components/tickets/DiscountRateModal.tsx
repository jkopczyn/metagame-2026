"use client";

import { withUtm } from "@/lib/utm";
import { Button } from "@/v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import { FINANCIAL_AID_FORM_URL } from "@/v2/lib/links";
import { HEADING } from "../styles";

export const DISCOUNT_RATE_HREF = "/ticket/DISCOUNT-RATE";

export default function DiscountRateModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-[460px] flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-2 pr-6">
          <DialogTitle className={`${HEADING} text-[clamp(24px,6vw,30px)]`}>
            Student / Financial Aid
          </DialogTitle>
          <DialogDescription className="text-base text-cream/80">
            50% off a Standard ticket. This rate is for students, people who are
            unemployed, nonprofit employees, and anyone otherwise in need of
            financial aid.
          </DialogDescription>
        </div>
        <Button asChild className="h-12 w-full text-base">
          <a
            href={DISCOUNT_RATE_HREF}
            onClick={(e) => {
              e.currentTarget.href = withUtm(DISCOUNT_RATE_HREF);
            }}
            target="_blank"
            rel="noopener noreferrer"
          >
            Buy now
          </a>
        </Button>
        <p className="text-center text-sm text-cream/70">
          Still too expensive?{" "}
          <a
            href={FINANCIAL_AID_FORM_URL}
            className="font-bold text-tan underline underline-offset-2"
          >
            Apply for financial aid here
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
