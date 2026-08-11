// PresetsDialog.tsx — a read-only window onto the loaded presets.json:
// beer styles, barcodes, saved color swatches, and the one render-settings
// set. Editing stays where it always was (preset bars, the Settings layer);
// this exists so the library can be reviewed without exporting the file.
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Presets } from "@/presets";

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

const EMPTY = <p className="text-xs text-muted-foreground">None saved.</p>;

export function PresetsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: Presets;
}) {
  const p = props.presets;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[80svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Presets</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="Beer styles">
            {p.styles.length === 0 ? EMPTY : (
              <ul className="flex flex-wrap gap-1">
                {p.styles.map((s) => (
                  <li key={s} className="rounded border border-border px-1.5 py-0.5 text-xs">{s}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Barcodes">
            {p.barcodes.length === 0 ? EMPTY : (
              <ul className="space-y-0.5">
                {p.barcodes.map((b) => (
                  <li key={b.upc} className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono">{b.upc}</span>
                    {b.name && <span className="text-muted-foreground">{b.name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Colors">
            {p.colors.length === 0 ? EMPTY : (
              <ul className="flex flex-wrap gap-1">
                {p.colors.map((c) => (
                  <li key={c} title={c} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                    <span className="inline-block size-3 rounded-sm border border-foreground/20" style={{ backgroundColor: c }} />
                    <span className="font-mono">{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Render settings">
            {/* The stored form, verbatim — the same numbers presets.json
                holds. The Settings layer shows them in inches. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">Corner radius</dt>
              <dd className="tabular-nums">{p.render.cornerRadius.toFixed(2)}% of short side</dd>
              <dt className="text-muted-foreground">Edge softness</dt>
              <dd className="tabular-nums">{p.render.edgeSoftness.toFixed(2)}% of width</dd>
              <dt className="text-muted-foreground">Resolution</dt>
              <dd className="tabular-nums">{p.render.dpi} dpi</dd>
              <dt className="text-muted-foreground">Bleed</dt>
              <dd className="tabular-nums">{p.render.bleedIn}&quot; per side</dd>
            </dl>
          </Section>
          {/* No view-toggles section: those moved to localStorage (see App)
              — they are per-operator UI state, not library content. */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
