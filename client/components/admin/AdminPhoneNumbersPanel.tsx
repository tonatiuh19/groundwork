/**
 * Brand Twilio line assignment — list, assign to staff, sync from Twilio.
 * Used on Settings and Staff.
 */
import { useEffect, useMemo } from "react";
import { Phone, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminStaff } from "@/store/slices/adminPortalSlice";
import {
  assignAdminPhoneNumber,
  fetchAdminPhoneNumbers,
  syncTwilioPhoneNumbers,
} from "@/store/slices/conversationsSlice";
import {
  DataTable,
  ErrorNote,
  InlineSelect,
  useRowBusy,
} from "@/components/portal/kit";
import { adminCan } from "@shared/api";

const PHONE_ROLES = new Set(["super_admin", "admin", "agent"]);

type Props = {
  /** Extra class on the card wrapper. */
  className?: string;
};

export function AdminPhoneNumbersPanel({ className }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const staff = useAppSelector((s) => s.adminPortal.staff.items);
  const {
    phoneNumbers,
    phoneNumbersLoading,
    phoneNumbersError,
    phoneMutating,
  } = useAppSelector((s) => s.conversations);
  const phoneBusy = useRowBusy();

  const canAssign =
    me?.role === "super_admin" || me?.role === "admin";
  const canSync = me?.role === "super_admin" || adminCan(me?.role, "staff");

  const assignableStaff = useMemo(
    () =>
      staff.filter((s) => s.status === "active" && PHONE_ROLES.has(s.role)),
    [staff],
  );

  useEffect(() => {
    void dispatch(fetchAdminPhoneNumbers());
    if (canAssign && staff.length === 0) {
      void dispatch(fetchAdminStaff());
    }
  }, [dispatch, canAssign, staff.length]);

  return (
    <section className={className ? `pf-card ${className}` : "pf-card"}>
      <div className="pf-card-top">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2">
            <Phone size={18} aria-hidden />
            {t("admin.phoneNumbersTitle")}
          </h3>
          <p className="pf-muted">{t("admin.phoneNumbersLead")}</p>
        </div>
        {canSync ? (
          <button
            type="button"
            className="pf-btn pf-btn--gold"
            disabled={phoneMutating}
            onClick={() => void dispatch(syncTwilioPhoneNumbers())}
          >
            <RefreshCw
              size={15}
              className={phoneMutating ? "spin" : undefined}
              aria-hidden
            />
            {t("admin.syncTwilio")}
          </button>
        ) : null}
      </div>
      <ErrorNote error={phoneNumbersError} />
      <DataTable
        rows={phoneNumbers}
        loading={phoneNumbersLoading}
        emptyKey="admin.phoneNumbersEmpty"
        rowKey={(n) => n.id}
        columns={[
          {
            key: "e164",
            headerKey: "admin.phoneNumber",
            render: (n) => (
              <>
                <strong>{n.e164}</strong>
                {n.friendly_name ? (
                  <>
                    <br />
                    <span className="pf-muted">{n.friendly_name}</span>
                  </>
                ) : null}
                {!n.is_active ? (
                  <>
                    <br />
                    <span className="pf-muted">{t("accountStatus.inactive")}</span>
                  </>
                ) : null}
              </>
            ),
          },
          {
            key: "caps",
            headerKey: "admin.phoneCapabilities",
            render: (n) => {
              const caps = n.capabilities || {};
              const labels = [
                caps.sms ? t("admin.capSms") : null,
                caps.mms ? t("admin.capMms") : null,
                caps.voice ? t("admin.capVoice") : null,
              ].filter(Boolean);
              return labels.length ? labels.join(" · ") : "—";
            },
          },
          {
            key: "assigned",
            headerKey: "admin.phoneAssignedTo",
            render: (n) => {
              if (!canAssign) {
                return (
                  n.assigned_admin_name ||
                  (n.assigned_admin_id != null
                    ? `#${n.assigned_admin_id}`
                    : t("pf.none"))
                );
              }
              const options = [
                { value: "", label: t("pf.none") },
                ...assignableStaff.map((s) => ({
                  value: String(s.id),
                  label: `${s.first_name} ${s.last_name}`,
                })),
              ];
              if (
                n.assigned_admin_id != null &&
                !options.some((o) => o.value === String(n.assigned_admin_id))
              ) {
                options.push({
                  value: String(n.assigned_admin_id),
                  label: n.assigned_admin_name || `#${n.assigned_admin_id}`,
                });
              }
              return (
                <InlineSelect
                  ariaLabel={t("admin.phoneAssignedTo")}
                  value={
                    n.assigned_admin_id != null
                      ? String(n.assigned_admin_id)
                      : ""
                  }
                  disabled={phoneBusy.isRowLocked(n.id) || phoneMutating}
                  options={options}
                  onChange={(v) => {
                    void phoneBusy.run(n.id, "assign", async () => {
                      const r = await dispatch(
                        assignAdminPhoneNumber({
                          id: n.id,
                          assigned_admin_id: v ? Number(v) : null,
                        }),
                      );
                      return assignAdminPhoneNumber.fulfilled.match(r);
                    });
                  }}
                />
              );
            },
          },
        ]}
      />
    </section>
  );
}
