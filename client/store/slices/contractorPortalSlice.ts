import { createSlice } from "@reduxjs/toolkit";
import type {
  ContractorProjectDetail,
  ContractorProjectRow,
  ProjectDraw,
  ProjectPhoto,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

type State = {
  projects: ContractorProjectRow[];
  detail: ContractorProjectDetail | null;
  photos: ProjectPhoto[];
  draws: ProjectDraw[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
};

const initialState: State = {
  projects: [],
  detail: null,
  photos: [],
  draws: [],
  loading: false,
  error: null,
  saving: false,
  saveError: null,
};

const A = "contractor" as const;

export const fetchContractorProjects = createApiThunk("contractorPortal/projects", A, async () =>
  (await api.get<{ projects: ContractorProjectRow[] }>("/contractor/projects")).data.projects,
);
export const fetchContractorProject = createApiThunk<ContractorProjectDetail, string>(
  "contractorPortal/project",
  A,
  async (publicId) => (await api.get(`/contractor/projects/${publicId}`)).data,
);
export const fetchContractorPhotos = createApiThunk("contractorPortal/photos", A, async () =>
  (await api.get<{ photos: ProjectPhoto[] }>("/contractor/photos")).data.photos,
);
export const fetchContractorDraws = createApiThunk("contractorPortal/draws", A, async () =>
  (await api.get<{ draws: ProjectDraw[] }>("/contractor/draws")).data.draws,
);
/** Upload raw image bytes; the API stores them in Vercel Blob and attaches the photo. */
export const uploadContractorPhoto = createApiThunk<
  unknown,
  { publicId: string; file: File; caption?: string }
>("contractorMutation/photo", A, async ({ publicId, file, caption }) =>
  (
    await api.post(`/contractor/projects/${publicId}/photos/upload`, file, {
      headers: { "Content-Type": file.type },
      params: caption ? { caption } : undefined,
      transformRequest: [(data) => data],
    })
  ).data,
);
export const createContractorDraw = createApiThunk<
  unknown,
  { publicId: string; amount_cents: number; note?: string; submit?: boolean }
>("contractorMutation/draw", A, async ({ publicId, ...body }) =>
  (await api.post(`/contractor/projects/${publicId}/draws`, body)).data,
);
export const submitContractorDraw = createApiThunk<unknown, number>(
  "contractorMutation/submitDraw",
  A,
  async (id) => (await api.post(`/contractor/draws/${id}/submit`)).data,
);

const slice = createSlice({
  name: "contractorPortal",
  initialState,
  reducers: {
    clearContractorSaveError(state) {
      state.saveError = null;
    },
  },
  extraReducers: (builder) => {
    const pending = (s: State) => {
      s.loading = true;
      s.error = null;
    };
    const rejected = (s: State, a: { payload?: string }) => {
      s.loading = false;
      s.error = a.payload || "errors.server";
    };
    builder
      .addCase(fetchContractorProjects.pending, pending)
      .addCase(fetchContractorProjects.fulfilled, (s, a) => {
        s.loading = false;
        s.projects = a.payload;
      })
      .addCase(fetchContractorProjects.rejected, rejected)
      .addCase(fetchContractorProject.pending, pending)
      .addCase(fetchContractorProject.fulfilled, (s, a) => {
        s.loading = false;
        s.detail = a.payload;
      })
      .addCase(fetchContractorProject.rejected, rejected)
      .addCase(fetchContractorPhotos.pending, pending)
      .addCase(fetchContractorPhotos.fulfilled, (s, a) => {
        s.loading = false;
        s.photos = a.payload;
      })
      .addCase(fetchContractorPhotos.rejected, rejected)
      .addCase(fetchContractorDraws.pending, pending)
      .addCase(fetchContractorDraws.fulfilled, (s, a) => {
        s.loading = false;
        s.draws = a.payload;
      })
      .addCase(fetchContractorDraws.rejected, rejected);
    for (const m of [uploadContractorPhoto, createContractorDraw, submitContractorDraw]) {
      builder
        .addCase(m.pending, (s) => {
          s.saving = true;
          s.saveError = null;
        })
        .addCase(m.fulfilled, (s) => {
          s.saving = false;
        })
        .addCase(m.rejected, (s, a) => {
          s.saving = false;
          s.saveError = a.payload || "errors.server";
        });
    }
  },
});

export const { clearContractorSaveError } = slice.actions;
export default slice.reducer;
