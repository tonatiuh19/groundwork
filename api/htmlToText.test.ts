import { describe, expect, it } from "vitest";
import { htmlToText } from "./index";

describe("email HTML → conversation text", () => {
  it("drops the hidden preheader and the hidden anti-threading code", () => {
    const html = `<!doctype html><html><head><title>Hi</title><style>p{}</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;">Preview text only for the inbox</div>
<p>Welcome, Andrea!</p><p>Sign in</p>
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">56d603910001</div>
</body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Welcome, Andrea!");
    expect(text).toContain("Sign in");
    expect(text).not.toContain("56d603910001");
    expect(text).not.toContain("Preview text only");
    expect(text).not.toContain("Hi\n");
  });
  it("keeps visible content and decodes entities", () => {
    expect(htmlToText("<p>A &amp; B</p><br><div style=\"color:red\">Visible</div>")).toBe("A & B\n\nVisible");
  });
});
