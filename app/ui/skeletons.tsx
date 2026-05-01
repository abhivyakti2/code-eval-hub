// Loading animation

//TODO : create skeletons for our working logic components, and remove the given skeletons. current dashboard skeleton is not based on our new ui, so that needs to be changed as well. 
const shimmer =
  'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent';


export function RepoInputSkeleton() {
  return (
    <div className={`${shimmer} relative overflow-hidden rounded-lg border border-gray-200 bg-white p-6 shadow-sm`}>
      <div className="mb-4 h-6 w-40 rounded bg-gray-200" />
      <div className="flex gap-2">
        <div className="h-10 flex-1 rounded-md bg-gray-200" />
        <div className="h-10 w-28 rounded-lg bg-gray-200" />
      </div>
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
          <div className={`${shimmer} relative h-12 w-64 overflow-hidden rounded-lg bg-gray-200`} />
        </div>
      ))}
    </div>
  );
}

export function SidenavChatSkeleton() {
  return (
    <div className="space-y-1 px-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`${shimmer} relative h-12 overflow-hidden rounded-md bg-gray-100`} />
      ))}
    </div>
  );
}