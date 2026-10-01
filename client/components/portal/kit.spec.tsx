import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form, Formik } from "formik";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import {
  BusyButton,
  DataTable,
  ErrorNote,
  FileField,
  HeaderAction,
  ListPager,
  MilestoneTracker,
  PageHeader,
  PdfLink,
  StatusBadge,
  statusTone,
  useBusyAction,
} from "./kit";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

describe("MilestoneTracker", () => {
  it("marks earlier steps done, the current step, and leaves later steps plain", () => {
    render(<MilestoneTracker milestone="contracted" />);
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.className)).toEqual(["is-done", "is-done", "is-current", "", ""]);
    expect(steps.filter((s) => s.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
  });

  it("first and last milestones render sensible edge states", () => {
    const { rerender } = render(<MilestoneTracker milestone="lead" />);
    let steps = screen.getAllByRole("listitem");
    expect(steps[0].className).toBe("is-current");
    expect(steps.slice(1).every((s) => s.className === "")).toBe(true);
    rerender(<MilestoneTracker milestone="closed" />);
    steps = screen.getAllByRole("listitem");
    expect(steps.slice(0, 4).every((s) => s.className === "is-done")).toBe(true);
    expect(steps[4].className).toBe("is-current");
  });

  it("cancelled projects show a single bad badge instead of the pipeline", () => {
    render(<MilestoneTracker milestone="cancelled" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Cancelled")).toHaveClass("pf-badge--bad");
  });
});

describe("StatusBadge / statusTone", () => {
  it.each([
    ["paid", "good"],
    ["signed", "good"],
    ["pending", "warn"],
    ["in_build", "warn"],
    ["void", "bad"],
    ["cancelled", "bad"],
    ["draft", "muted"],
    ["something-new", "muted"],
  ])("%s → %s", (value, tone) => {
    expect(statusTone(value)).toBe(tone);
  });

  it("translates known values (EN/ES) and falls back to the raw value", async () => {
    const { rerender } = render(<StatusBadge group="milestone" value="in_build" />);
    expect(screen.getByText("In build")).toHaveClass("pf-badge--warn");
    await i18n.changeLanguage("es");
    rerender(<StatusBadge group="milestone" value="in_build" />);
    expect(screen.getByText("En construcción")).toBeInTheDocument();
    rerender(<StatusBadge group="milestone" value="brand_new_state" />);
    expect(screen.getByText("brand_new_state")).toHaveClass("pf-badge--muted");
  });
});

describe("DataTable", () => {
  const columns = [
    { key: "name", headerKey: "pf.project", render: (r: { id: number; name: string }) => r.name },
  ];

  it("shows loading only while empty, the empty message otherwise, and rows when present", () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByText(i18n.t("pf.loading"))).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyKey="ctr.noDraws" />);
    expect(screen.getByText(i18n.t("ctr.noDraws"))).toBeInTheDocument();
    rerender(
      <DataTable columns={columns} rows={[{ id: 1, name: "GW-1" }]} rowKey={(r) => r.id} loading />,
    );
    expect(screen.queryByText(i18n.t("pf.loading"))).toBeNull(); // stale rows stay visible during refresh
    expect(screen.getByText("GW-1")).toBeInTheDocument();
  });

  it("is keyboard/click friendly only when a row handler is supplied", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ]}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    await userEvent.click(screen.getByText("B"));
    expect(onRowClick).toHaveBeenCalledWith({ id: 2, name: "B" });
    expect(screen.getByText("B").closest("tr")).toHaveClass("is-clickable");
    expect(screen.getByText("B").closest("td")).toHaveAttribute("data-label", i18n.t("pf.project"));
  });
});

