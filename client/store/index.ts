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
import adminMcpReducer from "./slices/adminMcpSlice";
import conversationsReducer from "./slices/conversationsSlice";
import contactsReducer from "./slices/contactsSlice";
import voiceReducer from "./slices/voiceSlice";
import adminNotificationsReducer from "./slices/adminNotificationsSlice";
import campaignsReducer from "./slices/campaignsSlice";
import contractorApplicationReducer from "./slices/contractorApplicationSlice";
import adminContractorApplicationReducer from "./slices/adminContractorApplicationSlice";
import personConflictReducer from "./slices/personConflictSlice";
import duplicatesReducer from "./slices/duplicatesSlice";
import clientRevertReducer from "./slices/clientRevertSlice";
import affiliateHelpReducer from "./slices/affiliateHelpSlice";
import schedulerReducer from "./slices/schedulerSlice";
import bookingReducer from "./slices/bookingSlice";
import affiliateLinkReducer from "./slices/affiliateLinkSlice";
import contractorBillingReducer from "./slices/contractorBillingSlice";
import billingAdminReducer from "./slices/billingAdminSlice";
import commandCenterReducer from "./slices/commandCenterSlice";
import recordsReducer from "./slices/recordsSlice";
import eventMediaReducer from "./slices/eventMediaSlice";
import affiliateOnboardingReducer from "./slices/affiliateOnboardingSlice";
import phoneLinesReducer from "./slices/phoneLinesSlice";
import dealStatusReducer from "./slices/dealStatusSlice";

export const store = configureStore({
  // Photo uploads pass a `File` through a thunk arg (never stored in state).
  // Ably TokenRequest is opaque SDK state — keep it out of serializable checks.
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: {
        ignoredActionPaths: ["meta.arg.file", "payload.tokenRequest"],
        ignoredPaths: [
          "conversations.ablyTokenRequest",
          "adminNotifications.ablyTokenRequest",
        ],
      },
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
    adminMcp: adminMcpReducer,
    conversations: conversationsReducer,
    contacts: contactsReducer,
    voice: voiceReducer,
    adminNotifications: adminNotificationsReducer,
    campaigns: campaignsReducer,
    contractorApplication: contractorApplicationReducer,
    adminContractorApplication: adminContractorApplicationReducer,
    personConflict: personConflictReducer,
    duplicates: duplicatesReducer,
    clientRevert: clientRevertReducer,
    affiliateHelp: affiliateHelpReducer,
    scheduler: schedulerReducer,
    booking: bookingReducer,
    affiliateLink: affiliateLinkReducer,
    contractorBilling: contractorBillingReducer,
    billingAdmin: billingAdminReducer,
    commandCenter: commandCenterReducer,
    records: recordsReducer,
    eventMedia: eventMediaReducer,
    affiliateOnboarding: affiliateOnboardingReducer,
    phoneLines: phoneLinesReducer,
    dealStatus: dealStatusReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
