"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../../UserContext";
import { authClient } from "@/app/lib/auth-client";
import { useLogoUrl } from "@/app/lib/logoUrlClient";

// --- helpers ---
function slugify(input: string, maxLen = 60): string {
  const ascii = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, maxLen)
    .replace(/^-+|-+$/g, "");
}
function looksLikeGoogleBusinessLink(urlStr?: string) {
  if (!urlStr) return true;
  try {
    const u = new URL(urlStr);
    return ["google.com", "business.google.com", "g.page", "maps.app.goo.gl", "maps.google.com"]
      .some((d) => u.hostname.includes(d));
  } catch {
    return false;
  }
}

export default function UserSettings() {
  const router = useRouter();
  const { name: currentSlug, display } = useUser();
  const { data: session } = authClient.useSession();
  const authUserId = session?.user?.id ?? "";
  const accountEmail = session?.user?.email ?? "";

  // logo
  const { url: logoUrl, refresh: refreshLogoUrl } = useLogoUrl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadIsError, setUploadIsError] = useState(false);

  // single-save fields
  const [description, setDescription] = useState("");
  const [googleLink, setGoogleLink] = useState("");
  const googleLinkIsValid = useMemo(() => looksLikeGoogleBusinessLink(googleLink), [googleLink]);

  const [slugInput, setSlugInput] = useState(currentSlug || "");
  const prettyURL = useMemo(
    () => (slugInput ? `/${slugify(slugInput)}/dashboard` : "/[your-business]/dashboard"),
    [slugInput]
  );

  // slug availability
  const [checkingAvail, setCheckingAvail] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!slugInput || slugInput === currentSlug) {
      setIsAvailable(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setCheckingAvail(true);
      try {
        const q = new URLSearchParams({ name: slugInput, email: accountEmail || "" }).toString();
        const res = await fetch(`/api/name-availability?${q}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (alive) setIsAvailable(Boolean(data?.available));
      } catch {
        if (alive) setIsAvailable(null);
      } finally {
        if (alive) setCheckingAvail(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slugInput, accountEmail, currentSlug]);

  // load business info
  const [infoLoading, setInfoLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!authUserId) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/settings/user-settings/get-business-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok) {
          setDescription(typeof data?.description === "string" ? data.description : "");
          setGoogleLink(
            typeof data?.googleBusinessLink === "string" ? data.googleBusinessLink : ""
          );
        } else {
          setDescription("");
          setGoogleLink("");
        }
      } catch {
        if (alive) {
          setDescription("");
          setGoogleLink("");
        }
      } finally {
        if (alive) setInfoLoading(false);
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [authUserId]);

  // consolidated save state
  const [savingAll, setSavingAll] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveIsError, setSaveIsError] = useState(false);

  // logo helpers
  const onPick = (f?: File) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setLocalPreview((e.target?.result as string) || null);
    reader.readAsDataURL(f);
  };
  const handleUploadLogo = async () => {
    setUploadMsg(null);
    setUploadIsError(false);
    if (!authUserId) {
      setUploadMsg("Missing user session.");
      setUploadIsError(true);
      return;
    }
    if (!file) {
      setUploadMsg("Please choose an image first.");
      setUploadIsError(true);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("userId", authUserId);

      const res = await fetch("/api/upload-company-logo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setUploadMsg(data?.message || data?.error || "Upload failed.");
        setUploadIsError(true);
      } else {
        const signedUrl = data?.signedUrl || data?.user?.company_logo_url || null;
        if (signedUrl) setLocalPreview(signedUrl);
        void refreshLogoUrl();
        setUploadMsg("Logo updated.");
        setUploadIsError(false);
      }
    } catch {
      setUploadMsg("Network error during upload.");
      setUploadIsError(true);
    } finally {
      setUploading(false);
    }
  };

  // save all (desc + google link + slug)
  const handleSaveAll = async () => {
    setSaveMsg(null);
    setSaveIsError(false);

    if (!authUserId) {
      setSaveMsg("Missing user session.");
      setSaveIsError(true);
      return;
    }
    if (googleLink && !googleLinkIsValid) {
      setSaveMsg("Please enter a valid Google Business / Maps URL.");
      setSaveIsError(true);
      return;
    }
    const cleaned = slugify(slugInput);
    const slugChanged = cleaned !== currentSlug;
    if (slugChanged && isAvailable === false) {
      setSaveMsg("That dashboard URL is already taken.");
      setSaveIsError(true);
      return;
    }
    if (!cleaned) {
      setSaveMsg("Please enter a valid dashboard URL (letters & numbers).");
      setSaveIsError(true);
      return;
    }

    type OpName = "description" | "google" | "slug";
    type OpResult = { name: OpName; ok: boolean; message?: string };

    setSavingAll(true);
    try {
      const ops: Promise<OpResult>[] = [];

      // Description
      ops.push(
        fetch("/api/settings/user-settings/update-business-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId, description: description || null }),
        })
          .then(async (res): Promise<OpResult> => {
            if (res.ok) return { name: "description" as const, ok: true };
            const data = await res.json().catch(() => ({}));
            return {
              name: "description" as const,
              ok: false,
              message: String(data?.message || data?.error || "Could not save description."),
            };
          })
          .catch((): OpResult => ({
            name: "description" as const,
            ok: false,
            message: "Network error saving description.",
          }))
      );

      // Google link
      ops.push(
        fetch("/api/settings/user-settings/update-google-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUserId, googleBusinessLink: googleLink || null }),
        })
          .then(async (res): Promise<OpResult> => {
            if (res.ok) return { name: "google" as const, ok: true };
            const data = await res.json().catch(() => ({}));
            return {
              name: "google" as const,
              ok: false,
              message: String(data?.message || data?.error || "Could not save Google link."),
            };
          })
          .catch((): OpResult => ({
            name: "google" as const,
            ok: false,
            message: "Network error saving Google link.",
          }))
      );

      // Slug
      if (slugChanged) {
        if (!accountEmail) {
          ops.push(
            Promise.resolve<OpResult>({
              name: "slug",
              ok: false,
              message: "Missing account email for slug update.",
            })
          );
        } else {
          ops.push(
            fetch("/api/update-slug", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: authUserId, newName: cleaned, email: accountEmail }),
            })
              .then(async (res): Promise<OpResult> => {
                if (res.ok) return { name: "slug" as const, ok: true };
                const data = await res.json().catch(() => ({}));
                return {
                  name: "slug" as const,
                  ok: false,
                  message: String(data?.message || data?.error || "Could not update dashboard URL."),
                };
              })
              .catch((): OpResult => ({
                name: "slug",
                ok: false,
                message: "Network error saving dashboard URL.",
              }))
          );
        }
      }

      const results = await Promise.all(ops);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        setSaveMsg("All changes saved.");
        setSaveIsError(false);
        if (slugChanged && results.some((r) => r.name === "slug" && r.ok)) {
          router.push(`/${cleaned}/dashboard/settings/user-settings`);
        }
      } else {
        const parts = failed.map((f) => {
          if (f.name === "description") return `Description: ${f.message}`;
          if (f.name === "google") return `Google link: ${f.message}`;
          if (f.name === "slug") return `Dashboard URL: ${f.message}`;
          return f.message || "Unknown error";
        });
        setSaveMsg(parts.join("  •  "));
        setSaveIsError(true);
      }
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="min-h-screen">{/* no background color */}
      <main className=" w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Top header (integrated, no card) */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-200">
          <h1 className="text-base font-semibold text-gray-900">
            {display ? `${display} Settings` : "Settings"}
          </h1>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={
              savingAll ||
              infoLoading ||
              !authUserId ||
              !slugify(slugInput) ||
              (googleLink ? !googleLinkIsValid : false) ||
              (slugInput !== currentSlug && isAvailable === false)
            }
            className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:border-indigo-300 disabled:bg-indigo-300"
          >
            {savingAll ? "Saving…" : "Save changes"}
          </button>
        </div>

        {/* Global save status */}
        {saveMsg && (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              saveIsError
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {saveMsg}
          </div>
        )}

        {/* Content sections with simple dividers */}
        <div className="mt-6 divide-y divide-gray-200">
          {/* Logo */}
          <section className="py-6">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Profile Photo (Company Logo)</h2>
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 overflow-hidden rounded-full bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={localPreview || logoUrl || "/DefaultPic.png"}
                  alt="Company logo"
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    if (!e.currentTarget.src.endsWith("/DefaultPic.png")) {
                      e.currentTarget.src = "/DefaultPic.png";
                    }
                  }}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0] ?? undefined)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Choose image
                </button>
                <button
                  type="button"
                  onClick={handleUploadLogo}
                  disabled={!file || uploading}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>
            {uploadMsg && (
              <div
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                  uploadIsError
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {uploadMsg}
              </div>
            )}
          </section>

          {/* Description */}
          <section className="py-6">
            <div className="mb-2">
              <h2 className="text-sm font-medium text-gray-900">Business Description</h2>
              <p className="text-xs text-gray-500">Optional • Used to make generated reviews feel authentic.</p>
            </div>
            {infoLoading ? (
              <div className="h-28 rounded-md border border-gray-200 bg-gray-50 animate-pulse" />
            ) : (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder={"A short description of what you do.\nWe will use this to make generated reviews more authentic."}
              />
            )}
          </section>

          {/* Google Link */}
          <section className="py-6">
            <h2 className="mb-2 text-sm font-medium text-gray-900">Google Business / Maps URL</h2>
            {infoLoading ? (
              <div className="h-10 rounded-md border border-gray-200 bg-gray-50 animate-pulse" />
            ) : (
              <>
                <input
                  type="url"
                  value={googleLink}
                  onChange={(e) => setGoogleLink(e.target.value)}
                  placeholder="https://g.page/your-business or https://maps.google.com/..."
                  className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-1 ${
                    googleLink && !googleLinkIsValid
                      ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                  }`}
                />
                {!googleLinkIsValid && googleLink && (
                  <div className="mt-2 text-xs text-red-600">
                    That doesn’t look like a valid Google Business/Maps link.
                  </div>
                )}
              </>
            )}
          </section>

          {/* Dashboard URL */}
          <section className="py-6">
            <h2 className="mb-2 text-sm font-medium text-gray-900">Dashboard URL</h2>
            <div className="grid gap-2">
              <label className="text-xs text-gray-600">Your unique URL slug</label>
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder={currentSlug || "your-business"}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <div className="text-xs text-gray-600">
                Your dashboard URL will be:{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5">{prettyURL}</code>
              </div>

              {slugInput !== currentSlug && (
                <div className="text-xs">
                  {checkingAvail ? (
                    <span className="text-gray-500">Checking availability…</span>
                  ) : isAvailable === true ? (
                    <span className="text-emerald-700">Available ✓</span>
                  ) : isAvailable === false ? (
                    <span className="text-red-600">Already taken ✗</span>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
