# Habits App — Project State

_Last updated: 6 September 2026_

## What this is
A personal daily/weekly/monthly habit-tracking app: React Native + TypeScript
+ Expo, local-only storage (AsyncStorage), no backend. Built as a first
iOS app project, developed via Expo Go on a Windows PC with no Mac.

## Environment / setup recap
- Windows PC, no Mac. iPhone as test device via **Expo Go**.
- Project lives at `D:\projects\habits app` — deliberately **outside**
  Dropbox (Dropbox's file-locking caused install errors early on).
- Node.js + VS Code installed. PowerShell execution policy set to
  `RemoteSigned` (was blocking npx scripts by default). Note: the default
  terminal prompt (`D:\projects\habits app>`) is classic **cmd.exe**, not
  PowerShell (`PS D:\...>`) — most commands work in either, but
  PowerShell-specific syntax (`Remove-Item`) needs cmd.exe equivalents
  (`rmdir /s /q`, `del`) if you haven't deliberately opened a PowerShell
  window.
- **Expo SDK 57** (upgraded from SDK 54 in September 2026 — see "SDK 54→57
  upgrade" below). Expo Go on iOS only supports the single latest SDK
  version at any given time and auto-updates via the App Store, which is
  what forced this upgrade; there's no way to pin Expo Go itself to an
  older SDK on iOS.
- New Architecture (`newArchEnabled`) and React 19 were already in place
  going into the SDK 57 upgrade, which significantly de-risked it — those
  are usually the two riskiest parts of a jump like this.
- React Compiler experiment enabled (`experiments.reactCompiler` in
  `app.json`).
- **Always run `npx expo start -c`** — never bare `expo start`, which
  invokes a stale global `expo-cli` install and throws misleading errors.
- Dev loop requires the PC to be on and running `npx expo start` — this
  is a live dev server setup, not an installed standalone app. Getting a
  standalone build (independent of the PC) would require EAS Build +
  a paid Apple Developer account ($99/yr) — not done yet, deliberately
  deferred (re-confirmed as a "later" decision during the SDK upgrade).

## SDK 54 → 57 upgrade (September 2026)
Forced by Expo Go auto-updating past SDK 54 with no way to reinstall an
older Expo Go on iOS. Went straight 54 → 57 in one dependency bump
(`npx expo install expo@^57.0.17 --fix` then `npx expo install --fix`),
deliberately not stopping at 55 or 56 — Expo's own current guidance is to
skip 56 when upgrading from 55-or-earlier, since SDK 55/56 and early 57
builds carry a known Hermes memory regression that specifically affects
apps using `react-native-reanimated`. A side effect: Expo Go on the test
iPhone was already permanently on SDK 57 by the time this happened, so
there was no way to test the project at an intermediate SDK 55/56 state
on-device anyway — verification along the way leaned on `expo-doctor` and
TypeScript rather than the phone, with the real on-device test only
possible once the project itself reached 57.

Issues hit and fixed, in order:
- `expo-doctor` flagged two obsolete `app.json` fields: `newArchEnabled`
  and `android.edgeToEdgeEnabled`. Both were removed — New Architecture
  and edge-to-edge are mandatory/default as of SDK 55, so the flags are
  meaningless now, not a functional change.
- `expo-doctor` flagged `@types/react-native` as installed-but-unneeded
  (React Native ships its own types) — removed via `npm uninstall`.
- **The big one**: as of SDK 56, `expo-router` hard-errors if application
  code imports from `@react-navigation/*` packages directly (it's decoupled
  from React Navigation as a direct dependency). This surfaced as a Metro
  error pointing at generic internal Expo code, not the actual offending
  file — the error message never names which import triggered it. Found
  and fixed two sites, both leftover default-template boilerplate:
  - `app/_layout.tsx` — `ThemeProvider`/`DarkTheme`/`DefaultTheme` were
    imported from `@react-navigation/native`; repointed to
    `expo-router/react-navigation` (same names, same runtime behavior).
  - `components/haptic-tab.tsx` — `BottomTabBarButtonProps` (from
    `@react-navigation/bottom-tabs`) repointed to `expo-router/js-tabs`;
    `PlatformPressable` (from `@react-navigation/elements`) repointed to
    `expo-router/react-navigation`. (Official mapping table:
    `docs.expo.dev/router/migrate/sdk-55-to-56`.)
  - Also removed the now-fully-unused `@react-navigation/bottom-tabs`,
    `@react-navigation/elements`, and `@react-navigation/native` direct
    dependencies from `package.json` once nothing imported them anymore.
  - Note for next time: Expo's own automated codemod for this migration
    (`expo-codemod sdk-56-expo-router-react-navigation-replace`) has a
    known bug that silently misses ~25% of import sites in real projects.
    Fixed this manually by grepping for `@react-navigation` across `app/`,
    `components/`, `hooks/` instead of trusting the codemod.

## File structure (relevant files)
- `app/HabitsContext.tsx` — shared state, storage, and all business logic
  (single source of truth, read by both tabs via `useHabits()`)
- `app/(tabs)/index.tsx` — "Today" screen (renamed "Habits" in-app):
  date-navigable, grouped by time-of-day with dividers, Auto-mode controls
- `app/(tabs)/explore.tsx` — "Manage Habits" screen: add/edit/delete/
  reorder, with category autocomplete
- `app/schedule.tsx` — 28-day Auto-mode projection screen
- `app/_layout.tsx` — wraps the app in `HabitsProvider`
- `components/haptic-tab.tsx` — default-template tab button component;
  touched during the SDK 57 upgrade (see above), otherwise unmodified

## Data model (current — version 4)
```ts
type Habit = {
  id: string;                    // also doubles as a creation timestamp
                                  // (Date.now() for user-added habits) —
                                  // used for category colour ordering AND
                                  // for bounding the debt/urgency lookback
                                  // (see below) so a habit is never
                                  // flagged as neglected for time before
                                  // it existed
  name: string;
  category: string;              // freeform, colour-coded
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  targetCount: number;           // e.g. 3
  targetPeriod: 'day' | 'week' | 'month';
  order: number;                 // manual sort position within timeOfDay group
  pointValue: number;
  completions: Record<string, boolean>; // date string -> done
};
```
Storage is versioned (`{ version, habits }` in AsyncStorage under key
`"habits"`), with a migration function that upgrades any older shape
forward. Any future field additions should follow the same pattern:
add to the `Habit` type, add a default in `migrateHabits`, bump
`CURRENT_VERSION`.

Two other AsyncStorage keys exist alongside habits:
- `habitSettings` — `viewMode`, `hideCompleted`, `sectionScheduleCounts`
  (per-section Auto-mode guide counts, default 3/3/3)
- `habitDaySnapshots` — per-date frozen data: `orderedIds` (neglect
  order), `completedAtSnapshot`, `scheduledIds` (Auto mode's picks),
  `sectionCursors` (swap-cycling position per section). Frozen the first
  time a date is viewed, with an explicit refresh path for `orderedIds`/
  `scheduledIds` (see "Auto mode" below) — everything else genuinely
  never recomputes for a date once set.

## Features built so far
- ✅ Toggle habit done/not-done for a given day; persistent storage
- ✅ Date navigation, retroactive editing of any past day
- ✅ Add / edit / delete / reorder habits; freeform categories with
  autocomplete and creation-order colour-coding
- ✅ Weekly/monthly targets with calendar-aligned periods; due/overdue
  status (`met`/`onTrack`/`dueSoon`/`behind`) shown as a coloured label +
  progress squares
- ✅ Three view modes on the Today screen: **Static** (manual order),
  **Dynamic** (neglect-sorted, debt-aware — see below), **Auto**
  (capacity-limited schedule, debt-aware)
- ✅ **Auto mode scheduling**, substantially reworked this session:
  - Each section (morning/afternoon/evening) fills toward an independently
    adjustable guide count (default 3), with +/− steppers and a capacity
    warning when a section's combined habit demand mathematically exceeds
    its count (`getSectionDemand`)
  - Ranking (`rankCandidates`) is shared by scheduling, swapping, and
    "one more" so they can't disagree with each other
  - **Swap** (⇄) cycles forward through a per-section rotating cursor
    (`sectionCursors`), wrapping around via modulo once every eligible
    habit has been shown — guaranteed to visit everyone eventually,
    never strands a habit, never bounces back to something just declined
  - Habits already completed today are always kept visible in Auto mode,
    even past a section's normal cap
  - Switching into (or re-tapping) Auto or Dynamic mode refreshes that
    day's schedule/order against current logic — needed because a
    day's snapshot is otherwise frozen on first visit and won't
    automatically pick up algorithm changes (see gotchas)
  - 28-day forward projection screen (`/schedule`), always computed fresh,
    simulating best-case completion to preview future scheduling
- ✅ **Persistent urgency / "debt" system**: a habit neglected across
  multiple weeks/months no longer looks fresh just because a new period
  started. Tracks a consecutive-missed-periods streak
  (`getMissedPeriodsStreak`, day-granularity variant `getMissedDaysStreak`
  for daily habits) bounded by the habit's creation date; any nonzero
  streak escalates the habit to `behind` for scheduling/Dynamic-mode
  ranking purposes specifically (not the visible status badge, which
  stays purely local-period — that's deliberately deferred). Streak
  *count* (not raw missed-completions) is the fair comparison unit across
  habits with different target sizes.
- ✅ **Average-rate indicator**: small colour-coded `avg X.X` per habit
  (green if ≥ target, red if below) — actual average completions per
  fully-elapsed period since creation, excluding any partial creation-period
  and the still-in-progress current period.
- ✅ Hide-completed toggle, "add new habit" auto-collapse, animated
  reordering (Reanimated `LinearTransition`)
- ✅ Insights tab: category momentum (radar chart), points/scoring engine
  with period-streak bonuses, trend charts, per-habit heatmaps and
  completion rates

## Notable technical gotchas hit (useful if similar bugs recur)
- **Dropbox + npm / PowerShell execution policy / Expo Go SDK mismatch /
  stale Fast Refresh / FlatList + keyboard swallowing taps / two-stage
  taps racing with blur** — see prior entries, still valid, not repeated
  here for space.
- **Frozen snapshot staleness is a recurring category of bug.** Any time
  the scheduling/ordering *algorithm* changes, dates that already have a
  frozen `daySnapshot` won't reflect the change until something explicitly
  recomputes it — the calendar rolling over to a new date is not enough
  to fix an already-visited date. Fixed by making mode-switching (into
  Auto or Dynamic) always refresh the relevant fields, plus a one-time
  cold-start check for whichever mode the app opens into. A subtler trap
  inside this: a falsy-check like `!existing.scheduledIds` does **not**
  catch an already-present-but-empty array (`![]` is `false` in JS) — use
  an explicit "does this field exist at all" check when backfilling a
  new snapshot field, not a plain truthiness check.
- **Swap "bouncing back" bug**: excluding the currently-scheduled habit
  from a swap's candidate pool makes the pool's composition — and
  therefore what each index means — shift on every swap, which can
  permanently strand some habits depending on group size. Fixed by
  keeping the full ranked pool stable (excluding only *other* slots'
  occupants) and skipping over the current habit post-hoc if the cursor
  lands on it.
- **Debt/urgency units must match.** An early version of the persistent-
  urgency fix subtracted a missed-completions count from a day-denominated
  slack value — barely moved the needle even after months of neglect,
  since the two aren't the same unit. Fixed by using period-*count*
  (habit-agnostic) rather than completions-count (biased by each habit's
  own target size) as the comparable measure.
- **Boundary consistency between related calculations matters.** The
  average-rate calculation and the debt-streak calculation both walk
  periods relative to a habit's creation date, but used to apply that
  boundary inconsistently — the average counted a habit's partial
  creation-period as a real elapsed period (showing a misleading `avg 0`
  for very new habits) while the debt calculation correctly excluded it.
  Two calculations meant to agree on "how much history exists" need the
  exact same boundary rule, not just similar-looking ones.
- **Daily habits need explicit debt handling too.** Local period-status
  math for an undone daily habit is always exactly `dueSoon`, never
  `behind` — there's no multi-day arithmetic to push it further. An
  earlier version of the debt system explicitly excluded daily habits on
  the (wrong) assumption that "each day is its own atomic unit, nothing
  to carry forward" — meaning a daily habit skipped for months looked
  identical to one skipped once yesterday until this was fixed.
- **Expo Go on iOS auto-updates to the latest SDK with no way to pin an
  older version** — a project pinned to an older SDK (as this one was, to
  54) can be broken by Apple App Store updates alone, with no code change
  on this end. Worth remembering next time Expo Go throws an incompatible-
  version error unprompted.

## Deliberately deferred / out of scope so far
- **App-blocker-style features**, **Notifications**, **rolling
  (non-calendar-aligned) periods**, **fixed category list** — see prior
  entries, unchanged, not currently planned.
- **EAS Build / standalone `.ipa`** and a **paid Apple Developer
  account** — re-confirmed as "later" during the SDK upgrade discussion,
  would also remove the Expo-Go-auto-update fragility that caused this
  session's SDK upgrade in the first place.
- **Web support with cross-device sync** and **user-facing color
  picker** — unchanged, still future topics, not yet prioritized.

## Next features to develop (in rough priority order)
1. **"Catch-up mode" — target elasticity for a missed period.** Right now,
   knowing you've clearly missed a period's target (e.g. 0/3 by Saturday
   on a weekly target) is purely demotivating — there's no way to
   "recover" within the app other than accepting the miss. Idea: let a
   shortfall borrow against the next period(s) instead, so falling behind
   doesn't just feel like a dead end. Open questions to design before
   building:
   - Opt-in per habit, a global setting, or automatic (e.g. triggered once
     remaining days can't mathematically cover what's left)?
   - How much borrowing is allowed — cap at one extra period, or let it
     compound across several?
   - How this interacts with the persistent-urgency/debt system built
     this session: does catching up clear the missed-periods streak, or
     does borrowing instead increase the *next* period's effective
     target, leaving the debt concept untouched? These could easily end
     up fighting each other if not designed together.
   - Does a "caught up" period count as genuinely met for scoring/streak
     purposes, or does it just avoid reading as a miss without literally
     becoming one?
   - Worth a distinct visible indicator ("catching up") separate from the
     existing status badge?
2. **Habit "levelling up/down."** Consistently-met habits could level up
   (raise the target, for a points bonus); long-neglected ones could
   level down (lower the target, maybe alongside a bonus, as an
   incentive to re-engage rather than stay demoralized). This turns the
   debt/average-rate systems from purely diagnostic into something
   actionable. Overlaps significantly with the previously-noted "bonus
   points for consistently missed targets" idea below — levelling down
   *is* essentially that idea, expressed as an adjusted target rather
   than a one-off bonus, so these two should be designed as one feature,
   not two. Open questions:
   - Automatic (streak/average-rate crosses some threshold) or
     suggested-with-confirmation?
   - Changing `targetCount` retroactively affects how past periods get
     evaluated, since `countFullPeriodCompletions` compares against
     whatever `habit.targetCount` is *now* — levelling would need either
     an as-of-date target history, or an accepted rule that level changes
     are forward-only and never rewrite already-elapsed periods' met/miss
     status.
   - Does levelling reset the missed-periods debt streak, or coexist with
     it?
3. **Bonus points + Today-screen badge** for consistently-missed-then-met
   targets — see item 2 above; likely to be subsumed into the levelling
   design rather than built as a separate feature.
4. **Consecutive-day scheduling fix** for low-frequency habits — a habit
   could get Auto-scheduled on back-to-back days since `slack` alone
   doesn't prevent it; flagged but postponed in favor of shipping the
   fill-to-N section redesign first. Worth checking whether the debt
   system has changed how often this actually shows up in practice before
   investing in a fix.
5. **CSV export** — still low-hanging fruit given the current data shape.
6. **Just keep using the app** in the meantime — real usage, especially
   of the new Auto-mode/debt behavior, will keep surfacing friction points
   better than continued speculative building.
