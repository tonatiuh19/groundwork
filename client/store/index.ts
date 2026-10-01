import { configureStore } from "@reduxjs/toolkit";
import leadReducer from "./slices/leadSlice";
import gcrReducer from "./slices/getCreditReportSlice";
import contactReducer from "./slices/contactSlice";
import portalAuthReducer from "./slices/portalAuthSlice";
import adminPortalReducer from "./slices/adminPortalSlice";
import affiliatePortalReducer from "./slices/affiliatePortalSlice";
import contractorPortalReducer from "./slices/contractorPortalSlice";
import clientPortalReducer from "./slices/clientPortalSlice";
import onboardingReducer from "./slices/onboardingSlice";
import enrollReducer from "./slices/enrollSlice";
import publicEventsReducer from "./slices/publicEventsSlice";

export const store = configureStore({
  // Photo uploads pass a `File` through a thunk arg (never stored in state).
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: { ignoredActionPaths: ["meta.arg.file"] },
    }),
  reducer: {
    lead: leadReducer,
    gcr: gcrReducer,
    contact: contactReducer,
    portalAuth: portalAuthReducer,
    adminPortal: adminPortalReducer,
    affiliatePortal: affiliatePortalReducer,
    contractorPortal: contractorPortalReducer,
    clientPortal: clientPortalReducer,
    onboarding: onboardingReducer,
    enroll: enrollReducer,
    publicEvents: publicEventsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
