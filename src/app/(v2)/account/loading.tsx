import { Bone, Skeleton } from "@/v2/components/Skeleton";

// Same measure and top clearance as the account page. The bones are neutral
// because this also covers navigating to /account/sessions/<id>.
export default function AccountLoading() {
  return (
    <Skeleton
      label="Loading your account"
      className="mx-auto max-w-[1180px] px-8 pt-28 pb-20"
    >
      <div className="mb-10 flex h-[43px] max-w-[960px] gap-2 border-b border-line sm:h-[51px] sm:gap-6">
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} className="h-5 w-16 sm:h-6 sm:w-20" />
        ))}
      </div>
      <div className="flex max-w-[960px] flex-col gap-10">
        <Bone className="h-[114px] w-full sm:h-[72px] sm:w-[413px]" />
        <Bone className="size-24 rounded-full" />
        <div className="grid gap-12 md:grid-cols-2">
          <Bone className="h-[480px]" />
          <Bone className="h-60" />
        </div>
      </div>
    </Skeleton>
  );
}
