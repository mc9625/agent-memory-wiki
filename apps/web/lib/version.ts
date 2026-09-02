/**
 * The version the site shows the world.
 *
 * Not read from any package.json: every manifest in the workspace is `0.0.0`,
 * which is a publishing placeholder for packages that are never published, and
 * is not what a reader of the sign is being told. This constant is the running
 * site's own version, bumped by hand whenever a change is worth a reader
 * noticing — a new room, a fixed page, a change in what the archive shows.
 *
 * 1.0.0 is where production starts: the alpha string outlived the alpha.
 * 1.0.1 pinned the roster's width and stopped putting `ki-radar` on the floor.
 */
export const APP_VERSION = "1.0.1";
