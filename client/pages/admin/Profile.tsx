import { useEffect, useRef, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Camera, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  updateAdminProfile,
  uploadAdminAvatar,
} from "@/store/slices/adminProfileSlice";
import { setPortalUser } from "@/store/slices/portalAuthSlice";
import {
  ErrorNote,
  PageHeader,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import AvatarCropModal from "@/components/portal/AvatarCropModal";

export default function AdminProfile() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.portalAuth.admin.user);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  if (!user) return null;

  const initials =
    `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() ||
    "?";

  return (
    <div className="portal-page">
      <PageHeader titleKey="admin.profileTitle" leadKey="admin.profileLead" />
      <ErrorNote error={error} />
      {saved ? <p className="pf-success-inline">{t("pf.saved")}</p> : null}

      <section className="pf-card pf-profile">
        <div className="pf-profile-hero">
          <div className="pf-profile-avatar-wrap">
            {user.avatar_url ? (
              <img className="pf-profile-avatar" src={user.avatar_url} alt="" />
            ) : (
              <div
                className="pf-profile-avatar pf-profile-avatar--fallback"
                aria-hidden
              >
                {initials}
              </div>
            )}
            <button
              type="button"
              className="pf-profile-avatar-edit"
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
            >
              {avatarBusy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Camera size={16} />
              )}
              <span>{t("admin.profileChangePhoto")}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (cropSrc) URL.revokeObjectURL(cropSrc);
                setCropSrc(URL.createObjectURL(file));
              }}
            />
          </div>
          <div className="pf-profile-hero-copy">
            <h2>
              {user.first_name} {user.last_name}
            </h2>
            <p className="pf-muted">{user.email}</p>
            {user.role ? (
              <span className="portal-role portal-role--on-paper">
                {t(`role.${user.role}`)}
              </span>
            ) : null}
          </div>
        </div>

        <Formik
          enableReinitialize
          initialValues={{
            first_name: user.first_name || "",
            last_name: user.last_name || "",
            phone: user.phone || "",
            preferred_language: user.preferred_language || "en",
            email: user.email,
          }}
          validationSchema={Yup.object({
            first_name: Yup.string()
              .trim()
              .required(t("validation.firstNameRequired")),
            last_name: Yup.string()
              .trim()
              .required(t("validation.lastNameRequired")),
            phone: Yup.string()
              .trim()
              .test("phone", t("validation.phoneMin"), (v) => {
                if (!v) return true;
                return v.replace(/\D/g, "").length >= 10;
              }),
            preferred_language: Yup.string().oneOf(["en", "es"]).required(),
          })}
          onSubmit={async (values) => {
            setSaving(true);
            setSaved(false);
            setError(null);
            const result = await dispatch(
              updateAdminProfile({
                first_name: values.first_name.trim(),
                last_name: values.last_name.trim(),
                phone: values.phone.trim() || null,
                preferred_language: values.preferred_language as "en" | "es",
              }),
            );
            setSaving(false);
            if (updateAdminProfile.fulfilled.match(result)) {
              dispatch(setPortalUser({ actor: "admin", user: result.payload }));
              const next = result.payload.preferred_language;
              const cur = i18n.language?.startsWith("es") ? "es" : "en";
              if (next !== cur) void i18n.changeLanguage(next);
              setSaved(true);
            } else {
              setError((result.payload as string) || "errors.server");
            }
          }}
        >
          <Form className="pf-form pf-profile-form">
            <TextField name="email" labelKey="form.email" disabled />
            <p className="pf-muted pf-profile-email-hint">
              {t("admin.profileEmailHint")}
            </p>
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
            </div>
            <TextField name="phone" labelKey="form.phone" />
            <SelectField
              name="preferred_language"
              labelKey="admin.profileLanguage"
              options={[
                { value: "en", label: t("lang.en") },
                { value: "es", label: t("lang.es") },
              ]}
            />
            <SubmitButton busy={saving} labelKey="pf.save" />
          </Form>
        </Formik>
      </section>

      <AvatarCropModal
        open={Boolean(cropSrc)}
        imageSrc={cropSrc}
        busy={avatarBusy}
        onClose={() => {
          if (cropSrc) URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
        }}
        onSave={async (blob) => {
          setAvatarBusy(true);
          setError(null);
          const result = await dispatch(uploadAdminAvatar({ file: blob }));
          setAvatarBusy(false);
          if (uploadAdminAvatar.fulfilled.match(result)) {
            dispatch(setPortalUser({ actor: "admin", user: result.payload }));
            if (cropSrc) URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
            setSaved(true);
          } else {
            setError((result.payload as string) || "errors.server");
          }
        }}
      />
    </div>
  );
}
