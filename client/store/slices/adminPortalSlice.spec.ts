import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
import adminPortalReducer, {
  fetchAdminAffiliateDetail,
  fetchAdminAssignees,
  fetchAdminClientDetail,
  fetchAdminClients,
  fetchAdminContractorDetail,
  fetchAdminLeads,
} from "@/store/slices/adminPortalSlice";

const makeStore = () =>
  configureStore({ reducer: { adminPortal: adminPortalReducer } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminPortal list envelope", () => {
  it("keeps the server total alongside the rows", async () => {
    const store = makeStore();
    vi.spyOn(api, "get").mockResolvedValue({
      data: { clients: [{ id: 1 }, { id: 2 }], total: 57, limit: 50, offset: 0 },
    } as any);

    await store.dispatch(fetchAdminClients());
    const { items, total } = store.getState().adminPortal.clients;
    expect(items).toHaveLength(2);
    expect(total).toBe(57);
  });

  it("falls back to the row count when an endpoint sends no total", async () => {
    const store = makeStore();
    vi.spyOn(api, "get").mockResolvedValue({
      data: { leads: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    } as any);

    await store.dispatch(fetchAdminLeads());
    expect(store.getState().adminPortal.leads.total).toBe(3);
  });
});

describe("adminPortal filter params", () => {
  it("sends only the filters that have a value", async () => {
    const store = makeStore();
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: { clients: [], total: 0 } } as any);

    await store.dispatch(
      fetchAdminClients({
        q: "ada",
        status: "",
        affiliate_id: undefined,
        limit: 100,
      }),
    );
    expect(get).toHaveBeenCalledWith("/admin/clients", {
      params: { q: "ada", limit: 100 },
    });
  });

  it("omits the config entirely when every filter is empty", async () => {
    const store = makeStore();
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: { clients: [], total: 0 } } as any);

    await store.dispatch(fetchAdminClients({ q: "", status: "" }));
    expect(get).toHaveBeenCalledWith("/admin/clients", undefined);
  });
});

describe("adminPortal assignees and record details", () => {
  it("stores the assignee picker list", async () => {
    const store = makeStore();
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        assignees: [
          {
            id: 4,
            email: "ops@example.com",
            first_name: "Ops",
            last_name: "Lead",
            role: "agent",
          },
        ],
      },
    } as any);

    await store.dispatch(fetchAdminAssignees());
    const { items, total } = store.getState().adminPortal.assignees;
    expect(items[0].email).toBe("ops@example.com");
    expect(total).toBe(1);
  });

  it("unwraps each record detail envelope into its own slot", async () => {
    const store = makeStore();
    vi.spyOn(api, "get").mockImplementation((async (url: string) => {
      if (url === "/admin/clients/7") return { data: { client: { id: 7 } } };
      if (url === "/admin/affiliates/8") return { data: { affiliate: { id: 8 } } };
      return { data: { contractor: { id: 9 } } };
    }) as any);

    await store.dispatch(fetchAdminClientDetail(7));
    await store.dispatch(fetchAdminAffiliateDetail(8));
    await store.dispatch(fetchAdminContractorDetail(9));

    const s = store.getState().adminPortal;
    expect(s.clientDetail.data?.id).toBe(7);
    expect(s.affiliateDetail.data?.id).toBe(8);
    expect(s.contractorDetail.data?.id).toBe(9);
  });
});
