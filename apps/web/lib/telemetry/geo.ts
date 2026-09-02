/**
 * The country a request came from, without ever reading the address.
 *
 * Vercel resolves the client's country at the edge and hands it over as a
 * header, so the floor can fly a flag while `visitor.ts` keeps its property:
 * the address itself goes into a salted digest and nowhere else. No geo-IP
 * lookup, no third party, nothing stored.
 *
 * The header does not exist off Vercel — a `pnpm dev` server, a self-hosted
 * deploy, a test — and an absent country yields no flag rather than a wrong
 * one. That is correct in production and useless in development, where it makes
 * the feature unobservable: the first attempt at this shipped with no way to
 * see it working short of a deploy.
 *
 * So a development server may name a country to stand in for the edge. It is
 * read from the environment rather than from anything in the request, because a
 * country that a request can choose is a country an agent can claim, and it is
 * refused outright in production so that a stray variable there cannot put a
 * flag on the public floor.
 */
export const countryOfRequest = (header: string | null | undefined): string | undefined => {
  const resolved = header?.trim();
  if (resolved) return resolved;
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.TELEMETRY_DEV_COUNTRY?.trim() || undefined;
};
