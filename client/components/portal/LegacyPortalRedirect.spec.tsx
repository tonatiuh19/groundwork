import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LegacyPortalRedirect from "./LegacyPortalRedirect";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</p>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/portal" element={<LegacyPortalRedirect />} />
        <Route path="/portal/*" element={<LegacyPortalRedirect />} />
        <Route path="/client/*" element={<Where />} />
        <Route path="/client" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LegacyPortalRedirect", () => {
  afterEach(cleanup);

  it.each([
    ["/portal", "/client"],
    ["/portal/login", "/client/login"],
    ["/portal/project?x=1", "/client/project?x=1"],
    ["/portal/documents#top", "/client/documents#top"],
  ])("%s → %s", (from, to) => {
    renderAt(from);
    expect(screen.getByTestId("where").textContent).toBe(to);
  });
});
