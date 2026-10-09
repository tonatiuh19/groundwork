import type { ContractorApplicationData } from "../shared/contractorApplication";
import { emptyContractorApplicationData } from "../shared/contractorApplication";

/** A complete, submit-ready application. */
export function completeCpqData(): ContractorApplicationData {
  const d = emptyContractorApplicationData();
  Object.assign(d.company, {
    legal_name: "Crew Builders LLC",
    address: "1 Main St",
    city: "Fontana",
    state: "CA",
    zip: "92335",
    contact_name: "Ana Crew",
    phone: "9495550100",
    email: "ana@example.com",
    year_established: "2012",
    entity_type: "llc",
    ein: "12-3456789",
    employee_count: "14",
    service_area: "San Bernardino, Riverside",
  });
  Object.assign(d.licensing, {
    cslb_license_number: "1023456",
    classifications: "B",
    license_expires_on: "2028-03-31",
    qualifier_name: "Ana Crew",
    qualifier_status: "active",
    bond_company: "Surety Co",
    bond_number: "BND-1",
    bond_amount: "$25,000",
    license_disciplined: "no",
    epa_rrp_certified: "no",
  });
  const policy = { carrier: "Carrier", policy_number: "P-1", limits: "$1M/$2M", expires_on: "2027-01-01" };
  d.insurance.general_liability = { ...policy };
  d.insurance.workers_comp = { ...policy };
  d.insurance.commercial_auto = { ...policy };
  d.insurance.wc_exempt = "no";
  d.insurance.builders_risk_available = "yes";
  Object.assign(d.experience, {
    years_building_adus: "6",
    adus_completed_3yrs: "21",
    typical_value_range: "$180k–$320k",
    max_concurrent_projects: "5",
    project_types: ["detached", "garage_conversion"],
  });
  d.experience.recent_projects[0] = {
    address: "9 Elm, Fontana",
    type_sqft: "Detached / 750",
    contract_value: "$240,000",
    completed_on: "2026-05-01",
  };
  d.personnel[0] = { name: "Ana Crew", role: "RMO", years_experience: "15", certifications: "B" };
  d.references.clients = d.references.clients.map((_, i) => ({
    name: `Client ${i}`,
    project_address: "x",
    phone: "9495550101",
    email: "",
  }));
  Object.assign(d.financial, { bank_name: "Bank", bank_phone: "9495550102", revenue_recent_year: "$3M" });
  Object.assign(d.safety, {
    has_iipp: "yes",
    osha_citations_3yrs: "no",
    lawsuits_5yrs: "no",
    cslb_complaints_5yrs: "no",
    liens_5yrs: "no",
    failed_to_complete: "no",
    bankruptcy_7yrs: "no",
  });
  d.warranty = { period: "2 years", terms: "Workmanship, roofing, plumbing" };
  return d;
}

