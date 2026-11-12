import { NextRequest, NextResponse } from "next/server";
// THE INFOFI ROUTE — one route, action-switched (judgment call, logged in
// REPORT-B: four thin features over one ledger read better as one surface
// than as four near-identical route files).
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { marketClock } from "@/lib/adapters/mock/clock";
import { personaById } from "@/lib/adapters/mock/store";
import {
  balanceOf,
  conservationTotal,
  getEscrow,
  heldTotal,
} from "@/lib/market/escrow";
import {
  awardPledge,
  classify,
  closeEpoch,
  createPledge,
  dmPriceFor,
  epochFor,
  inboxFor,
  qualifyingRepliers,
  readPricesFor,
  recordDwell,
  replyDm,
  requestRead,
  sendDm,
  setDmPrice,
  setReadPrices,
  sweepDms,
  sweepPledges,
  TIP_GATED_CHANNEL,
  tipToCast,
} from "@/lib/market/infofi";
import { state } from "@/lib/adapters/mock/store";

export const dynamic = "force-dynamic";

const handleOf = (id: string) => personaById.get(id)?.handle ?? id;

export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const surface = req.nextUrl.searchParams.get("surface") ?? "inbox";
  try {
    if (surface === "inbox") {
      const inbox = await inboxFor(personaId);
      return NextResponse.json({
        inbox: inbox.map((r) => ({ ...r, fromHandle: handleOf(r.fromPersona) })),
        now: marketClock.now(),
      });
    }
    if (surface === "prices") {
      const target = req.nextUrl.searchParams.get("personaId") ?? personaId;
      return NextResponse.json({
        readPrices: readPricesFor(target),
        dmPrice: dmPriceFor(target),
        // what THIS viewer would pay to reach the target
        yourClass: target === personaId ? null : classify(personaId, target),
      });
    }
    if (surface === "balance") {
      return NextResponse.json({ personaId, balance: balanceOf(personaId) });
    }
    if (surface === "dms") {
      const dms = [...state().dmRequests.values()].filter(
        (d) => d.toPersona === personaId || d.fromPersona === personaId
      );
      return NextResponse.json({ dms, now: marketClock.now() });
    }
    if (surface === "pledges") {
      const castHash = req.nextUrl.searchParams.get("castHash");
      const pledges = [...state().pledges.values()].filter(
        (p) => !castHash || p.castHash === castHash
      );
      return NextResponse.json({
        pledges,
        qualifying: castHash ? await qualifyingRepliers(castHash) : [],
        now: marketClock.now(),
      });
    }
    if (surface === "epoch") {
      const channelId = req.nextUrl.searchParams.get("channelId") ?? TIP_GATED_CHANNEL;
      const epoch = state().tipEpochs.get(channelId) ?? null;
      return NextResponse.json({ epoch, now: marketClock.now() });
    }
    if (surface === "escrow") {
      const id = req.nextUrl.searchParams.get("id");
      return NextResponse.json({ escrow: id ? getEscrow(id) : null });
    }
    if (surface === "ledger") {
      // full-ledger audit for the safety suite: every escrow with its status,
      // every balance. Test-facing; the product reads narrower surfaces.
      return NextResponse.json({
        escrows: [...state().escrows.values()],
        balances: Object.fromEntries(state().balances),
      });
    }
    if (surface === "conservation") {
      // the money-invariant probe: balances + held must be constant
      return NextResponse.json({
        conservationTotal: conservationTotal(),
        heldTotal: heldTotal(),
        accounts: state().balances.size,
      });
    }
    return NextResponse.json({ error: "unknown surface" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const personaId = activeSeedPersonaId();
  try {
    switch (body.action) {
      // ---- request-priced reads ----
      case "setReadPrices":
        await setReadPrices(personaId, body.prices);
        return NextResponse.json({ readPrices: readPricesFor(personaId) });
      case "requestRead": {
        const r = await requestRead({
          fromPersona: personaId,
          toPersona: body.toPersona,
          castHash: body.castHash,
        });
        return NextResponse.json({ request: r, balance: balanceOf(personaId) });
      }
      case "recordDwell": {
        const r = await recordDwell(body.requestId, Number(body.dwellMs ?? 0));
        return NextResponse.json({ request: r });
      }

      // ---- pay-to-DM ----
      case "setDmPrice":
        await setDmPrice(personaId, Number(body.price));
        return NextResponse.json({ dmPrice: dmPriceFor(personaId) });
      case "sendDm": {
        const dm = await sendDm({
          fromPersona: personaId,
          toPersona: body.toPersona,
          text: String(body.text ?? ""),
        });
        return NextResponse.json({ dm, balance: balanceOf(personaId) });
      }
      case "replyDm": {
        const dm = await replyDm(body.dmId);
        return NextResponse.json({ dm });
      }
      case "sweepDms": {
        const slashed = await sweepDms();
        return NextResponse.json({ slashed });
      }

      // ---- pledge-to-action ----
      case "createPledge": {
        const pledge = await createPledge({
          fromPersona: personaId,
          castHash: body.castHash,
          amount: Number(body.amount),
        });
        return NextResponse.json({ pledge, balance: balanceOf(personaId) });
      }
      case "awardPledge": {
        const pledge = await awardPledge(body.pledgeId, body.winnerPersonaId);
        return NextResponse.json({ pledge });
      }
      case "sweepPledges": {
        const drawn = await sweepPledges();
        return NextResponse.json({ drawn });
      }

      // ---- tip-gated channels ----
      case "tipToCast": {
        const epoch = await tipToCast({
          channelId: body.channelId ?? TIP_GATED_CHANNEL,
          authorPersonaId: personaId,
          castHash: body.castHash,
        });
        return NextResponse.json({ epoch, balance: balanceOf(personaId) });
      }
      case "openEpoch": {
        const epoch = epochFor(body.channelId ?? TIP_GATED_CHANNEL);
        return NextResponse.json({ epoch });
      }
      case "closeEpoch": {
        const result = await closeEpoch(body.channelId ?? TIP_GATED_CHANNEL);
        return NextResponse.json(result);
      }

      // ---- the controllable clock, same contract as /api/market/intent ----
      case "advanceClock":
        marketClock.advance(Number(body.ms ?? 0));
        return NextResponse.json({ now: marketClock.now() });
      // ABSOLUTE jump: sets marketClock.now() to an exact epoch ms,
      // independent of real wall time and any drift a prior suite left
      // behind. UX Gate 1's activation-rule test needs a KNOWN UTC hour,
      // not "whatever hour it happens to be plus some relative offset".
      case "jumpToClock":
        marketClock.jumpTo(Number(body.ms));
        return NextResponse.json({ now: marketClock.now() });

      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    const err = e as AdapterError;
    const msg = err.message ?? "error";
    // domain refusals are 409s (the caller did something the rules refuse);
    // adapter failures are 503s (could not do it right now)
    const domain =
      /already|unknown|window|insufficient|free for|not tip-gated|no open epoch|still open|conserve|requires/.test(
        msg
      );
    return NextResponse.json({ error: msg }, { status: domain ? 409 : 503 });
  }
}
