import { useEffect, useRef, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Camera, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAffiliateProfile,
  updateAffiliateProfile,
  uploadAffiliateAvatar,
} from "@/store/slices/affiliateProfileSlice";
import { setPortalUser } from "@/store/slices/portalAuthSlice";
import {
  ErrorNote,
  Loading,
  PageHeader,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import AvatarCropModal from "@/components/portal/AvatarCropModal";
import { slugifyAffiliate } from "@/lib/affiliateSlug";
import { buildAffiliateTrackingUrl } from "@/lib/referral";
import { yupAffiliateSlug, yupPhoneOptional } from "@/lib/validation";

export default function AffiliateProfile() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.portalAuth.affiliate.user);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    void dispatch(fetchAffiliateProfile())
      .unwrap()
      .then((p) => {
        setBio(p.bio);
        setCompany(p.company);
        setSlug(p.slug);
        setReferralCode(p.referral_code);
      })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, [dispatch]);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  if (!user) return null;
  if (loadingProfile) {
    return (
      <div className="portal-page">
        <PageHeader titleKey="aff.profileTitle" leadKey="aff.profileLead" />
        <Loading />
      </div>
    );
  }

  const initials =
    `${user.first_name?.[0] || ""}${user.last_name?.[0] || ""}`.toUpperCase() ||
    "?";

  return (
    <div className="portal-page">
      <PageHeader titleKey="aff.profileTitle" leadKey="aff.profileLead" />
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
              <span>{t("aff.profileChangePhoto")}</span>
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
            {company ? <p className="pf-muted">{company}</p> : null}
          </div>
        </div>

        <Formik
          enableReinitialize
          initialValues={{
            first_name: user.first_name || "",
            last_name: user.last_name || "",
            phone: user.phone || "",
            company: company || "",
            bio: bio || "",
            slug: slug || "",
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
            phone: yupPhoneOptional(t("validation.phoneMin")),
            company: Yup.string().trim().max(200),
            bio: Yup.string().trim().max(500),
            slug: yupAffiliateSlug(
              t("validation.slugFormat"),
              t("validation.slugReserved"),
            ),
            preferred_language: Yup.string().oneOf(["en", "es"]).required(),
          })}
          onSubmit={async (values) => {
            setSaving(true);
            setSaved(false);
            setError(null);
            const nextSlug = values.slug.trim()
              ? slugifyAffiliate(values.slug.trim())
              : null;
            const result = await dispatch(
              updateAffiliateProfile({
                first_name: values.first_name.trim(),
                last_name: values.last_name.trim(),
                phone: values.phone.trim() || null,
                company: values.company.trim() || null,
                bio: values.bio.trim() || null,
                slug: nextSlug,
                preferred_language: values.preferred_language as "en" | "es",
              }),
            );
            setSaving(false);
            if (updateAffiliateProfile.fulfilled.match(result)) {
              dispatch(
                setPortalUser({
                  actor: "affiliate",
                  user: result.payload.user,
                }),
              );
              setCompany(result.payload.profile.company);
              setBio(result.payload.profile.bio);
              setSlug(result.payload.profile.slug);
              setReferralCode(result.payload.profile.referral_code);
              const next = result.payload.user.preferred_language;
              const cur = i18n.language?.startsWith("es") ? "es" : "en";
              if (next !== cur) void i18n.changeLanguage(next);
              setSaved(true);
            } else {
              setError((result.payload as string) || "errors.server");
            }
          }}
        >
          {({ values }) => {
            const previewUrl = referralCode
              ? buildAffiliateTrackingUrl({
                  referral_code: referralCode,
                  slug: values.slug.trim()
                    ? slugifyAffiliate(values.slug.trim())
                    : null,
                })
              : "";
            return (
              <Form className="pf-form pf-profile-form">
                <TextField name="email" labelKey="form.email" disabled />
                <div className="pf-form-grid">
                  <TextField name="first_name" labelKey="form.firstName" />
                  <TextField name="last_name" labelKey="form.lastName" />
                </div>
                <TextField name="phone" labelKey="form.phone" />
                <TextField name="company" labelKey="affSignup.company" />
                <TextField
                  name="slug"
                  labelKey="aff.profileSlug"
                  placeholder={t("admin.slugPlaceholder")}
                />
                <p className="pf-muted">{t("aff.profileSlugHelp")}</p>
                {previewUrl ? (
                  <p className="pf-muted pf-slug-preview">
                    {t("aff.profileSlugPreview")}:{" "}
                    <code className="pf-code">{previewUrl}</code>
                  </p>
                ) : null}
                <TextField
                  name="bio"
                  labelKey="aff.profileBio"
                  as="textarea"
                  rows={4}
                />
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
            );
          }}
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
          const result = await dispatch(uploadAffiliateAvatar({ file: blob }));
          setAvatarBusy(false);
          if (uploadAffiliateAvatar.fulfilled.match(result)) {
            dispatch(setPortalUser({ actor: "affiliate", user: result.payload }));
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
