import ContentPage from "@/v2/components/ContentPage";
import { Bone, Skeleton } from "@/v2/components/Skeleton";

export default function ProfileLoading() {
  return (
    <ContentPage title="Profile" wide>
      <Skeleton label="Loading this profile" className="flex flex-col gap-12">
        <div className="flex max-w-[820px] flex-col gap-8 sm:flex-row sm:gap-10">
          <Bone className="size-40 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-4">
            <Bone className="h-8 w-48" />
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-2/3" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Bone className="h-9 w-40" />
          <Bone className="h-[70px] w-full" />
        </div>
      </Skeleton>
    </ContentPage>
  );
}
