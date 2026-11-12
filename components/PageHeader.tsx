"use client";
import { useRouter } from "next/navigation";
import { BackArrow } from "./icons";

export function PageHeader({
  title,
  titleBadge,
  subtitle,
  back = false,
  right,
  overlayOnMobile = false,
}: {
  title: string;
  titleBadge?: React.ReactNode;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  /** X mobile profile: translucent back button floats over the banner; the
   *  title bar only exists on desktop widths. */
  overlayOnMobile?: boolean;
}) {
  const router = useRouter();
  if (overlayOnMobile) {
    return (
      <>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-[#0f1419bf] text-white sm:hidden"
        >
          <BackArrow size={20} />
        </button>
        <div data-chrome="header" className="persona-chrome persona-mode-edge sticky top-0 z-20 hidden h-[53px] items-center bg-white/85 px-4 backdrop-blur-md sm:flex">
          <HeaderInner
            title={title}
            titleBadge={titleBadge}
            subtitle={subtitle}
            back={back}
            right={right}
            router={router}
          />
        </div>
      </>
    );
  }
  return (
    <div data-chrome="header" className="persona-chrome persona-mode-edge sticky top-0 z-20 flex h-[53px] items-center bg-white/85 px-4 backdrop-blur-md">
      <HeaderInner
        title={title}
        titleBadge={titleBadge}
        subtitle={subtitle}
        back={back}
        right={right}
        router={router}
      />
    </div>
  );
}

function HeaderInner({
  title,
  titleBadge,
  subtitle,
  back,
  right,
  router,
}: {
  title: string;
  titleBadge?: React.ReactNode;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <>
      {back && (
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="-ml-2 mr-5 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover"
        >
          <BackArrow size={20} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center text-xl font-black leading-6">
          <span className="truncate">{title}</span>
          {titleBadge}
        </h1>
        {subtitle && <p className="text-[13px] leading-4 text-x-sec">{subtitle}</p>}
      </div>
      {right}
    </>
  );
}
