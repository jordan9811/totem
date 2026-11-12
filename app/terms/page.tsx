// PUBLIC GO-LIVE (the relay track) — /terms: the terms for anonymous posting and the takedown policy, in plain words.
// DRAFT: the owner reads and approves it before strangers post publicly (notes/runbooks/GO-LIVE-TODAY.md, the /terms review step);
// scripts/owner/arm-public-anon.ps1 refuses to arm until this page answers 200.
//
// Outside app/(main) for the reason /help is (app/help/page.tsx): a static page, so reading the terms mounts no device and
// mints no identity. It reads nothing but the environment's shape; on the owner service the owner cookie gates it like
// every page. Linked from the composer (components/zk/AnonTermsLink.tsx) and from the native /anon page.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms for anonymous posts",
  description: "What you can post anonymously through Totem, what happens when a post is reported, and what is kept.",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-[20px] font-bold leading-6">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-6">{children}</div>
    </section>
  );
}

export default async function Terms() {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  return (
    <main data-testid="terms" className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-6 text-[#0f1419]">
      <p className="mb-4">
        <Link href="/home" className="text-[15px] text-[#1d9bf0] hover:underline">
          ← Back to Totem
        </Link>
      </p>
      <h1 className="text-[28px] font-black leading-8">Terms for anonymous posts</h1>
      <p data-testid="terms-draft" className="mt-3 rounded-xl border border-dashed border-[#cfd9de] p-3 text-[13px] leading-5 text-[#536471]">
        Draft — the owner approves. These words are a plain-language draft for review before anonymous posting opens to everyone. They are not legal advice.
      </p>

      <Section id="what" title="What anonymous posting is">
        <p>When you post anonymously, your post goes to Farcaster from one shared account, @anon, that many people post from. It shows on Farcaster and in Totem under @anon. It does not name you or your personas.</p>
        <p>Your device proves that the post comes from someone in the crowd of people who signed in with Farcaster, without saying who. You keep a secret on your device that lets you prove later that a post was yours, if you ever choose to. Nobody else can do that for you.</p>
        <p>Each person can post up to 4 times every 6 hours, and the whole site posts at most a set number a day. A post appears within about an hour and a quarter, at a random moment, so its time doesn&rsquo;t point to you.</p>
      </Section>

      <Section id="rules" title="What isn't allowed">
        <ul className="list-disc space-y-1 pl-6">
          <li>Anything illegal where you or the people you write about live, including sexual content involving anyone under 18.</li>
          <li>Threats, incitement to violence, or encouraging self-harm.</li>
          <li>Harassment or bullying, including posts aimed at a private person.</li>
          <li>Slurs and hate aimed at people for who they are.</li>
          <li>Anyone&rsquo;s private details: phone numbers, email or street addresses, documents, or photos shared without consent.</li>
          <li>Scams, phishing, fake giveaways, and spam.</li>
          <li>Pretending to be a real person or organization to mislead people.</li>
        </ul>
      </Section>

      <Section id="filter" title="The automatic filter">
        <p>Before a post is sent, an automatic check refuses the obvious: slurs, phone numbers, email and street addresses, and links to known scam sites. It tells you which rule it hit, and your words stay in the box. The same check runs again on our server before anything is posted.</p>
        <p>The filter is deliberately cautious: it catches only the obvious. Everything else is up to the people who read the posts and report them.</p>
      </Section>

      <Section id="report" title="Reporting a post">
        <p>Every anonymous post in Totem, and on the anonymous page, has a Report button. You pick a reason from a short list. The report carries no name or account, but it reaches Totem from your internet address: we keep the post, the reason and the hour, and nothing about the person who reported it.</p>
      </Section>

      <Section id="takedown" title="Takedowns">
        <p>The site&rsquo;s moderators read the reported posts. A moderator can keep a post (the reports are dismissed) or remove it.</p>
        <p>A removed post is hidden everywhere in Totem right away and deleted from Farcaster through the @anon account. We try the deletion a few times; if Farcaster doesn&rsquo;t confirm it, the moderator is told so. Copies that other apps or people made before the deletion may still exist elsewhere.</p>
        <p>We keep the record of a removed post, hidden, instead of erasing it, so a takedown can be checked later. A takedown never tells anyone who wrote the post, because we don&rsquo;t know.</p>
        <p data-testid="terms-contact">To ask for a takedown of a post that breaks the law, report it with the closest reason. A contact address for legal requests will be listed here before anonymous posting opens to everyone.</p>
      </Section>

      <Section id="kept" title="What we see and keep">
        <ul className="list-disc space-y-1 pl-6">
          <li>Our server sees the text of each anonymous post and the hour it arrived, and keeps it. It does not learn who wrote it.</li>
          <li>When you join the anonymous crowd, our server learns that your Farcaster account holds one entry in the crowd. It never learns which posts are yours.</li>
          <li>Neynar, the service that delivers posts to Farcaster today, sees every anonymous post&rsquo;s text and time.</li>
          <li>Until a separate relay service is set up, our server can see the network address a post was sent from. The privacy label in the app says so.</li>
        </ul>
      </Section>

      <Section id="changes" title="Changes">
        <p>If these terms change, the new version is posted here with the date. Posting anonymously after a change means you accept it.</p>
      </Section>
    </main>
  );
}
