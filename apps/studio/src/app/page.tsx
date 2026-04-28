import Link from "next/link"
import { projects } from "@repo/schema/projects"

/**
 * Project picker — the Studio's root. Mirrors Sanity's "select a project"
 * screen: click a card to enter that project's workspace at `/[projectId]`.
 */
export default function ProjectsIndex() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "80px auto",
        padding: "0 24px",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.06 }}>
          sanity-clone
        </div>
        <h1 style={{ fontSize: 32, margin: "6px 0 8px" }}>Projects</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Select a project to open its Studio. Each project has its own
          isolated dataset and can have its own schema.
        </p>
      </header>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/${p.id}`}
              style={{
                display: "block",
                padding: "18px 20px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--panel)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</div>
                <span
                  style={{
                    padding: "2px 7px",
                    background: "var(--panel-2)",
                    borderRadius: 3,
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: "var(--muted)",
                  }}
                >
                  {p.id}
                </span>
                <span
                  style={{
                    padding: "2px 7px",
                    background: "var(--panel-2)",
                    borderRadius: 3,
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: "var(--muted)",
                  }}
                >
                  {p.dataset}
                </span>
              </div>
              {p.description ? (
                <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 14 }}>
                  {p.description}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 10,
                  color: "var(--muted)",
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                }}
              >
                preview → {p.demoUrl}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
