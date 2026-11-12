"use client";
// PUBLIC GO-LIVE — the guided first run's progress indicator: "Step 2 of 3" and three dots. The steps it counts are
// lib/onboarding/state.ts COUNTED_STEPS (Sign in, This is you, Keep your account); the welcome screen and the hand-off
// show none.
import { COUNTED_STEPS, progressOf, type OnboardingStep } from "@/lib/onboarding/state";


/** one screen of the flow: a heading, a plain sentence, the step's own content, and Back / Skip / Continue */
export function StepShell({
  step,
  title,
  lead,
  children,
  onBack,
  onSkip,
  skipLabel = "Skip for now",
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
}: {
  step: OnboardingStep;
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <section data-testid={"onboard-step-" + step} data-step={step} className="px-4 pb-10 pt-4">
      <h1 className="text-[24px] font-extrabold leading-7 tracking-tight">{title}</h1>
      {lead ? <p className="mt-2 text-[15px] leading-5 text-x-sec">{lead}</p> : null}
      <div className="mt-4 grid gap-3">{children}</div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onNext ? (
          <button
            type="button"
            data-testid="onboard-next"
            disabled={nextDisabled}
            onClick={onNext}
            className="inline-flex h-11 items-center justify-center rounded-full bg-x-blue px-6 text-[16px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50"
          >
            {nextLabel}
          </button>
        ) : null}
        {onSkip ? (
          <button type="button" data-testid="onboard-skip" onClick={onSkip} className="h-11 rounded-full px-4 text-[15px] font-bold text-x-text hover:bg-x-hover">
            {skipLabel}
          </button>
        ) : null}
        {onBack ? (
          <button type="button" data-testid="onboard-back" onClick={onBack} className="ml-auto h-11 rounded-full px-4 text-[15px] font-bold text-x-sec hover:bg-x-hover">
            Back
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function Progress({ step }: { step: OnboardingStep }) {
  const at = progressOf(step);
  if (!at) return null;
  return (
    <div data-testid="onboard-progress" data-step={step} data-index={at.index} data-total={at.total} className="px-4 pt-4">
      <p className="text-[13px] font-bold leading-4 text-x-sec">
        Step {at.index} of {at.total}
      </p>
      <ol aria-hidden="true" data-testid="onboard-dots" className="mt-2 flex items-center gap-2">
        {COUNTED_STEPS.map((s, i) => (
          <li key={s} data-on={i < at.index ? "true" : "false"} className={"h-2 w-2 rounded-full " + (i < at.index ? "bg-x-blue" : "bg-[#cfd9de]")} />
        ))}
      </ol>
    </div>
  );
}
