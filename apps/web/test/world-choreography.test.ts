import { describe, expect, it } from "vitest";
import type { SkyEvent } from "../components/sky-canvas";
import {
  agentHue,
  agentOrigin,
  buildAgentPlans,
  cleaningTask,
  displayAgentName,
  isHumanAgent,
  taskForEvent,
} from "../lib/world/choreography";
import {
  OBSTACLES,
  ROOMS,
  WAYPOINTS,
  findPath,
  segmentCrossesWall,
  segmentHitsObstacle,
} from "../lib/world/layout";

const event = (overrides: Partial<SkyEvent> & { eventType: string }): SkyEvent => ({
  id: overrides.id ?? `evt-${Math.random()}`,
  sessionId: overrides.sessionId ?? "session-1",
  generation: overrides.generation ?? 1,
  eventType: overrides.eventType,
  agentIdentifier: overrides.agentIdentifier ?? "Claude",
  articleId: overrides.articleId ?? null,
  relatedArticleId: overrides.relatedArticleId ?? null,
  createdAt: overrides.createdAt ?? "2026-08-31T10:00:00.000Z",
  ...(overrides.safeMetadata !== undefined ? { safeMetadata: overrides.safeMetadata } : {}),
});

describe("world choreography", () => {
  it("maps every archive event type to a room", () => {
    // Mirrors the archive_events check constraint in packages/db/src/schema.
    const eventTypes = [
      "agent_session_started",
      "article_opened",
      "article_created",
      "article_revised",
      "wikilinks_created",
      "contribution_aborted",
      "agent_session_ended",
    ];

    for (const eventType of eventTypes) {
      const task = taskForEvent(event({ eventType }));
      expect(task, `${eventType} should map to a task`).not.toBeNull();
      expect(ROOMS.some((room) => room.id === task?.room)).toBe(true);
    }
  });

  it("ignores event types outside the archive vocabulary", () => {
    expect(taskForEvent(event({ eventType: "definitely_not_an_event" }))).toBeNull();
  });

  it("orders a session's tasks oldest first regardless of input order", () => {
    const plans = buildAgentPlans([
      event({ eventType: "article_created", createdAt: "2026-08-31T10:00:20.000Z" }),
      event({ eventType: "agent_session_started", createdAt: "2026-08-31T10:00:00.000Z" }),
      event({ eventType: "article_opened", createdAt: "2026-08-31T10:00:10.000Z" }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.tasks.map((task) => task.room)).toEqual(["hub", "read", "edit"]);
  });

  it("collapses consecutive duplicates on the same article", () => {
    const plans = buildAgentPlans([
      event({ eventType: "article_opened", articleId: "a1", createdAt: "2026-08-31T10:00:00.000Z" }),
      event({ eventType: "article_opened", articleId: "a1", createdAt: "2026-08-31T10:00:05.000Z" }),
      event({ eventType: "article_opened", articleId: "a2", createdAt: "2026-08-31T10:00:09.000Z" }),
    ]);

    expect(plans[0]?.tasks).toHaveLength(2);
  });

  it("separates sessions into distinct plans and drops sessionless events", () => {
    const plans = buildAgentPlans([
      event({ sessionId: "s1", eventType: "article_opened", createdAt: "2026-08-31T10:00:00.000Z" }),
      event({ sessionId: "s2", eventType: "article_created", createdAt: "2026-08-31T10:00:01.000Z" }),
      event({ sessionId: "  ", eventType: "article_revised" }),
    ]);

    expect(plans.map((plan) => plan.sessionId)).toEqual(["s1", "s2"]);
  });

  it("carries the article title into the speech bubble caption", () => {
    const task = taskForEvent(
      event({ eventType: "article_opened", safeMetadata: { title: "On Forgetting" } }),
    );
    expect(task?.caption).toBe('reading "On Forgetting"');
  });

  it("keeps the regular cast's hues well apart", () => {
    // These four are the agents the archive actually holds, and they used to
    // land within sixty degrees of each other: three of the avatars on stage
    // were the same colour.
    const cast = ["Claude", "ChatGPT", "DeepSeek", "Gemini"].map(agentHue);
    for (const [index, hue] of cast.entries()) {
      for (const other of cast.slice(index + 1)) {
        const gap = Math.abs(hue - other);
        expect(Math.min(gap, 360 - gap), `${hue} and ${other}`).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("gives Claude the mascot's orange, whatever the user agent says", () => {
    expect(agentHue("Claude")).toBe(18);
    expect(agentHue("claude-opus-4/1.0")).toBe(18);
  });

  it("recognises a browsing human in both the shapes the archive holds", () => {
    // Events recorded through the API carry the raw user agent; events the site
    // broadcasts for its own page views carry the classified name, which has
    // none of the browser tokens in it. Both are the same person.
    expect(isHumanAgent("Human Explorer")).toBe(true);
    expect(isHumanAgent("Mozilla/5.0 (Macintosh) AppleWebKit Safari/605")).toBe(true);
    expect(isHumanAgent("claude-opus-5")).toBe(false);
    expect(isHumanAgent(null)).toBe(false);
  });

  it("does not dress an agent as a human because its name carries a browser word", () => {
    // An identifier is whatever the submitter claimed. A loose substring test
    // put a dressed human in EDIT, a room only a submission ever reaches.
    expect(isHumanAgent("Chrome-Assistant/2.1")).toBe(false);
    expect(isHumanAgent("safari-research-agent")).toBe(false);
    expect(isHumanAgent("Mozilla/5.0 (compatible; GPTBot/1.2)")).toBe(false);
    expect(isHumanAgent("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(false);
  });

  it("puts both shapes of a browsing human under one roster name", () => {
    expect(displayAgentName("Human Explorer")).toBe("Explorer");
    expect(displayAgentName("Mozilla/5.0 (Macintosh) AppleWebKit Safari/605")).toBe("Explorer");
  });
});

describe("world layout", () => {
  it("finds a path from the entrance to every room", () => {
    for (const room of ROOMS) {
      const path = findPath("entrance", room.id);
      expect(path.length, `no path to ${room.id}`).toBeGreaterThan(0);
    }
  });

  it("never routes a segment through a wall, between any pair of rooms", () => {
    // The regression this locks down: the hub used to be a walled room the
    // corridor ran straight across, so avatars walked out through its back wall.
    for (const from of ROOMS) {
      for (const to of ROOMS) {
        if (from.id === to.id) continue;
        const path = findPath(from.id, to.id);
        expect(path.length, `no path ${from.id} → ${to.id}`).toBeGreaterThan(1);

        for (let index = 1; index < path.length; index += 1) {
          const previous = path[index - 1];
          const current = path[index];
          if (!previous || !current) continue;
          expect(
            segmentCrossesWall(previous, current),
            `${from.id} → ${to.id} crosses a wall between ` +
              `(${previous.x}, ${previous.z}) and (${current.x}, ${current.z})`,
          ).toBe(false);
        }
      }
    }
  });

  it("never routes a segment through a floor prop, between any pair of rooms", () => {
    // The regression this locks down: a planter stood on the corridor to EDIT
    // and a stack of crates stood in ARCHIVE's doorway, and avatars walked
    // straight through both.
    for (const from of ROOMS) {
      for (const to of ROOMS) {
        if (from.id === to.id) continue;
        const path = findPath(from.id, to.id);

        for (let index = 1; index < path.length; index += 1) {
          const previous = path[index - 1];
          const current = path[index];
          if (!previous || !current) continue;
          expect(
            segmentHitsObstacle(previous, current),
            `${from.id} → ${to.id} clips a prop between ` +
              `(${previous.x}, ${previous.z}) and (${current.x}, ${current.z})`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps the last leg to every seat clear of floor props", () => {
    // The graph ends at a room's own waypoint; the walk to the claimed seat is
    // the one segment findPath never returns.
    for (const room of ROOMS) {
      const arrival = WAYPOINTS[room.id];
      expect(arrival, `${room.id} has no waypoint`).toBeDefined();
      if (!arrival) continue;
      for (const seat of room.seats) {
        expect(
          segmentHitsObstacle(arrival, seat),
          `${room.id} seat (${seat.x}, ${seat.z}) is reached through a prop`,
        ).toBe(false);
      }
    }
  });

  it("gives every obstacle a distinct id", () => {
    const ids = new Set(OBSTACLES.map((obstacle) => obstacle.id));
    expect(ids.size).toBe(OBSTACLES.length);
  });

  it("routes the opposite corners through the corridor rather than across", () => {
    const path = findPath("read", "archive");
    expect(path.length).toBeGreaterThan(4);
  });

  it("gives every room enough distinct seats for concurrent agents", () => {
    for (const room of ROOMS) {
      expect(room.seats.length, `${room.id} has too few seats`).toBeGreaterThanOrEqual(3);
      const unique = new Set(room.seats.map((seat) => `${seat.x}:${seat.z}`));
      expect(unique.size, `${room.id} has duplicate seats`).toBe(room.seats.length);
    }
  });

  it("shortens an identifier to a few words for the avatar's own card", () => {
    expect(
      agentOrigin(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      ),
    ).toBe("Safari · macOS");
    expect(agentOrigin("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/120 Safari/604")).toBe(
      "Chrome · iOS",
    );
    expect(agentOrigin("claude-opus-5")).toBe("model · api");
    expect(agentOrigin("curl/8.4.0")).toBe("script · api");
    expect(agentOrigin("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("crawler");
    expect(agentOrigin("")).toBe("unknown client");
  });

  it("walks the cleaner through every room and hums every third leg", () => {
    const round = Array.from({ length: 15 }, (_, step) => cleaningTask(step));

    expect(new Set(round.map((task) => task.room))).toEqual(
      new Set(["hub", "read", "edit", "links", "archive"]),
    );
    for (const task of round) expect(task.action).toBe("clean");
    // The bubble is a note or nothing: a cleaner has no archive event to caption.
    for (const task of round) expect(task.caption).toBeUndefined();
    const humming = round.filter((task) => task.icon === "🎵");
    expect(humming.length).toBe(5);
    expect(new Set(round.map((task) => task.sourceEventId)).size).toBe(round.length);
  });

  it("sends the window cleaner to glazed rooms only, and to the pane in them", () => {
    const round = Array.from({ length: 12 }, (_, step) => cleaningTask(step, true));
    expect(new Set(round.map((task) => task.room))).toEqual(
      new Set(["read", "edit", "links", "archive"]),
    );

    for (const room of ROOMS) {
      if (room.open) {
        expect(room.glass, `${room.id} is open and cannot be glazed`).toBeUndefined();
        continue;
      }
      const pane = room.glass;
      expect(pane, `${room.id} has no glass spot`).toBeDefined();
      if (!pane) continue;
      expect(Math.abs(pane.at.x - room.center.x)).toBeLessThanOrEqual(room.width / 2);
      expect(Math.abs(pane.at.z - room.center.z)).toBeLessThanOrEqual(room.depth / 2);

      // Last leg again: the graph stops at the room's waypoint, and the walk to
      // the pane is the segment it never returns.
      const arrival = WAYPOINTS[room.id];
      expect(arrival).toBeDefined();
      if (!arrival) continue;
      expect(
        segmentHitsObstacle(arrival, pane.at),
        `${room.id} glass spot is reached through a prop`,
      ).toBe(false);
      // And the spot itself is not standing inside one.
      expect(
        segmentHitsObstacle(pane.at, pane.at),
        `${room.id} glass spot is inside a prop`,
      ).toBe(false);
    }
  });

  it("gives every room a standby queue distinct from its seats", () => {
    for (const room of ROOMS) {
      expect(room.standby.length, `${room.id} has too few standby spots`).toBeGreaterThanOrEqual(3);
      const points = [...room.seats, ...room.standby].map((point) => `${point.x}:${point.z}`);
      expect(new Set(points).size, `${room.id} reuses a point`).toBe(points.length);
    }
  });

  it("keeps the walk between the room waypoint and every standby spot clear", () => {
    // Both directions matter: the arriving avatar walks waypoint → standby, and
    // the one promoted into a freed seat walks standby → waypoint → seat.
    for (const room of ROOMS) {
      const arrival = WAYPOINTS[room.id];
      expect(arrival, `${room.id} has no waypoint`).toBeDefined();
      if (!arrival) continue;
      for (const spot of room.standby) {
        expect(
          segmentHitsObstacle(arrival, spot),
          `${room.id} standby (${spot.x}, ${spot.z}) is reached through a prop`,
        ).toBe(false);
      }
    }
  });

  it("keeps every seat inside its own room", () => {
    for (const room of ROOMS) {
      for (const seat of room.seats) {
        expect(Math.abs(seat.x - room.center.x)).toBeLessThanOrEqual(room.width / 2);
        expect(Math.abs(seat.z - room.center.z)).toBeLessThanOrEqual(room.depth / 2);
      }
    }
  });

  it("keeps every standby spot inside its own room", () => {
    for (const room of ROOMS) {
      for (const spot of room.standby) {
        expect(Math.abs(spot.x - room.center.x)).toBeLessThanOrEqual(room.width / 2);
        expect(Math.abs(spot.z - room.center.z)).toBeLessThanOrEqual(room.depth / 2);
      }
    }
  });

  it("holds every concurrent agent in one room without an overlap", () => {
    // `MAX_CONCURRENT_AGENTS` in world-canvas.tsx is what bounds the worst case:
    // every agent doing the same thing at once, all of them in the same room.
    const stageCapacity = 6;
    for (const room of ROOMS) {
      expect(
        room.seats.length + room.standby.length,
        `${room.id} cannot hold a full stage`,
      ).toBeGreaterThanOrEqual(stageCapacity);
    }
  });

  it("returns an empty path for unknown nodes", () => {
    expect(findPath("entrance", "cafeteria")).toEqual([]);
  });
});
