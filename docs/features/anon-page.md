---
pageClass: eli5
---

# The anon page: post on Farcaster with no name on it

<!-- PUBLIC GO-LIVE (2026-10-17): the consumer page for the native anon page (/anon) and its Farcaster Mini App. The
     owner asked for an anoncast-style door that Farcaster people can use without the rest of Totem, with its own page
     and a click-through to the Totem client. The words in quotes are the page's own (app/anon/AnonApp.tsx,
     components/anon/*, lib/miniapp/manifest.ts); the mechanism is docs/mechanism/anon-page.md. -->

A page of its own for Farcaster people who want to post anonymously and skip the rest of Totem. You sign in with
Farcaster to join the crowd, write a post, and it goes out on Farcaster from one shared account, @anon, with no name on
it. It also opens inside the Farcaster app as a Mini App called "Anon Wire", and a button takes you through to the
full Totem app when you want personas and rings.

::: warning Status: built, test data only, not deployed yet
The anon page is built and tested against stand-ins (a stand-in Farcaster sign-in, a stand-in for Neynar and a
throwaway Totem server on the test machine), and is part of the go-live build, which is not deployed yet. Nobody has
used it on a deployed site, and nothing it sends has reached Farcaster. Its posts reach Farcaster only after the owner
switches the public @anon on; until then the live site says "Anonymous posting isn't switched on for this site yet, so
nothing can be posted anonymously right now." (a test preview without live mode keeps its posts inside, marked
"Preview only · not on Farcaster"). Inside the Farcaster app it opens only once the owner has signed the Mini App for the site's
final web address. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}
:::

## At a glance

<ol class="flow">
  <li><strong>Open the page</strong>On the site at /anon, or inside the Farcaster app as the Mini App "Anon Wire". Your browser makes a light identity for you on the spot; no persona is needed</li>
  <li class="flow__us"><strong>Sign in with Farcaster</strong>Scan a QR code, tap through on a phone, or approve inside the Farcaster app. That is how you join the crowd; your posts do not carry it</li>
  <li class="flow__us"><strong>Wait for your window</strong>New members are let in every 6 hours, and posting opens once 50 people have joined</li>
  <li><strong>Write and post</strong>Your browser proves you are one of the crowd, and the post goes out from @anon at the next posting slot</li>
  <li><strong>Open Totem</strong>"Want personas and rings?" The button takes you to the full app, still signed in</li>
</ol>
<p class="flow__note">The same caps, filter, Report button and terms apply here as to a persona's post in Totem.</p>

## The obvious questions

### Who sees what?

The page says it in its own words: "Everyone on Farcaster sees the post, from @anon, with no name on it." Signing in
with Farcaster lets you into the crowd and "never goes on your posts". Neynar, the service that carries posts to
Farcaster, and the people who run Totem see the words and the hour each post went out, and Totem's server also sees the
internet address a post was sent from, while no outside relay is set up. Your sign-in, your posts and your reports all
reach Totem from your internet address, so the people who run Totem could match them by that address; posting from a
different network than the one you signed in on avoids that. From the proof alone, who in the crowd sent a post is what
stays hidden, as long as the crowd is big. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Why do I have to sign in with Farcaster to post anonymously?

So that one Farcaster account is one member of the crowd. Without it, anyone could make a thousand browser identities
and look like a thousand people. The sign-in is checked by your browser and by the Totem server against the
blockchain Farcaster accounts live on, and the server keeps which Farcaster account joined. From the proof alone it
can't tell which member wrote which post (the address above is the exception, said plainly). {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Why do I wait after I sign in?

Two reasons, and the page says both. New members are let in at the start of the next 6-hour window, and the page says
when, in your own time zone. And posting opens only
once at least 50 people have joined, because a crowd of three hides nobody; until then it says how many have joined:
"12 of 50 people have joined. Posting opens at 50." Before its first check it says "Checking how many people have
joined…", and when the number cannot be read, "How many people have joined couldn't be read just now.", never a guess.
While anonymous posting is not switched on for the site at all (before the owner turns the public @anon on), it says
that instead of any count: "Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously
right now."
{cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### What happens when I press Post?

On the live site the page says "Sent to @anon. It appears on Farcaster within about N minutes, at a random moment, so its
time doesn't point to you." (on a test preview: "Posted as @anon in this preview's anonymous feed. Nothing went to
Farcaster."). Your browser
makes the proof in a background worker, sends it over its own anonymous channel, and the Totem server posts it from
@anon at a random moment in the next slot, mixed with other people's posts. Before that, a filter refuses the obvious:
slurs, phone numbers, email and street addresses, and scam links. A refused post costs you nothing and says why.
{cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Can I share a post?

Yes: Share sits on every post in the feed under the composer, and on your own post once it is out. The page warns you
first: "Sharing posts this from your own Farcaster account.
If you share a post you just wrote, people may guess it was you." {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

### What if a post is abusive?

Press Report on it and pick a reason. The report carries no name or account (it reaches Totem from your internet address, like your posts), and nothing about you is kept with it. The owner works the takedown queue: a
removed post is deleted from Farcaster through the @anon account, hidden in Totem, and its record kept. A post someone
already copied cannot be unseen. The rules are on the terms page, linked at the top of the page.
{cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### What does "Open Totem" do?

On the site, it takes you to the guided start of the full app in the same tab, so your identity and your sign-in come
along: "You stay signed in: Totem picks up where this page left off." Inside the Farcaster app, Totem opens in your
browser instead, which keeps its storage separately: "Totem opens in your browser, where you sign in again: what you did
here stays inside Farcaster." {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

### Will the Farcaster app show these posts?

Probably, but not for certain. The page says it: "Farcaster's main app has a new owner and new rules, and it may hide or
label @anon. The posts still exist on Farcaster and show here." {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Does it cost anything?

No. There is no wallet and no payment. The first visit downloads about 5 MB, so the page can take a moment to start.

## What this does not protect

- **Your writing style.** "How you write is yours to watch: a style people know can give you away."
- **Your internet address, from Totem's server.** No outside relay is set up yet, so the server sees where each post was sent from. From the proof alone it cannot tell which member of the crowd sent it, but your sign-in, your posts and your reports all come from your address, so posting from a different network than the one you signed in on avoids that. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **Neynar.** It carries every post to Farcaster, so it reads every post's words and time. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}
- **A small crowd.** Until many people have joined, a post hides among few. Posting stays closed below 50.

## Where it lives in the code

`app/anon/page.tsx` and `app/anon/AnonApp.tsx` (the page), `components/anon/*` (the composer, the feed, the explainer,
Share and Open Totem), `app/anon/p/[castHash]/page.tsx` (one post's share page), `lib/miniapp/manifest.ts` and
`app/.well-known/farcaster.json/route.ts` (the Mini App), and the relay underneath it, [The anon relay](/mechanism/anon-relay).
How it works: [The anon page and the Mini App](/mechanism/anon-page). Anonymous posts from the full app: [Anonymous posts](/features/anon-posting).
