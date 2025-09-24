"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../../UserContext";
import { authClient } from "@/app/lib/auth-client";
import { useLogoUrl } from "@/app/lib/logoUrlClient";

// --- helpers: same slugify + google link check you've used elsewhere ---
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
  const { data: session } = authClient.useSession(); // { user: { id, email } } | null
  const authUserId = session?.user?.id ?? "";
  const accountEmail = session?.user?.email ?? "";

  // logo (current signed URL from provider, with auto-refresh)
  const { url: logoUrl, refresh: refreshLogoUrl } = useLogoUrl();

  // --- Google link state ---
  const [googleLink, setGoogleLink] = useState("");
  const googleLinkIsValid = useMemo(() => looksLikeGoogleBusinessLink(googleLink), [googleLink]);
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);
  const [googleIsError, setGoogleIsError] = useState(false);

  // --- Logo upload state ---
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadIsError, setUploadIsError] = useState(false);

  // --- Dashboard URL (slug) state ---
  const [slugInput, setSlugInput] = useState(currentSlug || "");
  const [checkingAvail, setCheckingAvail] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [slugMsg, setSlugMsg] = useState<string | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugIsError, setSlugIsError] = useState(false);

  // live preview url
  const prettyURL = useMemo(
    () => (slugInput ? `/${slugify(slugInput)}/dashboard` : "/[your-business]/dashboard"),
    [slugInput]
  );

  // Debounced availability check for the slug (uses your existing API)
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
        // Expecting something like { available: true } from your endpoint
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

  // Pick a file & show a local preview (before upload)
  const pickFile = () => fileInputRef.current?.click();
  const onPick = (f?: File) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setLocalPreview((e.target?.result as string) || null);
    reader.readAsDataURL(f);
  };

  // --- Handlers ---
  const handleSaveGoogle = async () => {
    setGoogleMsg(null);
    setGoogleIsError(false);
    if (!authUserId) {
      setGoogleMsg("Missing user session.");
      setGoogleIsError(true);
      return;
    }
    if (!googleLinkIsValid) {
      setGoogleMsg("Please enter a valid Google Business / Maps URL.");
      setGoogleIsError(true);
      return;
    }
    setSavingGoogle(true);
    try {
      const res = await fetch("/api/update-google-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: authUserId, googleBusinessLink: googleLink || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleMsg(data?.message || data?.error || "Could not save Google link.");
        setGoogleIsError(true);
      } else {
        setGoogleMsg("Saved your Google Business / Maps URL.");
        setGoogleIsError(false);
      }
    } catch {
      setGoogleMsg("Network error. Please try again.");
      setGoogleIsError(true);
    } finally {
      setSavingGoogle(false);
    }
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
        // Preview the stored image if the API returns a signedUrl; otherwise force provider refresh
        const signedUrl = data?.signedUrl || data?.user?.company_logo_url || null;
        if (signedUrl) {
          // Replace local preview with the actually stored image
          setLocalPreview(signedUrl);
        }
        // In any case, refresh provider so TopNav/Header etc. update
        void refreshLogoUrl();
        setUploadMsg("Logo updated!");
        setUploadIsError(false);
      }
    } catch {
      setUploadMsg("Network error during upload.");
      setUploadIsError(true);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSlug = async () => {
    setSlugMsg(null);
    setSlugIsError(false);

    const cleaned = slugify(slugInput);
    if (!cleaned) {
      setSlugMsg("Please enter a valid dashboard URL (letters & numbers).");
      setSlugIsError(true);
      return;
    }
    if (cleaned !== slugInput) {
      // normalize input to the slugified value
      setSlugInput(cleaned);
    }
    if (!authUserId || !accountEmail) {
      setSlugMsg("Missing user session.");
      setSlugIsError(true);
      return;
    }
    if (cleaned !== currentSlug && isAvailable === false) {
      setSlugMsg("That URL is already taken.");
      setSlugIsError(true);
      return;
    }

    setSlugSaving(true);
    try {
      const res = await fetch("/api/update-slug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: authUserId, newName: cleaned, email: accountEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSlugMsg(data?.message || data?.error || "Could not update dashboard URL.");
        setSlugIsError(true);
      } else {
        setSlugMsg("Dashboard URL updated.");
        setSlugIsError(false);
        // navigate to the new route so your server layout revalidates and context matches
        router.push(`/${cleaned}/dashboard/settings`);
      }
    } catch {
      setSlugMsg("Network error. Please try again.");
      setSlugIsError(true);
    } finally {
      setSlugSaving(false);
    }
  };

  return (
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-2xl flex flex-col gap-8">
        <h1 className="text-2xl font-bold text-gray-800 text-center">{display} Settings</h1>

        {/* Company Logo */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gray-800">Profile Photo (Company Logo)</h2>
          <div className="flex items-center gap-4">
            <img
              src={localPreview || logoUrl || "/snakepic.png"}
              alt="Company logo"
              className="h-16 w-16 rounded-lg object-cover ring-1 ring-black/10 bg-gray-100"
              onError={(e) => {
                if (!e.currentTarget.src.endsWith("/snakepic.png")) {
                  e.currentTarget.src = "/snakepic.png";
                }
              }}
            />
            <div className="flex items-center gap-3">
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
                className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-800"
              >
                Choose Image
              </button>
              <button
                type="button"
                onClick={handleUploadLogo}
                disabled={!file || uploading}
                className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white disabled:bg-blue-200"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
          {uploadMsg && (
            <div
              className={`text-sm rounded-md px-3 py-2 ${
                uploadIsError ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              {uploadMsg}
            </div>
          )}
        </section>

        {/* Google Business / Maps URL */}
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-gray-800">Google Business / Maps URL</h2>
          <input
            type="url"
            value={googleLink}
            onChange={(e) => setGoogleLink(e.target.value)}
            placeholder="https://g.page/your-business or https://maps.google.com/..."
            className={`border rounded-lg px-4 py-2 focus:outline-none ${
              googleLink && !googleLinkIsValid ? "border-red-400 focus:ring-2 focus:ring-red-300" : "border-gray-300 focus:ring-2 focus:ring-blue-300"
            }`}
          />
          {!googleLinkIsValid && googleLink && (
            <div className="text-sm text-red-600">That doesn’t look like a valid Google Business/Maps link.</div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSaveGoogle}
              disabled={savingGoogle || (googleLink ? !googleLinkIsValid : false) || !authUserId}
              className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white disabled:bg-blue-200"
            >
              {savingGoogle ? "Saving…" : "Save Link"}
            </button>
            <Link
              href={`/${currentSlug}/dashboard`}
              className="px-4 py-2 rounded-full border border-gray-300 hover:bg-gray-100"
            >
              Cancel
            </Link>
          </div>
          {googleMsg && (
            <div
              className={`text-sm rounded-md px-3 py-2 ${
                googleIsError ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              {googleMsg}
            </div>
          )}
        </section>

        {/* Dashboard URL (slug) */}
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-gray-800">Dashboard URL</h2>
          <div className="grid gap-2">
            <label className="text-sm text-gray-700">Your unique URL slug</label>
            <input
              type="text"
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder={currentSlug || "your-business"}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="text-xs text-gray-600">
              Your dashboard URL will be:{" "}
              <code className="bg-gray-100 rounded px-2 py-0.5">{prettyURL}</code>
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

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSaveSlug}
              disabled={slugSaving || !authUserId || !accountEmail}
              className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white disabled:bg-blue-200"
            >
              {slugSaving ? "Saving…" : "Save URL"}
            </button>
            <Link
              href={`/${currentSlug}/dashboard`}
              className="px-4 py-2 rounded-full border border-gray-300 hover:bg-gray-100"
            >
              Cancel
            </Link>
          </div>

          {slugMsg && (
            <div
              className={`text-sm rounded-md px-3 py-2 ${
                slugIsError ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              {slugMsg}
            </div>
          )}
        </section>

        {/* Back to dashboard */}
        <div className="flex justify-center pt-2">
          <Link
            href={`/${currentSlug}/dashboard`}
            className="bg-blue-500 text-white px-6 py-3 rounded-full font-semibold text-center hover:bg-blue-600 transition mt-2"
          >
            Done
          </Link>
        </div>
      </div>
  );
}
