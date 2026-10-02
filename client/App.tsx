import "./global.css";

import { useEffect } from "react";
import { HelmetProvider } from "react-helmet-async";
import {
  BrowserRouter,
  Navigate,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { Provider } from "react-redux";
import { useTranslation } from "react-i18next";
import { store } from "./store";
import Index from "./pages/Index";
import EventDetail from "./pages/EventDetail";
import GetCreditReport from "./pages/GetCreditReport";
import About from "./pages/About";
import Partners from "./pages/Partners";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/auth/AdminLogin";
import AffiliateLogin from "./pages/auth/AffiliateLogin";
import ContractorLogin from "./pages/auth/ContractorLogin";
import ClientLogin from "./pages/auth/ClientLogin";
import AffiliateSignup from "./pages/auth/AffiliateSignup";
import ContractorInvite from "./pages/auth/ContractorInvite";
import ClientInvite from "./pages/auth/ClientInvite";
import Start from "./pages/Start";
import ReferralLanding from "./pages/ReferralLanding";
import ReferralExpired from "./pages/ReferralExpired";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminLeads from "./pages/admin/Leads";
import AdminEvents from "./pages/admin/Events";
import AdminEventDetail from "./pages/admin/EventDetail";
import AdminProjects from "./pages/admin/Projects";
import AdminProjectDetail from "./pages/admin/ProjectDetail";
import AdminClients from "./pages/admin/Clients";
import AdminClientDetail from "./pages/admin/ClientDetail";
import AdminAffiliates from "./pages/admin/Affiliates";
import AdminAffiliateDetail from "./pages/admin/AffiliateDetail";
import AdminContractors from "./pages/admin/Contractors";
import AdminContractorDetail from "./pages/admin/ContractorDetail";
import AdminDraws from "./pages/admin/Draws";
import AdminCommissions from "./pages/admin/Commissions";
import AdminPlans from "./pages/admin/Plans";
import AdminStaff from "./pages/admin/Staff";
import AdminSettings from "./pages/admin/Settings";
import AdminProfile from "./pages/admin/Profile";
import AdminMcpConsent from "./pages/admin/McpConsent";
import AffiliateLayout from "./pages/affiliate/AffiliateLayout";
import AffiliateDashboard from "./pages/affiliate/Dashboard";
import AffiliateClients from "./pages/affiliate/Clients";
import AffiliateCommissions from "./pages/affiliate/Commissions";
import AffiliateTrackingLink from "./pages/affiliate/TrackingLink";
import AffiliateProfile from "./pages/affiliate/Profile";
import ContractorLayout from "./pages/contractor/ContractorLayout";
import ContractorDashboard from "./pages/contractor/Dashboard";
import ContractorProjects from "./pages/contractor/Projects";
import ContractorProjectDetail from "./pages/contractor/ProjectDetail";
import ContractorPhotos from "./pages/contractor/Photos";
import ContractorDraws from "./pages/contractor/Draws";
import ClientLayout from "./pages/client/ClientLayout";
import ClientDashboard from "./pages/client/Dashboard";
import ClientProject from "./pages/client/Project";
import ClientDocuments from "./pages/client/Documents";
import LegacyPortalRedirect from "./components/portal/LegacyPortalRedirect";
import { captureReferralFromUrl } from "./lib/referral";

function DocumentLang() {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = i18n.language?.startsWith("es")
      ? "es"
      : "en";
  }, [i18n.language]);
  return null;
}

/** Capture ?ref=CODE from any landing URL (30-day attribution window). */
function ReferralCapture() {
  const { search } = useLocation();
  useEffect(() => {
    captureReferralFromUrl(search);
  }, [search]);
  return null;
}

export default function App() {
  return (
    <Provider store={store}>
      <HelmetProvider>
        <BrowserRouter>
          <DocumentLang />
          <ReferralCapture />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/events/:slug" element={<EventDetail />} />
            <Route path="/about" element={<About />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/get-credit-report" element={<GetCreditReport />} />
            <Route path="/start" element={<Start />} />
            <Route path="/r/expired" element={<ReferralExpired />} />
            <Route path="/r/:code" element={<ReferralLanding />} />

            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/mcp-consent" element={<AdminMcpConsent />} />
            <Route path="/affiliate/login" element={<AffiliateLogin />} />
            <Route path="/affiliate/signup" element={<AffiliateSignup />} />
            <Route path="/contractor/login" element={<ContractorLogin />} />
            <Route
              path="/contractor/invite/:token"
              element={<ContractorInvite />}
            />
            <Route path="/client/login" element={<ClientLogin />} />
            <Route path="/client/invite/:token" element={<ClientInvite />} />

            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="profile" element={<AdminProfile />} />
              <Route path="leads" element={<AdminLeads />} />
              <Route path="events" element={<AdminEvents />} />
              <Route path="events/:id" element={<AdminEventDetail />} />
              <Route path="projects" element={<AdminProjects />} />
              <Route
                path="projects/:publicId"
                element={<AdminProjectDetail />}
              />
              <Route path="clients" element={<AdminClients />} />
              <Route path="clients/:id" element={<AdminClientDetail />} />
              <Route path="affiliates" element={<AdminAffiliates />} />
              <Route path="affiliates/:id" element={<AdminAffiliateDetail />} />
              <Route path="contractors" element={<AdminContractors />} />
              <Route path="contractors/:id" element={<AdminContractorDetail />} />
              <Route path="draws" element={<AdminDraws />} />
              <Route path="commissions" element={<AdminCommissions />} />
              <Route path="plans" element={<AdminPlans />} />
              <Route path="staff" element={<AdminStaff />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>

            <Route path="/affiliate" element={<AffiliateLayout />}>
              <Route index element={<AffiliateDashboard />} />
              <Route path="clients" element={<AffiliateClients />} />
              <Route path="commissions" element={<AffiliateCommissions />} />
              <Route path="link" element={<AffiliateTrackingLink />} />
              <Route path="profile" element={<AffiliateProfile />} />
            </Route>

            <Route path="/contractor" element={<ContractorLayout />}>
              <Route index element={<ContractorDashboard />} />
              <Route path="projects" element={<ContractorProjects />} />
              <Route
                path="projects/:publicId"
                element={<ContractorProjectDetail />}
              />
              <Route path="photos" element={<ContractorPhotos />} />
              <Route path="draws" element={<ContractorDraws />} />
            </Route>

            <Route path="/client" element={<ClientLayout />}>
              <Route index element={<ClientDashboard />} />
              <Route path="project" element={<ClientProject />} />
              <Route path="documents" element={<ClientDocuments />} />
            </Route>

            {/* Legacy client portal URLs (emails, bookmarks) */}
            <Route path="/portal" element={<LegacyPortalRedirect />} />
            <Route path="/portal/*" element={<LegacyPortalRedirect />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </HelmetProvider>
    </Provider>
  );
}