describe("PdfLink", () => {
  it("links to the API PDF in the active language, opening safely in a new tab", async () => {
    render(<PdfLink path="/client/documents/42/pdf" />);
    const link = screen.getByRole("link", { name: /PDF/ });
    expect(link).toHaveAttribute("href", "/api/client/documents/42/pdf?lang=en");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("follows the UI language", async () => {
    await i18n.changeLanguage("es");
    render(<PdfLink path="/admin/contracts/7/pdf" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/api/admin/contracts/7/pdf?lang=es");
  });
});

describe("ErrorNote", () => {
  it("renders nothing without an error and translates API error keys", () => {
    const { container, rerender } = render(<ErrorNote error={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ErrorNote error="errors.otpSendFailed" />);
    expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("errors.otpSendFailed"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("errors.otpSendFailed");
    rerender(<ErrorNote error="Plain legacy message" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Plain legacy message");
  });
});

describe("FileField", () => {
  it("stores the chosen File in Formik state and can be cleared", async () => {
    const seen: Array<File | null> = [];
    render(
      <MemoryRouter>
        <Formik initialValues={{ file: null as File | null }} onSubmit={(v) => void seen.push(v.file)}>
          <Form>
            <FileField name="file" labelKey="ctr.photoFile" accept="image/png" />
            <button type="submit">go</button>
          </Form>
        </Formik>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText(i18n.t("ctr.photoFile")) as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/png");
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByText("go"));
    expect(seen[seen.length - 1]).toBe(file);
  });
});

describe("PageHeader", () => {
  it("renders Overview eyebrow, title, lead, and HeaderAction", async () => {
    const onClick = vi.fn();
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PageHeader
            titleKey="portalNav.staff"
            leadKey="admin.staffLead"
            actions={<HeaderAction labelKey="admin.addStaff" onClick={onClick} />}
          />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByText(i18n.t("portalDash.eyebrow"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: i18n.t("portalNav.staff") })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("admin.staffLead"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("admin.addStaff") }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ListPager", () => {
  it("hides when everything fits on the first page", () => {
    const { container } = render(
      <ListPager total={20} limit={50} offset={0} onPageChange={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows range and pages when total exceeds the page size", async () => {
    const onPageChange = vi.fn();
    render(<ListPager total={120} limit={50} offset={50} onPageChange={onPageChange} />);
    expect(screen.getByText(i18n.t("pf.showingRange", { from: 51, to: 100, total: 120 }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("pf.prev") }));
    expect(onPageChange).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("pf.next") }));
    expect(onPageChange).toHaveBeenCalledWith(100);
  });
});

describe("BusyButton", () => {
  it("shows the idle label, then busy shimmer, then done flash", () => {
    const { rerender } = render(
      <BusyButton label="Approve" busyLabel="Approving…" doneLabel="Approved" />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();

    rerender(
      <BusyButton label="Approve" busyLabel="Approving…" doneLabel="Approved" busy />,
    );
    const busyBtn = screen.getByRole("button", { name: /Approving/ });
    expect(busyBtn).toBeDisabled();
    expect(busyBtn).toHaveAttribute("aria-busy", "true");
    expect(busyBtn.className).toContain("pf-btn--busy");

    rerender(
      <BusyButton label="Approve" busyLabel="Approving…" doneLabel="Approved" done />,
    );
    const doneBtn = screen.getByRole("button", { name: /Approved/ });
    expect(doneBtn).toBeDisabled();
    expect(doneBtn.className).toContain("pf-btn--success");
  });
});

describe("useRowBusy / useBusyAction", () => {
  it("useBusyAction locks re-entry while running", async () => {
    let resolve!: (v: boolean) => void;
    const deferred = new Promise<boolean>((r) => {
      resolve = r;
    });
    function Probe() {
      const { busy, run } = useBusyAction();
      return (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () => deferred);
          }}
        >
          {busy ? "busy" : "idle"}
        </button>
      );
    }
    render(<Probe />);
    const btn = screen.getByRole("button", { name: "idle" });
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: "busy" })).toBeDisabled();
    resolve(true);
    await screen.findByRole("button", { name: "idle" });
  });
});
