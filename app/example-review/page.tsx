// app/mock-review/page.tsx
"use client";

export default function MockReviewPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#f9fafb",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "500px",
          width: "100%",
        }}
      >
        <h1 style={{ marginBottom: "0.25rem", fontSize: "1.5rem", color: "#111827" }}>
          Leave Your Review
        </h1>

        <p style={{ marginTop: 0, marginBottom: "1rem", fontSize: 12, color: "#6b7280" }}>
          (This is a mock page — nothing will be saved.)
        </p>

        <form>
          <textarea
            placeholder="Type your review here..."
            style={{
              width: "100%",
              minHeight: "120px",
              padding: "0.75rem",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              marginBottom: "1rem",
              fontSize: "1rem",
            }}
          />
          <button
            type="button"
            style={{
              background: "#2563eb",
              color: "#fff",
              padding: "0.75rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              fontSize: "1rem",
              fontWeight: "bold",
              cursor: "not-allowed",
              opacity: 0.6,
            }}
            disabled
          >
            Submit
          </button>
        </form>
      </div>
    </div>
  );
}
