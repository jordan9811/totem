"use client";
import { useState } from "react";
import type { User } from "@/lib/types";
import { formatFull } from "@/lib/format";
import { TierBadge } from "./TierBadge";
import { CloseIcon, VerifiedBadge } from "./icons";
import { useApp } from "./Providers";
import { FarcasterFollowButton, NetworkMarker, networkReadOnlySentence } from "./CastCard";

function EditProfileModal({ user, onClose }: { user: User; onClose: () => void }) {
  return (
    <div
      data-testid="edit-profile-modal"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-[#5b708366]"
      onClick={onClose}
    >
      <div
        className="mt-[5vh] w-full max-w-[600px] overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[53px] items-center px-4">
          <button
            onClick={onClose}
            aria-label="Close"
            className="-ml-2 mr-5 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover"
          >
            <CloseIcon size={20} />
          </button>
          <h2 className="flex-1 text-xl font-bold">Edit profile</h2>
          <button
            onClick={onClose}
            className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover"
          >
            Save
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-6">
          <div className="mb-4 flex items-center justify-between rounded-xl border border-x-border p-3">
            <div>
              <p className="text-[15px] font-bold">Edit your photo with Imagine</p>
              <p className="text-[13px] text-x-sec">Customize yourself in seconds</p>
            </div>
            <button className="h-8 rounded-full border border-[#cfd9de] px-3 text-[14px] font-bold">
              Edit Photo
            </button>
          </div>
          {[
            { label: "Name", value: user.displayName },
            { label: "Bio", value: user.bio ?? "", tall: true },
            { label: "Location", value: "" },
            { label: "Website", value: "" },
          ].map((f) => (
            <label key={f.label} className="mb-4 block rounded-[4px] border border-[#cfd9de] px-2 pb-2 pt-1 focus-within:border-x-blue">
              <span className="block text-[13px] leading-4 text-x-sec">{f.label}</span>
              {f.tall ? (
                <textarea defaultValue={f.value} rows={3} className="w-full resize-none text-[17px] outline-none" />
              ) : (
                <input defaultValue={f.value} className="w-full text-[17px] outline-none" />
              )}
            </label>
          ))}
          <button className="flex w-full items-center justify-between py-3 text-left">
            <div>
              <p className="text-[15px]">Birth date</p>
              <p className="text-[15px] text-x-sec">Add your date of birth</p>
            </div>
            <span className="text-x-sec">›</span>
          </button>
          <button className="flex w-full items-center justify-between py-3 text-left">
            <p className="text-xl">Switch to professional</p>
            <span className="text-x-sec">›</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfileHeader({
  user,
  isSelf,
  tier,
  network = false,
  live = false,
}: {
  user: User;
  isSelf: boolean;
  tier?: number;
  /** FC-READ: a live Farcaster account read through the relay — following it would be a network write */
  network?: boolean;
  /** BUILD A review (UXC-12): a real Farcaster account read directly (the owner service's live content) — its Follow
   *  asks /api/actions/follow, which follows as the acting persona or says why not (it used to be an inert button) */
  live?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { toast } = useApp();
  return (
    // FC-READ (review): a network account's header is network content — its bio and name are whatever the account
    // wrote — so it carries data-live like a network card (the page-health needle scan skips [data-live]); absent on
    // every seed/fixture profile, whose DOM is unchanged
    <div data-testid={network ? "network-profile-header" : undefined} data-live={network ? "true" : undefined}>
      <div className="h-[130px] bg-[#cfd9de] sm:h-[200px]">
        {user.bannerUrl && <img src={user.bannerUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-start justify-between">
          <img
            src={user.pfpUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="-mt-[44px] h-[88px] w-[88px] rounded-full border-4 border-white object-cover sm:-mt-[67px] sm:h-[133px] sm:w-[133px]"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              aria-label="Money"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#cfd9de] hover:bg-x-hover"
            >
              <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
                <path d="M12 3.4v2.1m0 13.1v2.1" />
                <path d="M16.2 8.2c-.55-1.55-2.2-2.4-4.2-2.4-2.15 0-3.9 1.1-3.9 2.9 0 3.9 8.1 2.1 8.1 6 0 1.85-1.8 2.9-4.2 2.9-2.2 0-3.85-1-4.35-2.6" />
              </svg>
            </button>
            {isSelf ? (
              <button
                data-testid="edit-profile"
                onClick={() => setEditing(true)}
                className="h-9 rounded-full border border-[#cfd9de] px-4 text-[15px] font-bold hover:bg-x-hover"
              >
                Edit profile
              </button>
            ) : network ? (
              // FC-READ: following a live Farcaster account is a network write this preview does not make — say so,
              // rather than render the inert Follow the seed profiles have
              <button
                type="button"
                data-testid="follow-button"
                data-live="true"
                aria-disabled="true"
                title={networkReadOnlySentence()}
                onClick={() => toast(networkReadOnlySentence())}
                className="h-9 cursor-not-allowed rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white opacity-50"
              >
                Follow
              </button>
            ) : live && user.fid > 0 ? (
              <FarcasterFollowButton fid={user.fid} username={user.username} large />
            ) : (
              <button className="h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover">
                Follow
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <p className="flex items-center text-xl font-black leading-6">
            {user.displayName}
            {user.verified && <VerifiedBadge size={20} className="ml-1" />}
            <TierBadge tier={tier} />
          </p>
          <p className="text-[15px] leading-5 text-x-sec">@{user.username}</p>
          {/* FC-READ (review, privacy-safety-4): a live Farcaster account says so on its own header */}
          {network && <NetworkMarker className="mt-1" />}
        </div>
        {user.bio && <p className="mt-3 text-[15px] leading-5">{user.bio}</p>}
        {user.joined && (
          <p className="mt-3 flex items-center text-[15px] leading-5 text-x-sec">
            <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor" className="mr-1">
              <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6zm0 6h2v-2H7v2zm0 4h2v-2H7v2zm4-4h2v-2h-2v2zm0 4h2v-2h-2v2zm4-4h2v-2h-2v2z" />
            </svg>
            Joined {user.joined}
            <span className="ml-1">›</span>
          </p>
        )}
        <div className="mt-3 flex gap-5 text-[14px] leading-4">
          <span className="hover:underline">
            <span className="font-bold">{formatFull(user.followingCount)}</span>
            <span className="text-x-sec"> Following</span>
          </span>
          <span className="hover:underline">
            <span className="font-bold">{formatFull(user.followerCount)}</span>
            <span className="text-x-sec"> Followers</span>
          </span>
        </div>
      </div>
      {editing && <EditProfileModal user={user} onClose={() => setEditing(false)} />}
    </div>
  );
}

import { ChevronDown } from "./icons";

export function ProfileTabs({ active = "Posts" }: { active?: string }) {
  const tabs = ["Posts", "Replies", "Reposts", "Media", "Articles"];
  return (
    <div className="flex border-b border-x-border">
      {tabs.map((tab) => (
        <button
          key={tab}
          className="flex h-[53px] flex-1 items-center justify-center px-2 transition-colors hover:bg-x-hover"
        >
          <span
            className={`relative flex h-full items-center text-[15px] ${
              tab === active ? "font-bold text-x-text" : "font-medium text-x-sec"
            }`}
          >
            {tab}
            {tab === "Posts" && <ChevronDown size={16} className="ml-0.5" />}
            {tab === active && (
              <span className="absolute bottom-0 left-0 right-0 h-1 rounded-full bg-x-blue" />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
