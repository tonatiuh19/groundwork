import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KitSkeleton } from "./PartnerKit";
import { DataTable } from "@/components/portal/kit";

afterEach(cleanup);

describe("partner kit skeletons", () => {
  it("shapes the shimmer like the page and announces loading", () => {
    const { container, rerender } = render(<KitSkeleton layout="cards" rows={5} label="Loading" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".pk-skel__card")).toHaveLength(5);
    expect(container.querySelector(".pk-skel__hero")).toBeNull();
    rerender(<KitSkeleton layout="detail" rows={2} />);
    expect(container.querySelector(".pk-skel__hero")).not.toBeNull();
    expect(container.querySelector(".pk-skel__journey")).not.toBeNull();
    rerender(<KitSkeleton layout="form" rows={3} />);
    expect(container.querySelectorAll(".pk-skel__form .pk-skel__stack")).toHaveLength(3);
  });

  it("DataTable shows a table skeleton only when asked, and only before the first rows", () => {
    const cols = [{ key: "a", headerKey: "pf.loading", render: (r: { id: number }) => r.id }];
    const { container, rerender } = render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} loading skeleton />);
    expect(container.querySelector(".pf-table-skel")).not.toBeNull();
    rerender(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} loading />);
    expect(container.querySelector(".pf-table-skel")).toBeNull();
    rerender(<DataTable columns={cols} rows={[{ id: 1 }]} rowKey={(r) => r.id} loading skeleton />);
    expect(container.querySelector(".pf-table-skel")).toBeNull();
  });
});
