import { Bone, Skeleton } from "@/v2/components/Skeleton";

// Sits above each tool's layout, whose header waits on the viewer's access, so
// this draws the same frame as ToolLayout with no title in it yet.
export default function BackstageLoading() {
  return (
    <Skeleton className="flex min-h-full flex-1 flex-col bg-cream text-ink">
      <div className="h-[53px] border-b border-line" />
      <div className="w-full px-4 py-8 md:px-20 lg:px-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <Bone className="h-8 w-64" />
          <Bone className="h-[420px] w-full" />
        </div>
      </div>
    </Skeleton>
  );
}
