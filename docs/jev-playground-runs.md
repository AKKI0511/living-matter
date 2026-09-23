# Trying Jev in the TypeSafe playground

[Jev](jev.md) · [Live session audits](jev-session-audits.md)

The game already builds the `state` and `questions` payload the live backend sends. To try a situation in the TypeSafe playground, enable [session auditing](jev-session-audits.md), play the moment you care about, then copy `jev-request.json` from that call folder. Keep playground transcripts, request IDs, and local run dumps out of the repository.

Two situations that are useful to try:

- **An unsupported edge after a jump.** Walk to a gap, jump and land back, then wait at the edge. Jev should see repeated attempts into open air and choose a candidate that continues across the gap.
- **A reverse on living matter.** Form a walkable section, then turn around toward space that section does not serve. Jev should keep the occupied section and reuse the free one.
