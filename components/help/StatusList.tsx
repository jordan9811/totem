// "What works today": every capability in lib/status/features.ts, grouped by its status on the site the reader is
// on, in legend order. Nothing on this list is written here; a row that is not in the status file cannot render,
// and a row in the file cannot be left out (scripts/accept-help.mjs compares the two). The other site's status sits
// beside each row, so a reader on the public site is never told something works because it works on the owner's
// private service.
import { FEATURES, LEGEND, groupByStatus, surfaceOf, type SurfaceId } from "@/lib/status/features";
import { StatusChip } from "./StatusChip";

export function StatusList({ surface, rig }: { surface: SurfaceId; rig: boolean }) {
  const here = surfaceOf(surface);
  const otherId: SurfaceId = surface === "public" ? "owner" : "public";
  const other = surfaceOf(otherId);
  const groups = groupByStatus(surface);
  const where = rig ? "on the owner's private service, which this development copy imitates with test data" : "on the " + here.label.toLowerCase();
  return (
    <section id="today" aria-labelledby="today-h" data-testid="help-status" data-surface={surface} className="scroll-mt-16">
      <h2 id="today-h" className="mt-12 text-[23px] font-extrabold leading-7">
        What works today
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-x-sec">
        Grouped by how real each part is {where}. Every line comes from one status list, the same one the docs use, and
        nothing on it is called live until it has run on the site it describes. {FEATURES.length} parts in all.
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-2 rounded-2xl border border-x-border p-4" data-testid="status-legend">
        {LEGEND.map((l) => (
          <div key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3" data-testid="status-legend-entry" data-status={l.id}>
            <dt className="shrink-0 sm:w-[170px]">
              <StatusChip status={l.id} testid="legend-chip" />
            </dt>
            <dd className="min-w-0 text-[14px] leading-5 text-x-sec">{l.meaning}</dd>
          </div>
        ))}
      </dl>

      {groups.map((g) => (
        <div key={g.legend.id} className="mt-8" data-testid="status-group" data-status={g.legend.id}>
          <h3 className="flex items-center gap-2 text-[17px] font-bold leading-6">
            <StatusChip status={g.legend.id} testid="group-chip" />
            <span className="text-x-sec text-[15px] font-normal">
              {g.features.length} {g.features.length === 1 ? "part" : "parts"}
            </span>
          </h3>
          <ul className="mt-2 divide-y divide-x-border rounded-2xl border border-x-border">
            {g.features.map((f) => {
              const mine = { status: f.status[surface], note: f.notes[surface] };
              const theirs = { status: f.status[otherId], note: f.notes[otherId] };
              return (
                <li key={f.id} className="p-4" data-testid="status-row" data-feature={f.id} data-surface={surface} data-status={mine.status}>
                  <p className="text-[16px] font-bold leading-5" data-testid="status-name">
                    {f.name}
                  </p>
                  <p className="mt-1 text-[15px] leading-5 text-x-sec">{f.description}</p>
                  <dl className="mt-3 space-y-2 text-[14px] leading-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 font-bold sm:w-[170px]">{rig ? here.label : "Here"}</dt>
                      <dd className="min-w-0">
                        <StatusChip status={mine.status} surface={surface} />{" "}
                        <span data-testid="status-note" className="ml-1">
                          {mine.note}
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 font-bold sm:w-[170px]">{other.label}</dt>
                      <dd className="min-w-0">
                        <StatusChip status={theirs.status} surface={otherId} testid="status-chip-other" />{" "}
                        <span className="ml-1 text-x-sec">{theirs.note}</span>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 font-bold sm:w-[170px]">Still missing</dt>
                      <dd className="min-w-0 text-x-sec">{f.missing}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
