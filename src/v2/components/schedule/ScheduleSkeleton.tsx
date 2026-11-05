import { Bone, Skeleton } from "@/v2/components/Skeleton";

// The schedule's controls at their real sizes on both layouts, so nothing
// moves when it arrives; a day's grid is about this tall.
export default function ScheduleSkeleton() {
  return (
    <Skeleton label="Loading the schedule" className="flex flex-col gap-5">
      <div className="flex h-[42px] items-center gap-2 sm:gap-3">
        <Bone className="h-[42px] min-w-0 flex-1 sm:max-w-[448px]" />
        <Bone className="ml-auto h-[34px] w-[38px] shrink-0 sm:h-[38px] sm:w-36" />
        <Bone className="h-[34px] w-[116px] shrink-0 sm:hidden" />
      </div>
      <div className="flex h-[38px] items-center justify-center gap-3 sm:h-[46px]">
        <Bone className="h-[38px] w-[200px] sm:h-[46px] sm:w-[432px]" />
        <Bone className="hidden h-9 w-[274px] sm:block" />
      </div>
      <div className="flex h-10 items-start justify-center sm:h-[18px]">
        <Bone className="h-full w-[300px] sm:w-[686px]" />
      </div>
      <Bone className="h-[1895px] w-full" />
    </Skeleton>
  );
}
