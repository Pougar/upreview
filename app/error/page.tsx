// app/error/page.tsx
export default function ErrorPage() {
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
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", color: "#dc2626", marginBottom: "1rem" }}>
          Oops!
        </h1>
        <p style={{ fontSize: "1rem", color: "#374151" }}>
          There has been an error and you have been redirected here.
        </p>
      </div>
    </div>
  );
}
