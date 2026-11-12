---
aside: false
---

# The map, in one picture

A reminder of what lives where. Three places: **X**, **Totem** (this app) and **Farcaster** (the open network, renamed "Network State Protocol" by its new owner in October 2026).

<div class="lmap">
  <div class="lmap__col lmap__x">
    <div class="lmap__head">X</div>
    <div class="lmap__box">Your old X account<span>you bring its archive (a ZIP) into Totem</span></div>
    <div class="lmap__box">@totem on X<span>posts the anon posts people send it, after a moderator says yes</span></div>
    <div class="lmap__box">DM @totem a tweet<span>it lands in your reading list in Totem</span></div>
  </div>
  <div class="lmap__arrows" aria-hidden="true"><span>archive →</span><span>← anon copy</span><span>DM →</span></div>
  <div class="lmap__col lmap__us">
    <div class="lmap__head">Totem</div>
    <div class="lmap__box lmap__strong">Your root<span>you, made by signing in with Farcaster (your verified X comes along) and saved with Face ID. One root, many personas</span></div>
    <div class="lmap__box">Personas<span>your finsta, your alts. Each one posts through @anon until you launch it</span></div>
    <div class="lmap__box">Rings (your Top 16)<span>the people you pick see which personas are you, with a half-and-half picture</span></div>
    <div class="lmap__box">Reach tiers<span>an anon post from a big account gets a head start in For You, without saying whose</span></div>
    <div class="lmap__box">Launch<span>turns a persona into its own Farcaster account and reveals its anon posts as its history</span></div>
  </div>
  <div class="lmap__arrows" aria-hidden="true"><span>persona posts →</span><span>launch →</span><span>← sign in</span><span>← open Totem</span></div>
  <div class="lmap__col lmap__fc">
    <div class="lmap__head">Farcaster</div>
    <div class="lmap__box">@anon<span>one shared account. Persona posts appear here with no name on them</span></div>
    <div class="lmap__box">Launched personas<span>each with its own account, made by Totem, not by your wallet</span></div>
    <div class="lmap__box">Your main account<span>your real, public one. You sign in with it, and Totem shows it as you; once you allow Totem to post as you, the Post box posts as it (built, test data only). It stays apart from your personas</span></div>
    <div class="lmap__box">The anon page<span>for Farcaster people who skip the full app: post as plain @anon from the page or inside the Farcaster app (a Mini App), with a button through to Totem</span></div>
  </div>
</div>

<style>
.lmap { display: grid; grid-template-columns: 1fr auto 1.25fr auto 1fr; gap: 10px; align-items: stretch; margin: 20px 0 8px; }
.lmap__col { border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 10px; background: var(--vp-c-bg-soft); display: flex; flex-direction: column; gap: 8px; }
.lmap__us { border-color: var(--vp-c-brand-1); }
.lmap__head { font-weight: 700; font-size: 15px; text-align: center; padding: 2px 0 4px; }
.lmap__box { background: var(--vp-c-bg); border: 1px solid var(--vp-c-divider); border-radius: 8px; padding: 8px 10px; font-weight: 600; font-size: 14px; line-height: 1.35; }
.lmap__box span { display: block; font-weight: 400; font-size: 13px; color: var(--vp-c-text-2); margin-top: 2px; }
.lmap__strong { border-color: var(--vp-c-brand-1); }
.lmap__arrows { display: flex; flex-direction: column; justify-content: space-around; font-size: 12px; color: var(--vp-c-text-2); white-space: nowrap; }
@media (max-width: 760px) {
  .lmap { grid-template-columns: 1fr; }
  .lmap__arrows { flex-direction: row; justify-content: center; gap: 12px; white-space: normal; text-align: center; }
}
</style>

## Who sees what, in one line each

| | Sees |
|---|---|
| **Everyone on Farcaster** | @anon's posts, launched persona accounts and your main account, as separate accounts |
| **People using the anon page** | Plain @anon posts, the same ones everyone on Farcaster sees |
| **People in your rings** | Which personas are you, at the depth you chose |
| **Everyone else in Totem** | Each persona on its own, or plain @anon |
| **X** | What @totem posts there |

The full reasons and limits are in [Privacy in plain words](/start/privacy-in-plain-words) and [Who sees what](/start/who-sees-what).

## What works today

Every piece on this map is built. Most of it has only run on test data. The go-live build (2026-10-17) makes the public site the product: you start at the guided sign-in, persona posts go to Farcaster through the public @anon, and the anon page opens inside Farcaster. It is built and tested against stand-ins; each piece that touches Farcaster for real waits for the owner to switch it on and see it work. @totem on X and launching a persona into its own account stay on test data for now. See [the board](/roadmap/) for the status of each piece, and [The big picture](/start/big-picture) for the long version of this map.

## The new owner of Farcaster

Network School bought Farcaster from Neynar in October 2026. Its main app now asks people to accept a set of rules, and plans human checks and AI moderation. Those rules are for its app; Totem is a separate app on the same open network, so your Totem accounts and posts keep working. What may change: how the main app shows anonymous posts, and the outside services Totem uses to talk to the network.
