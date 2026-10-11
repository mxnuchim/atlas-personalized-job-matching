import { describe, expect, it } from "vitest";

import { laneOf, parseLane } from "./lanes";
import { capPerCompany } from "./queue";
import { queueDay } from "./schedule";

describe("laneOf", () => {
  it("puts roles located in Nigeria in the Nigeria lane, including multi-country remote", () => {
    expect(laneOf("Remote, Nigeria")).toBe("nigeria");
    expect(laneOf("Remote, Lagos, Nigeria")).toBe("nigeria");
    expect(laneOf("Remote, Kenya; Remote, Lagos, Nigeria; Remote, London, United Kingdom")).toBe("nigeria");
    expect(laneOf("Abuja")).toBe("nigeria");
    expect(laneOf("Port Harcourt, Rivers")).toBe("nigeria");
    expect(laneOf("Jos, Plateau")).toBe("nigeria");
  });

  it("does not match a city name inside another word — the real false positive", () => {
    expect(laneOf("Sao Jose dos Campos")).toBe("global");
    expect(laneOf("São José dos Campos")).toBe("global");
  });

  it("treats regions that merely might include Nigeria as global", () => {
    expect(laneOf("EMEA")).toBe("global");
    expect(laneOf("Remote - Africa")).toBe("global");
    expect(laneOf("Benin")).toBe("global");
    expect(laneOf(null)).toBe("global");
  });

  it("parses only known lanes", () => {
    expect(parseLane("nigeria")).toBe("nigeria");
    expect(parseLane("mars")).toBeNull();
  });
});

describe("queueDay", () => {
  // The run is at 06:00; a queue day starts there, not at midnight.
  it("rolls over at the run hour in the configured zone", () => {
    expect(queueDay(new Date("2026-10-11T05:59:00Z"), "UTC")).toBe("2026-10-10");
    expect(queueDay(new Date("2026-10-11T06:00:00Z"), "UTC")).toBe("2026-10-11");
    // Lagos is UTC+1: 05:30 UTC is 06:30 there — already the new day.
    expect(queueDay(new Date("2026-10-11T05:30:00Z"), "Africa/Lagos")).toBe("2026-10-11");
    expect(queueDay(new Date("2026-10-11T04:30:00Z"), "Africa/Lagos")).toBe("2026-10-10");
  });
});

describe("capPerCompany with fill", () => {
  const rows = [
    { id: "1", company: "Moniepoint" },
    { id: "2", company: "Moniepoint" },
    { id: "3", company: "Moniepoint" },
    { id: "4", company: "Andela" },
    { id: "5", company: "Moniepoint" },
  ];

  it("still prefers variety when there's enough of it", () => {
    expect(capPerCompany(rows, 3, 2, { fill: true }).map((r) => r.id)).toEqual(["1", "2", "4"]);
  });

  it("tops up from skipped rows rather than leaving slots empty, in rank order", () => {
    expect(capPerCompany(rows, 5, 2, { fill: true }).map((r) => r.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(capPerCompany(rows, 5, 2).map((r) => r.id)).toEqual(["1", "2", "4"]);
  });
});
