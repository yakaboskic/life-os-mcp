import { describe, expect, it } from "vitest";
import { cellA1, columnLetter, dataRangeA1, quoteA1Tab } from "../../src/toolsets/drive/a1.js";
import { cellStr, headerIndex, matchRows, parseHeaders, rowsToObjects } from "../../src/toolsets/drive/table.js";
import { ToolInputError } from "../../src/core/errors.js";
import { scopesForServices, servicesFromScopes } from "../../src/google/scopes.js";
import { requireScopes } from "../../src/google/auth.js";

describe("A1 helpers", () => {
  it("always quotes tab names and doubles internal apostrophes", () => {
    expect(quoteA1Tab("Person logs")).toBe("'Person logs'");
    expect(quoteA1Tab("Analytical library'")).toBe("'Analytical library'''");
    expect(cellA1("Analytical library'", 7, 2)).toBe("'Analytical library'''!C7");
  });

  it("converts column indices bijectively (Z→AA boundary)", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
  });

  it("builds open-ended and bounded data ranges", () => {
    expect(dataRangeA1("Tab", 7, 2)).toBe("'Tab'!A2:H");
    expect(dataRangeA1("Tab", 7, 1, 10)).toBe("'Tab'!A1:H10");
  });
});

describe("table helpers", () => {
  const headers = parseHeaders(["Person", " Week ", "Hours", "", "Notes"]);

  it("resolves headers case-insensitively with trimming", () => {
    expect(headerIndex(headers, "week")).toBe(1);
    expect(headerIndex(headers, "HOURS")).toBe(2);
  });

  it("lists available headers on a miss and blocks duplicates", () => {
    expect(() => headerIndex(headers, "Wek")).toThrowError(/Available headers: Person, Week, Hours, Notes/);
    expect(() => headerIndex(["A", "B", "a"], "a")).toThrowError(/ambiguous/);
  });

  it("matches rows on all criteria, trimmed and case-insensitive", () => {
    const rows = [
      ["Owner", "W1", "3"],
      ["Colleague", "W1", "5"],
      [" owner ", "W2", "2"],
    ];
    expect(matchRows(headers, rows, 2, { Person: "Owner" })).toEqual([2, 4]);
    expect(matchRows(headers, rows, 2, { Person: "Owner", Week: "W2" })).toEqual([4]);
    expect(matchRows(headers, rows, 2, { Person: "Nobody" })).toEqual([]);
    expect(() => matchRows(headers, rows, 2, {})).toThrowError(ToolInputError);
  });

  it("builds header-keyed row objects, skipping blank headers", () => {
    const [row] = rowsToObjects(headers, [["Owner", "W1", 3, "ignored", "note"]], 2);
    expect(row).toEqual({ rowNumber: 2, values: { Person: "Owner", Week: "W1", Hours: "3", Notes: "note" } });
  });

  it("cellStr normalizes null/undefined/numbers", () => {
    expect(cellStr(null)).toBe("");
    expect(cellStr(undefined)).toBe("");
    expect(cellStr(4.5)).toBe("4.5");
    expect(cellStr("  x ")).toBe("x");
  });
});

describe("service scopes", () => {
  it("unions service scopes with the base identity scope", () => {
    const scopes = scopesForServices(["gmail", "drive"]);
    expect(scopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(scopes).toContain("https://www.googleapis.com/auth/spreadsheets");
    expect(scopes).toContain("https://www.googleapis.com/auth/drive");
    expect(() => scopesForServices(["nope"])).toThrowError(/Unknown service "nope"/);
  });

  it("derives service tags from granted scopes", () => {
    expect(servicesFromScopes(["https://www.googleapis.com/auth/gmail.modify"])).toEqual(["gmail"]);
    expect(servicesFromScopes(scopesForServices(["drive"]))).toEqual(["drive"]);
  });

  it("requireScopes names the missing permission and the re-auth command", () => {
    const token = {
      account: "op@x.com",
      refresh_token: "rt",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      client_id: "c",
      created_at: "",
      updated_at: "",
    };
    expect(() =>
      requireScopes(token, ["https://www.googleapis.com/auth/spreadsheets"], "life-os auth add --services drive"),
    ).toThrowError(/lacks required permission\(s\): spreadsheets.*auth add --services drive/s);
  });
});
