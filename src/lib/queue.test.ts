import { describe, expect, it } from "vitest";

import { capPerCompany } from "./queue";

const row = (company: string, id: string) => ({ company, id });

describe("capPerCompany", () => {
  it("keeps the input order", () => {
    const rows = [row("A", "1"), row("B", "2"), row("C", "3")];
    expect(capPerCompany(rows, 10, 4).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("drops an employer's rows past the cap", () => {
    // The real case: four consecutive SumUp roles taking a third of the queue.
    const rows = [
      row("SumUp", "1"),
      row("SumUp", "2"),
      row("SumUp", "3"),
      row("SumUp", "4"),
      row("SumUp", "5"),
      row("Monzo", "6"),
    ];
    expect(capPerCompany(rows, 10, 4).map((r) => r.id)).toEqual(["1", "2", "3", "4", "6"]);
  });

  it("lets a later company through after an earlier one is capped", () => {
    const rows = [row("A", "1"), row("A", "2"), row("B", "3"), row("A", "4")];
    expect(capPerCompany(rows, 10, 2).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("stops at the limit", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`C${i}`, String(i)));
    expect(capPerCompany(rows, 20, 4)).toHaveLength(20);
  });

  it("treats the same employer written differently as one company", () => {
    // Boards disagree on casing and padding for the same name.
    const rows = [row("SumUp", "1"), row(" sumup ", "2"), row("SUMUP", "3")];
    expect(capPerCompany(rows, 10, 2).map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("returns fewer than the limit rather than repeating a capped employer", () => {
    // A short queue is honest; padding it with a fifth role at the same place is not.
    const rows = [row("A", "1"), row("A", "2"), row("A", "3")];
    expect(capPerCompany(rows, 10, 2)).toHaveLength(2);
  });

  it("handles an empty input", () => {
    expect(capPerCompany([], 10, 4)).toEqual([]);
  });
});
