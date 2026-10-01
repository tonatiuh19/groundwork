import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  const cols = [
    { header: "Name", value: (r: { n: string; e: string }) => r.n },
    { header: "Email", value: (r: { n: string; e: string }) => r.e },
  ];

  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv([{ n: 'Ana "A", Jr', e: "a@example.com" }], cols);
    expect(csv).toBe('Name,Email\r\n"Ana ""A"", Jr",a@example.com');
  });

  it("neutralises formula injection and null cells", () => {
    const csv = toCsv([{ n: "=HYPERLINK(1)", e: null as unknown as string }], cols);
    expect(csv).toBe("Name,Email\r\n'=HYPERLINK(1),");
  });
});
