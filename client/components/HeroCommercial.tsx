import { useEffect, useRef, useState } from "react";
import { Expand } from "lucide-react";
import { useTranslation } from "react-i18next";
import VideoLightbox from "@/components/VideoLightbox";

const COMMERCIAL_SRC = "/adu/groundwork-adu-commercial.mp4";
const COMMERCIAL_POSTER = "/adu/groundwork-adu-commercial-poster.jpg";

/**
 * Home hero commercial — muted autoplay on load (and whenever back in view),
 * pause when scrolled away. iOS Low Power Mode can still block autoplay; the
 * poster stays and "Watch full" plays it.
 * Silent clip; open full player in a cinematic modal with native controls.
 */
export default function HeroCommercial() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React sets `muted` only as a property, never as the HTML attribute, and
    // iOS Safari requires the attribute for muted autoplay. Set both.
    video.defaultMuted = true;
    video.muted = true;
    video.setAttribute("muted", "");
    let inView = true;
    const tryPlay = () => {
      if (lightboxOpen || !inView || document.visibilityState !== "visible") return;
      video.muted = true;
      void video.play().catch(() => {
        /* Autoplay blocked (e.g. iOS Low Power Mode) — poster remains */
      });
    };
    tryPlay();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
        if (inView && !lightboxOpen) tryPlay();
        else video.pause();
      },
      { threshold: [0, 0.35, 0.6] },
    );
    observer.observe(video);

    // Opened in a background tab / phone locked while loading: the browser
    // defers autoplay and the observer won't fire again — resume on return.
    const onVisible = () => tryPlay();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [lightboxOpen]);

  useEffect(() => {
    if (lightboxOpen) {
      videoRef.current?.pause();
    }
  }, [lightboxOpen]);

  return (
    <div className="hero-art hero-art-commercial">
      <div className="hero-commercial-frame">
        <video
          ref={videoRef}
          className="hero-image hero-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={COMMERCIAL_POSTER}
          aria-label={t("hero.videoAria")}
        >
          <source src={COMMERCIAL_SRC} type="video/mp4" />
        </video>
        <button
          type="button"
          className="hero-commercial-expand"
          onClick={() => setLightboxOpen(true)}
          aria-label={t("hero.openVideo")}
        >
          <Expand size={15} aria-hidden />
          <span>{t("hero.watchFull")}</span>
        </button>
      </div>

      <VideoLightbox
        open={lightboxOpen}
        src={COMMERCIAL_SRC}
        poster={COMMERCIAL_POSTER}
        title={t("hero.videoAria")}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
