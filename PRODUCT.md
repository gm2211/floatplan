# Floatplan Product Register

## Purpose

Floatplan is a safety-first sail-planning tool for Atlantic Yachting sailors departing Pier 25. It turns live wind, weather, current, daylight, and advisory data into a clear go/no-go decision, a practical Hudson route, and a ready-to-file float plan.

## Users and context

- Primary user: a club skipper planning shortly before departure, often on a phone at the pier.
- Core need: decide whether to sail, understand the route and return window, then complete the club's required float-plan workflow with as little duplicate entry as possible.
- Conditions: time pressure, outdoor glare, intermittent data, and safety-critical decisions. The skipper must always be able to distinguish live, stale, unavailable, and inferred information.

## Product principles

- Safety state is authoritative and prominent. Never turn missing data into a green verdict or imply that a plan was filed when it was only prepared.
- Compute from information already in the plan. Ask the sailor only for facts Floatplan cannot know.
- Prefer one clear action over a chain of copy, paste, and navigation steps.
- Credentials stay in the system that issued them. Do not request, store, copy, or transmit Club session tokens.
- The Atlantic Yachting Club app remains authoritative for bookings and filed-plan records. Floatplan may connect through an approved browser authentication flow and Club API, but must show the final filing result explicitly.

## Brand and interaction

- Restrained nautical utility: deep navy/ink, off-white surfaces, and signal colors reserved for verdicts, limits, and actionable status.
- The verdict is the loudest element. Integration and utility panels remain calm, compact, and operational.
- Copy is direct and specific: name the destination and outcome of every action.
- Avoid novelty nautical motifs, decorative gradients, generic card clutter, and ambiguous success states.

## Accessibility and quality

- Mobile-first, keyboard operable, visible focus, readable in dark and light themes, and compatible with reduced-motion preferences.
- Status changes use text as well as color and are announced through appropriate live regions.
- Every external-data failure is isolated, recoverable, and truthful; unrelated planning functions continue working.
