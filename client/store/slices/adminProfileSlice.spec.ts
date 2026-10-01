import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import type { PortalAuthUser } from "@shared/api";
import { api } from "@/lib/api";
import portalAuthReducer, {
  setPortalUser,
} from "@/store/slices/portalAuthSlice";
import {
  updateAdminProfile,
  uploadAdminAvatar,
} from "@/store/slices/adminProfileSlice";

const user: PortalAuthUser = {
  id: 9,
  email: "boss@example.com",
  first_name: "Bo",
  last_name: "Ss",
  phone: null,
  status: "active",
  preferred_language: "en",
  role: "agent",
  avatar_url: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminProfile thunks", () => {
  it("patches /admin/me and avatar upload posts raw bytes", async () => {
    const store = configureStore({
      middleware: (getDefault) =>
        getDefault({
          serializableCheck: { ignoredActionPaths: ["meta.arg.file"] },
        }),
      reducer: { portalAuth: portalAuthReducer },
    });
    const patched = { ...user, first_name: "Alex", phone: "9495550000" };
    const withAvatar = {
      ...patched,
      avatar_url: "https://store1.public.blob.vercel-storage.com/a.jpg",
    };
    const patch = vi
      .spyOn(api, "patch")
      .mockResolvedValue({ data: { user: patched } } as any);
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { user: withAvatar } } as any);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const update = await store.dispatch(
      updateAdminProfile({ first_name: "Alex", phone: "9495550000" }),
    );
    expect(updateAdminProfile.fulfilled.match(update)).toBe(true);
    expect(patch).toHaveBeenCalledWith("/admin/me", {
      first_name: "Alex",
      phone: "9495550000",
    });

    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
      type: "image/jpeg",
    });
    const avatar = await store.dispatch(uploadAdminAvatar({ file: blob }));
    expect(uploadAdminAvatar.fulfilled.match(avatar)).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "/admin/me/avatar",
      blob,
      expect.objectContaining({
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/non-serializable/i);

    store.dispatch(setPortalUser({ actor: "admin", user: withAvatar }));
    expect(store.getState().portalAuth.admin.user?.avatar_url).toContain(
      "blob.vercel",
    );
  });
});
