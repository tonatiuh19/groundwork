import { createSlice } from "@reduxjs/toolkit";
import type {
  ConvertCrmContactResponse,
  CrmContact,
  CrmContactWritePayload,
  CrmContactsListResponse,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

const A = "admin" as const;

export type ContactsListQuery = {
  search?: string;
  page?: number;
  limit?: number;
};

type ContactsState = {
  contacts: CrmContact[];
  pagination: CrmContactsListResponse["pagination"] | null;
  listQuery: ContactsListQuery | null;
  loading: boolean;
  error: string | null;
  panelContact: CrmContact | null;
  panelLoading: boolean;
  mutating: boolean;
  mutateError: string | null;
};

const initialState: ContactsState = {
  contacts: [],
  pagination: null,
  listQuery: null,
  loading: false,
  error: null,
  panelContact: null,
  panelLoading: false,
  mutating: false,
  mutateError: null,
};

export const fetchAdminContacts = createApiThunk<
  CrmContactsListResponse & { query: ContactsListQuery },
  ContactsListQuery | undefined
>("contacts/list", A, async (args) => {
  const query: ContactsListQuery = {
    search: args?.search || undefined,
    page: args?.page || 1,
    limit: args?.limit || 50,
  };
  const { data } = await api.get<CrmContactsListResponse>("/admin/contacts", {
    params: query,
  });
  return { ...data, query };
});

export const fetchPanelContact = createApiThunk<CrmContact, { id: number }>(
  "contacts/panel",
  A,
  async ({ id }) => {
    const { data } = await api.get<{ contact: CrmContact }>(
      `/admin/contacts/${id}`,
    );
    return data.contact;
  },
);

export const createAdminContact = createApiThunk<
  CrmContact,
  CrmContactWritePayload
>("contacts/create", A, async (payload) => {
  const { data } = await api.post<{ contact: CrmContact }>(
    "/admin/contacts",
    payload,
  );
  return data.contact;
});

export const updateAdminContact = createApiThunk<
  CrmContact,
  { id: number } & Partial<CrmContactWritePayload>
>("contacts/update", A, async ({ id, ...rest }) => {
  const { data } = await api.put<{ contact: CrmContact }>(
    `/admin/contacts/${id}`,
    rest,
  );
  return data.contact;
});

export const deleteAdminContact = createApiThunk<{ id: number }, { id: number }>(
  "contacts/delete",
  A,
  async ({ id }) => {
    await api.delete(`/admin/contacts/${id}`);
    return { id };
  },
);

export const convertAdminContact = createApiThunk<
  ConvertCrmContactResponse,
  { id: number; shared_phone_reason?: string }
>("contacts/convert", A, async ({ id, shared_phone_reason }) => {
  const { data } = await api.post<ConvertCrmContactResponse>(
    `/admin/contacts/${id}/convert`,
    shared_phone_reason ? { shared_phone_reason } : {},
  );
  return data;
});

const contactsSlice = createSlice({
  name: "contacts",
  initialState,
  reducers: {
    clearPanelContact(state) {
      state.panelContact = null;
    },
    clearContactsMutateError(state) {
      state.mutateError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminContacts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdminContacts.fulfilled, (state, action) => {
        state.loading = false;
        state.contacts = action.payload.contacts || [];
        state.pagination = action.payload.pagination || null;
        state.listQuery = action.payload.query;
      })
      .addCase(fetchAdminContacts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "errors.server";
      })
      .addCase(fetchPanelContact.pending, (state) => {
        state.panelLoading = true;
      })
      .addCase(fetchPanelContact.fulfilled, (state, action) => {
        state.panelLoading = false;
        state.panelContact = action.payload;
      })
      .addCase(fetchPanelContact.rejected, (state) => {
        state.panelLoading = false;
      })
      .addCase(createAdminContact.pending, (state) => {
        state.mutating = true;
        state.mutateError = null;
      })
      .addCase(createAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = [action.payload, ...state.contacts];
      })
      .addCase(createAdminContact.rejected, (state, action) => {
        state.mutating = false;
        state.mutateError = action.payload || "errors.server";
      })
      .addCase(updateAdminContact.pending, (state) => {
        state.mutating = true;
        state.mutateError = null;
      })
      .addCase(updateAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = state.contacts.map((c) =>
          c.id === action.payload.id ? action.payload : c,
        );
        state.panelContact = action.payload;
      })
      .addCase(updateAdminContact.rejected, (state, action) => {
        state.mutating = false;
        state.mutateError = action.payload || "errors.server";
      })
      .addCase(deleteAdminContact.pending, (state) => {
        state.mutating = true;
        state.mutateError = null;
      })
      .addCase(deleteAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = state.contacts.filter(
          (c) => c.id !== action.payload.id,
        );
        if (state.panelContact?.id === action.payload.id) {
          state.panelContact = null;
        }
      })
      .addCase(deleteAdminContact.rejected, (state, action) => {
        state.mutating = false;
        state.mutateError = action.payload || "errors.server";
      })
      .addCase(convertAdminContact.pending, (state) => {
        state.mutating = true;
        state.mutateError = null;
      })
      .addCase(convertAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = state.contacts.filter(
          (c) => c.id !== action.payload.contact_id,
        );
        if (state.panelContact?.id === action.payload.contact_id) {
          state.panelContact = null;
        }
      })
      .addCase(convertAdminContact.rejected, (state, action) => {
        state.mutating = false;
        state.mutateError = action.payload || "errors.server";
      });
  },
});

export const { clearPanelContact, clearContactsMutateError } =
  contactsSlice.actions;

export default contactsSlice.reducer;
