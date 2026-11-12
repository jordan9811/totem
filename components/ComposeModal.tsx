"use client";
import { useEffect } from "react";
import { useApp } from "./Providers";
import { Composer } from "./Composer";
import { CloseIcon } from "./icons";

export function ComposeModalHost() {
  const { composeOpen, setComposeOpen } = useApp();

  useEffect(() => {
    document.body.style.overflow = composeOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [composeOpen]);

  if (!composeOpen) return null;
  return (
    <div
      data-testid="compose-modal"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-[#5b708366]"
      onClick={() => setComposeOpen(false)}
    >
      <div
        className="mt-0 w-full max-w-[600px] rounded-none bg-white sm:mt-[5vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[53px] items-center justify-between px-4">
          <button
            data-testid="compose-modal-close"
            onClick={() => setComposeOpen(false)}
            className="-ml-2 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover"
            aria-label="Close"
          >
            <CloseIcon size={20} />
          </button>
          <button className="rounded-full px-3 py-1 text-[14px] font-bold text-x-blue hover:bg-[#1d9bf01a]">
            Drafts
          </button>
        </div>
        <div className="[&>div]:border-b-0">
          <Composer autoFocus onPosted={() => setComposeOpen(false)} />
        </div>
      </div>
    </div>
  );
}
