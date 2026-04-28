"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { SanityCloneClient } from "@repo/client"
import type { Project } from "@repo/schema/projects"
import { clientForProject } from "./client"

interface ProjectContextValue {
  project: Project
  client: SanityCloneClient
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({
  project,
  children,
}: {
  project: Project
  children: ReactNode
}) {
  const value = useMemo<ProjectContextValue>(
    () => ({ project, client: clientForProject(project) }),
    [project],
  )
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>")
  return ctx
}
