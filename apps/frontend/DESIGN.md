# Clinical Portal Design System

The Care Manager, Nurse, and Caregiver portals use one shared clinical interface system. The source
of truth is `src/components/portal/views/clinical/clinical-ui.tsx`; legacy
boards inherit the same system through the scoped `.clinical-portal-content`
rules in `src/app/globals.css`.

## Principles

- Optimize for interrupted, time-sensitive clinical work: clear hierarchy,
  44px minimum controls, strong focus visibility, and restrained density.
- Use the Inter type family throughout. Page titles are 24–30px, section titles
  18px, body text 14–15px, and metadata 11–12px.
- Use `--clinical-ground`, `--clinical-surface`, and
  `--clinical-surface-2` for page, card, and raised/hover surfaces.
- Indigo (`--clinical-panel`) is the only primary action color. Rose is danger,
  amber is caution, and emerald is successful/completed. Status always includes
  an icon or text label; color never carries meaning alone.
- Cards use a 14px radius and either a border or restrained soft depth. Controls
  use a 12px radius. Pills are reserved for compact statuses.

## Shared components

- `ClinicalHeader`: page title, explanatory subtitle, and one action region.
- `ClinicalCard`: standard content boundary with optional semantic top rule.
- `ClinicalButton`: primary, secondary, ghost, and danger actions.
- `StatusPill`: labeled semantic state.
- `SearchInput` and `controlClass`: consistent form controls.
- `StatCard`: compact operational measurement.
- `DataState`: loading, empty, error, retry, and populated states.
- `ClinicalModal`: accessible modal/sheet behavior and geometry.

New clinical operations UI should use these components directly. The compatibility
CSS exists for older boards and should not be used as a reason to add new
one-off card, button, field, table, or state patterns.
