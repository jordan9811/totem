"use client";
// THE READS INBOX — where request-priced reads land. The recipient dwells on
// a request to honor it; the settle fires at the dwell threshold. Below the
// fold: the price card editor (per-entity-class pricing).
import { useCallback, useEffect, useRef, useState } from "react";
import { readApiJson } from "@/lib/client/useApiJson";
import { RetryButton } from "@/components/spaces/IslandStatus";

interface InboxItem {
  id: string;
  fromHandle: string;
  castHash: string;
  price: number;
  entityClass: string;
  status: string;
}

type Prices = { mutuals: number; extended: number; randoms: number; businesses: number };

const CLASS_LABEL: Record<string, string> = {
  mutuals: "Mutual",
  extended: "Extended network",
  randoms: "Outside your graph",
  businesses: "Business",
};

export function ReadsInbox() {
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dwellPct, setDwellPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      // PROD-LIVE (D-CU-0-4) — NEVER FAIL OPEN: a refused read (a 503 from the route, or from the browser device that
      // answers it on a public deployment) is an error, not an empty inbox. These used to parse the error body as if
      // it were the answer, and render "No pending read requests".
      const [inboxRes, priceRes, balRes] = await Promise.all([
        readApiJson<{ inbox?: InboxItem[] }>("/api/market/infofi?surface=inbox"),
        readApiJson<{ readPrices?: Prices }>("/api/market/infofi?surface=prices"),
        readApiJson<{ balance?: number }>("/api/market/infofi?surface=balance"),
      ]);
      setInbox(inboxRes.inbox ?? []);
      setPrices(priceRes.readPrices ?? null);
      setBalance(balRes.balance ?? null);
      setLoaded(true);
      setError(null);
    } catch {
      setError("Couldn't load the inbox. It will retry on the next action.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // dwell: opening a request starts the honor timer; at 100% the read
  // settles. Closing early cancels — nothing is charged to rep until the
  // threshold.
  const openRequest = (id: string) => {
    if (timer.current) clearInterval(timer.current);
    setOpenId(id);
    setDwellPct(0);
    const startedAt = Date.now();
    timer.current = setInterval(async () => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(100, Math.round((elapsed / 8000) * 100));
      setDwellPct(pct);
      if (pct >= 100 && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
        await fetch("/api/market/infofi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recordDwell", requestId: id, dwellMs: elapsed }),
        });
        setOpenId(null);
        refresh();
      }
    }, 250);
  };

  const closeRequest = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setOpenId(null);
    setDwellPct(0);
  };

  const savePrices = async (next: Prices) => {
    setPrices(next);
    await fetch("/api/market/infofi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setReadPrices", prices: next }),
    });
  };

  return (
    <div data-testid="reads-inbox">
      <div className="border-b border-x-border px-4 py-3">
        <p className="text-[13px] leading-4 text-x-sec" data-testid="reads-rep-note">
          Reads are honored on rep, not proven. Dwelling past the bar settles the
          request; there is no read receipt a client could fake, only a reputation
          for honoring what you accept.
        </p>
        {balance !== null && (
          <p className="mt-1 text-[13px] text-x-sec" data-testid="reads-balance">
            Balance: {balance.toFixed(2)}
          </p>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center px-4 py-3">
          <p className="text-[15px] text-x-sec">{error}</p>
          <RetryButton onRetry={refresh} testid="reads-retry" />
        </div>
      )}

      {loaded && inbox.length === 0 && !error && (
        <p className="px-4 py-6 text-[15px] text-x-sec" data-testid="reads-empty">
          No pending read requests. Unread requests refund automatically when
          their window closes.
        </p>
      )}

      {inbox.map((item) => (
        <div key={item.id} data-testid="read-request" data-request={item.id} className="border-b border-x-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-bold leading-5">
                @{item.fromHandle}
                <span className="ml-2 rounded-full border border-[#cfd9de] px-2 py-0.5 text-[12px] font-normal text-x-sec">
                  {CLASS_LABEL[item.entityClass] ?? item.entityClass}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-x-sec">
                paid <span data-testid="read-price">{item.price}</span> for a read of {item.castHash.slice(0, 12)}…
              </p>
            </div>
            {openId === item.id ? (
              <button onClick={closeRequest} className="h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold">
                Close
              </button>
            ) : (
              <button
                data-testid="read-open"
                onClick={() => openRequest(item.id)}
                className="h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white"
              >
                Read
              </button>
            )}
          </div>
          {openId === item.id && (
            <div className="mt-2" data-testid="dwell-bar">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#eff3f4]">
                <div className="h-full bg-x-blue transition-all" style={{ width: `${dwellPct}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-x-sec">Honoring the read… {dwellPct}%</p>
            </div>
          )}
        </div>
      ))}

      {prices && (
        <div className="px-4 py-4" data-testid="read-prices">
          <h3 className="text-[17px] font-extrabold">Your read prices</h3>
          <p className="mt-0.5 text-[13px] text-x-sec">
            What it costs each class of account to put a post in front of you.
            Zero means free — no request needed.
          </p>
          {(Object.keys(CLASS_LABEL) as (keyof Prices)[]).map((k) => (
            <label key={k} className="mt-2 flex items-center justify-between text-[15px]">
              <span>{CLASS_LABEL[k]}</span>
              <input
                data-testid={`price-${k}`}
                type="number"
                min={0}
                value={prices[k]}
                onChange={(e) => savePrices({ ...prices, [k]: Math.max(0, Number(e.target.value)) })}
                className="w-24 rounded-md border border-[#cfd9de] px-2 py-1 text-right"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
