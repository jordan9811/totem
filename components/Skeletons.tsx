export function CastSkeleton() {
  return (
    <div className="border-b border-x-border px-4 py-3">
      <div className="flex">
        <div className="skeleton mr-2 h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 pt-1">
          <div className="skeleton h-3.5 w-48 rounded-full" />
          <div className="skeleton mt-3 h-3.5 w-full rounded-full" />
          <div className="skeleton mt-2 h-3.5 w-[85%] rounded-full" />
          <div className="skeleton mt-2 h-3.5 w-[60%] rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function TimelineSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div data-testid="timeline-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <CastSkeleton key={i} />
      ))}
    </div>
  );
}
